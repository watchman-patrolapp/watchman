-- P4a follow-up fixes for the local services directory (additive, idempotent).
-- Applies on top of 20261112141000_local_services_listings_search.sql.
--   1) search_local_services: neighbour rows return first name only (server-side).
--   2) Org-move trigger pauses only published listings; pending stay pending.
--      set_service_listing_status: an owner cannot publish a listing paused by an
--      org move unless it was approved/published before (was_published / moderated_at).
--   3) search_local_services orders by rank, not column position.
--   4) Trigram synonym gate lowered 0.5 -> 0.45 so 'plumbr' matches plumbing.

SET search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 0) Marker: has this listing ever been live?
-- ---------------------------------------------------------------------
ALTER TABLE public.local_service_listings
  ADD COLUMN IF NOT EXISTS was_published boolean NOT NULL DEFAULT false;

UPDATE public.local_service_listings
SET was_published = true
WHERE NOT was_published
  AND (status = 'published' OR moderated_at IS NOT NULL);

-- ---------------------------------------------------------------------
-- 2a) Org-move trigger: only published -> paused
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_users_pause_service_listings_on_move()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
    UPDATE public.local_service_listings
    SET status = 'paused',
        was_published = true,
        moderation_reason = 'Owner moved neighbourhood',
        updated_at = now()
    WHERE owner_user_id = NEW.id
      AND organization_id = OLD.organization_id
      AND status = 'published';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 2b) set_service_listing_status: block unapproved publish after org move
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_service_listing_status(
  p_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS public.local_service_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  listing public.local_service_listings;
  reason_text text := nullif(trim(p_reason), '');
  next_status text := lower(trim(p_status));
  is_owner boolean;
  is_mod boolean;
  row_out public.local_service_listings;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO listing FROM public.local_service_listings WHERE id = p_id;
  IF listing.id IS NULL OR listing.organization_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'not found';
  END IF;
  is_owner := listing.owner_user_id = auth.uid();
  is_mod := public.can_moderate_resident_content(listing.organization_id);
  IF NOT is_owner AND NOT is_mod THEN
    RAISE EXCEPTION 'not found';
  END IF;

  IF is_owner AND NOT is_mod THEN
    IF listing.status = 'hidden' THEN
      RAISE EXCEPTION 'this listing is hidden; a moderator must restore it';
    END IF;
    IF next_status = 'paused' AND listing.status IN ('published', 'paused') THEN
      NULL;
    ELSIF next_status = 'published' AND listing.status = 'paused' THEN
      IF listing.moderation_reason = 'Owner moved neighbourhood'
         AND NOT listing.was_published
         AND listing.moderated_at IS NULL THEN
        RAISE EXCEPTION 'this listing needs moderator approval before it goes live';
      END IF;
    ELSIF next_status = 'removed' AND listing.status IN ('pending', 'published', 'paused') THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'you cannot change this listing to that status';
    END IF;
  ELSE
    -- Moderator (or owner who is also a moderator): approve, hide, restore, or remove.
    IF next_status = 'published' AND listing.status IN ('pending', 'hidden', 'paused', 'published') THEN
      NULL;
    ELSIF next_status = 'hidden' THEN
      IF reason_text IS NULL THEN
        RAISE EXCEPTION 'please give a reason';
      END IF;
    ELSIF next_status = 'removed' THEN
      NULL;
    ELSIF next_status = 'paused' AND is_owner THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'you cannot change this listing to that status';
    END IF;
  END IF;

  UPDATE public.local_service_listings
  SET status = next_status,
      was_published = was_published OR next_status = 'published',
      moderation_reason = CASE
        WHEN is_mod AND next_status IN ('hidden', 'published') THEN reason_text
        ELSE moderation_reason
      END,
      moderated_by = CASE WHEN is_mod AND NOT is_owner THEN auth.uid() ELSE moderated_by END,
      moderated_at = CASE WHEN is_mod AND NOT is_owner THEN now() ELSE moderated_at END,
      updated_at = now()
  WHERE id = listing.id
  RETURNING * INTO row_out;

  IF is_mod AND NOT is_owner THEN
    PERFORM public.notify_app_user(
      listing.owner_user_id,
      'moderation',
      CASE next_status
        WHEN 'published' THEN 'Your service listing was approved'
        WHEN 'hidden' THEN 'Your service listing was hidden'
        WHEN 'removed' THEN 'Your service listing was removed'
        ELSE 'Your service listing was updated'
      END,
      coalesce(reason_text, row_out.title),
      '/resident/services/mine'
    );
    PERFORM public.write_staff_activity(
      'service_listing_' || next_status,
      jsonb_build_object('listing_id', listing.id, 'reason', reason_text),
      auth.uid(),
      listing.organization_id
    );
  END IF;

  RETURN row_out;
END;
$$;

-- ---------------------------------------------------------------------
-- 1, 3, 4) search_local_services
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_local_services(
  p_query text DEFAULT '',
  p_category text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_include_neighbours boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  title text,
  business_name text,
  category_slug text,
  category_label text,
  tags text[],
  service_area text,
  price_range text,
  photo_path text,
  avg_rating numeric,
  rating_count integer,
  vouch_count integer,
  phone text,
  whatsapp text,
  owner_name text,
  is_featured boolean,
  organization_id uuid,
  suburb_name text,
  is_neighbour boolean,
  rank real
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  q text := lower(trim(coalesce(p_query, '')));
  tokens text[];
  expanded text[];
  cat_hits text[];
  tsq tsquery;
  term text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  q := left(regexp_replace(q, '[^a-z0-9 ]', ' ', 'g'), 80);
  tokens := array_remove(regexp_split_to_array(trim(q), '\s+'), '');

  IF cardinality(tokens) > 0 THEN
    SELECT
      coalesce(array_agg(DISTINCT s.canonical), '{}'),
      coalesce(array_agg(DISTINCT s.category_slug) FILTER (WHERE s.category_slug IS NOT NULL), '{}')
    INTO expanded, cat_hits
    FROM public.local_service_synonyms s
    WHERE s.term = ANY (tokens) OR s.term = q
       OR EXISTS (
         SELECT 1 FROM unnest(tokens) t
         WHERE char_length(t) >= 4 AND similarity(s.term, t) >= 0.45
       );

    cat_hits := cat_hits || ARRAY(
      SELECT c.slug FROM public.local_service_categories c
      WHERE c.slug = ANY (tokens) OR lower(c.label) LIKE '%' || q || '%'
    );
    expanded := ARRAY(SELECT DISTINCT x FROM unnest(tokens || expanded) x);

    FOREACH term IN ARRAY expanded LOOP
      tsq := CASE
        WHEN tsq IS NULL THEN plainto_tsquery('simple', term)
        ELSE tsq || plainto_tsquery('simple', term)
      END;
    END LOOP;
  END IF;

  RETURN QUERY
  SELECT r.id, r.title, r.business_name, r.category_slug, r.category_label, r.tags,
         r.service_area, r.price_range, r.photo_path, r.avg_rating, r.rating_count,
         r.vouch_count, r.phone, r.whatsapp, r.owner_name, r.is_featured,
         r.organization_id, r.suburb_name, r.is_neighbour, r.rank
  FROM (
    SELECT
      l.id,
      l.title,
      l.business_name,
      l.category_slug,
      c.label AS category_label,
      l.tags,
      l.service_area,
      l.price_range,
      l.photo_paths[1] AS photo_path,
      l.avg_rating,
      l.rating_count,
      l.vouch_count,
      l.phone,
      l.whatsapp,
      CASE
        WHEN l.organization_id NOT IN (SELECT public.current_org_ids())
          THEN nullif(split_part(trim(u.full_name), ' ', 1), '')
        ELSE u.full_name
      END AS owner_name,
      l.is_featured,
      l.organization_id,
      COALESCE(s.name, o.name) AS suburb_name,
      (l.organization_id NOT IN (SELECT public.current_org_ids())) AS is_neighbour,
      (
        CASE WHEN tsq IS NOT NULL THEN ts_rank_cd(l.search_doc, tsq) * 2.0 ELSE 0 END
        + CASE WHEN q <> '' THEN word_similarity(q, l.search_text) ELSE 0 END
        + CASE WHEN l.category_slug = ANY (cat_hits) OR c.parent_slug = ANY (cat_hits) THEN 0.6 ELSE 0 END
        + CASE WHEN l.tags && expanded THEN 0.5 ELSE 0 END
        + least(l.vouch_count, 10) * 0.03
        + coalesce(l.avg_rating, 0) * 0.02
        + CASE WHEN l.is_featured THEN 0.2 ELSE 0 END
      )::real AS rank,
      l.updated_at AS sort_updated_at
    FROM public.local_service_listings l
    JOIN public.local_service_categories c ON c.slug = l.category_slug
    JOIN public.organizations o ON o.id = l.organization_id
    LEFT JOIN public.suburbs s ON s.id = o.primary_suburb_id
    LEFT JOIN public.users u ON u.id = l.owner_user_id
    WHERE l.status = 'published'
      AND (
        l.organization_id IN (SELECT public.current_org_ids())
        OR (
          coalesce(p_include_neighbours, false)
          AND l.show_to_neighbours
          AND l.organization_id IN (SELECT public.direct_neighbour_org_ids())
        )
      )
      AND (p_category IS NULL OR l.category_slug = p_category OR c.parent_slug = p_category)
      AND (
        q = ''
        OR (tsq IS NOT NULL AND l.search_doc @@ tsq)
        OR l.tags && expanded
        OR l.category_slug = ANY (cat_hits)
        OR c.parent_slug = ANY (cat_hits)
        OR word_similarity(q, l.search_text) >= 0.45
      )
  ) r
  ORDER BY r.rank DESC, r.vouch_count DESC, r.sort_updated_at DESC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 20), 1), 50)
  OFFSET GREATEST(coalesce(p_offset, 0), 0);
END;
$$;

-- ---------------------------------------------------------------------
-- Grants (unchanged; re-asserted for safety)
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.trg_users_pause_service_listings_on_move() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_users_pause_service_listings_on_move() TO service_role;

REVOKE ALL ON FUNCTION public.set_service_listing_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_service_listing_status(uuid, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.search_local_services(text, text, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_local_services(text, text, integer, integer, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
DO $$
DECLARE
  missing text := '';
  src text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'local_service_listings' AND column_name = 'was_published'
  ) THEN
    missing := missing || 'was_published column; ';
  END IF;

  SELECT p.prosrc INTO src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'search_local_services' AND p.pronargs = 5;
  IF src IS NULL THEN
    missing := missing || 'search_local_services; ';
  ELSE
    IF src NOT LIKE '%split_part(trim(u.full_name)%' THEN missing := missing || 'first-name-only for neighbours; '; END IF;
    IF src NOT LIKE '%ORDER BY r.rank DESC%' THEN missing := missing || 'ORDER BY rank; '; END IF;
    IF src NOT LIKE '%similarity(s.term, t) >= 0.45%' THEN missing := missing || 'similarity gate 0.45; '; END IF;
    IF src LIKE '%ORDER BY 20%' THEN missing := missing || 'old ORDER BY 20 still present; '; END IF;
  END IF;

  SELECT p.prosrc INTO src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'trg_users_pause_service_listings_on_move';
  IF src IS NULL OR src LIKE '%''pending''%' THEN
    missing := missing || 'org-move trigger still pauses pending; ';
  END IF;

  SELECT p.prosrc INTO src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'set_service_listing_status';
  IF src IS NULL OR src NOT LIKE '%needs moderator approval%' THEN
    missing := missing || 'owner publish guard; ';
  END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION 'P4a fixes verification failed: %', missing;
  END IF;
  RAISE NOTICE 'P4a local services fixes: OK.';
END;
$$;
