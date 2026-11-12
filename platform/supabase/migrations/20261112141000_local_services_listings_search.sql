-- =====================================================================
-- 2) Listings
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.local_service_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
  business_name text CHECK (business_name IS NULL OR char_length(business_name) <= 80),
  description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 2000),
  category_slug text NOT NULL REFERENCES public.local_service_categories (slug),
  tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 12),
  contact_name text CHECK (contact_name IS NULL OR char_length(contact_name) <= 80),
  phone text CHECK (phone IS NULL OR phone ~ '^\+?[0-9 ]{9,16}$'),
  whatsapp text CHECK (whatsapp IS NULL OR whatsapp ~ '^\+?[0-9 ]{9,16}$'),
  email text CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  website text CHECK (website IS NULL OR website ~* '^https?://'),
  service_area text CHECK (service_area IS NULL OR char_length(service_area) <= 120),
  -- Launch: always false. Do not expose a city-wide toggle in the app.
  serves_whole_city boolean NOT NULL DEFAULT false,
  -- Opt-in: also visible to members of orgs linked in public.org_neighbours.
  show_to_neighbours boolean NOT NULL DEFAULT false,
  hours_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_range text CHECK (price_range IS NULL OR price_range IN ('budget', 'mid', 'premium', 'quote')),
  price_note text CHECK (price_note IS NULL OR char_length(price_note) <= 120),
  photo_paths text[] NOT NULL DEFAULT '{}' CHECK (cardinality(photo_paths) <= 6),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'published', 'paused', 'hidden', 'removed')),
  is_featured boolean NOT NULL DEFAULT false,
  moderated_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  moderated_at timestamptz,
  moderation_reason text,
  avg_rating numeric(3, 2),
  rating_count integer NOT NULL DEFAULT 0,
  vouch_count integer NOT NULL DEFAULT 0,
  search_doc tsvector,
  search_text text,
  consent_publish_contact boolean NOT NULL DEFAULT false,
  last_confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listing_has_contact CHECK (
    phone IS NOT NULL OR whatsapp IS NOT NULL OR email IS NOT NULL OR website IS NOT NULL
  ),
  CONSTRAINT listing_consent CHECK (consent_publish_contact)
);

CREATE INDEX IF NOT EXISTS local_service_listings_org_status_idx
  ON public.local_service_listings (organization_id, status, category_slug);
CREATE INDEX IF NOT EXISTS local_service_listings_search_doc_idx
  ON public.local_service_listings USING gin (search_doc);
CREATE INDEX IF NOT EXISTS local_service_listings_search_text_trgm
  ON public.local_service_listings USING gin (search_text extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS local_service_listings_tags_idx
  ON public.local_service_listings USING gin (tags);
CREATE INDEX IF NOT EXISTS local_service_listings_owner_idx
  ON public.local_service_listings (owner_user_id);

CREATE OR REPLACE FUNCTION public.trg_local_service_listing_search()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cat_label text;
  parent_label text;
BEGIN
  NEW.tags := ARRAY(
    SELECT DISTINCT lower(trim(t)) FROM unnest(coalesce(NEW.tags, '{}')) t
    WHERE char_length(trim(t)) BETWEEN 2 AND 30
  );
  SELECT c.label, p.label INTO cat_label, parent_label
  FROM public.local_service_categories c
  LEFT JOIN public.local_service_categories p ON p.slug = c.parent_slug
  WHERE c.slug = NEW.category_slug;

  NEW.search_doc :=
      setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A')
   || setweight(to_tsvector('simple', array_to_string(NEW.tags, ' ')), 'A')
   || setweight(to_tsvector('simple', coalesce(NEW.business_name, '') || ' ' || coalesce(cat_label, '') || ' ' || coalesce(parent_label, '')), 'B')
   || setweight(to_tsvector('english', coalesce(NEW.description, '')), 'C')
   || setweight(to_tsvector('simple', coalesce(NEW.service_area, '')), 'D');
  NEW.search_text := lower(concat_ws(' ', NEW.title, NEW.business_name, array_to_string(NEW.tags, ' '),
                                     cat_label, parent_label, NEW.category_slug));
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS local_service_listing_search ON public.local_service_listings;
CREATE TRIGGER local_service_listing_search
  BEFORE INSERT OR UPDATE OF title, business_name, description, category_slug, tags, service_area
  ON public.local_service_listings
  FOR EACH ROW EXECUTE FUNCTION public.trg_local_service_listing_search();

ALTER TABLE public.local_service_listings ENABLE ROW LEVEL SECURITY;


-- =====================================================================
-- 2b) Neighbouring suburbs (org-to-org adjacency)
-- public.organizations is the Watchman neighbourhood / NW-group table
-- (type nw_group). public.suburbs holds the suburb label via
-- organizations.primary_suburb_id. Links are stored in both directions;
-- queries never walk more than one hop.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.org_neighbours (
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  neighbour_org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  PRIMARY KEY (org_id, neighbour_org_id),
  CONSTRAINT org_neighbours_no_self CHECK (org_id <> neighbour_org_id)
);

CREATE INDEX IF NOT EXISTS org_neighbours_neighbour_idx
  ON public.org_neighbours (neighbour_org_id);

ALTER TABLE public.org_neighbours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_neighbours_select ON public.org_neighbours;
CREATE POLICY org_neighbours_select ON public.org_neighbours
  FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT public.current_org_ids())
    OR neighbour_org_id IN (SELECT public.current_org_ids())
  );

REVOKE INSERT, UPDATE, DELETE ON public.org_neighbours FROM anon, authenticated;
GRANT SELECT ON public.org_neighbours TO authenticated;
GRANT ALL ON public.org_neighbours TO service_role;

CREATE OR REPLACE FUNCTION public.direct_neighbour_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT n.neighbour_org_id
  FROM public.org_neighbours n
  WHERE n.org_id IN (SELECT public.current_org_ids())
    AND n.neighbour_org_id <> n.org_id
    AND n.neighbour_org_id NOT IN (SELECT public.current_org_ids());
$$;

CREATE OR REPLACE FUNCTION public.is_direct_neighbour_org(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_org_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.direct_neighbour_org_ids() d
      WHERE d = p_org_id
    );
$$;

CREATE OR REPLACE FUNCTION public.can_access_service_listing(p_listing_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  l public.local_service_listings;
BEGIN
  IF auth.uid() IS NULL OR p_listing_id IS NULL THEN
    RETURN false;
  END IF;
  SELECT * INTO l FROM public.local_service_listings WHERE id = p_listing_id;
  IF l.id IS NULL THEN
    RETURN false;
  END IF;
  IF l.owner_user_id = auth.uid() THEN
    RETURN true;
  END IF;
  IF l.organization_id IN (SELECT public.current_org_ids()) THEN
    RETURN l.status = 'published'
        OR public.can_moderate_resident_content(l.organization_id);
  END IF;
  RETURN l.status = 'published'
     AND l.show_to_neighbours
     AND public.is_direct_neighbour_org(l.organization_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_org_neighbours()
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  suburb_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN QUERY
  SELECT
    o.id,
    o.name,
    COALESCE(s.name, o.name)
  FROM public.org_neighbours n
  JOIN public.organizations o ON o.id = n.neighbour_org_id
  LEFT JOIN public.suburbs s ON s.id = o.primary_suburb_id
  WHERE n.org_id IN (SELECT public.current_org_ids())
    AND n.org_id = COALESCE(public.working_organization_id(), n.org_id)
  ORDER BY COALESCE(s.name, o.name), o.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_org_neighbour_candidates()
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  suburb_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  home_org uuid := public.working_organization_id();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF home_org IS NULL OR NOT public.can_manage_org_capabilities(home_org) THEN
    RAISE EXCEPTION 'not found';
  END IF;
  RETURN QUERY
  SELECT
    o.id,
    o.name,
    COALESCE(s.name, o.name)
  FROM public.organizations o
  LEFT JOIN public.suburbs s ON s.id = o.primary_suburb_id
  WHERE o.status = 'active'
    AND o.type = 'nw_group'
    AND o.id <> home_org
    AND NOT EXISTS (
      SELECT 1
      FROM public.org_neighbours n
      WHERE n.org_id = home_org
        AND n.neighbour_org_id = o.id
    )
  ORDER BY COALESCE(s.name, o.name), o.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_org_neighbour(p_neighbour_org_id uuid, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  home_org uuid := public.working_organization_id();
  neighbour public.organizations;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF home_org IS NULL OR NOT public.can_manage_org_capabilities(home_org) THEN
    RAISE EXCEPTION 'not found';
  END IF;
  IF p_neighbour_org_id IS NULL OR p_neighbour_org_id = home_org THEN
    RAISE EXCEPTION 'not found';
  END IF;
  SELECT * INTO neighbour
  FROM public.organizations
  WHERE id = p_neighbour_org_id
    AND type = 'nw_group'
    AND status = 'active';
  IF neighbour.id IS NULL THEN
    RAISE EXCEPTION 'not found';
  END IF;

  IF coalesce(p_enabled, false) THEN
    INSERT INTO public.org_neighbours (org_id, neighbour_org_id, created_by)
    VALUES (home_org, p_neighbour_org_id, auth.uid())
    ON CONFLICT (org_id, neighbour_org_id) DO NOTHING;
    INSERT INTO public.org_neighbours (org_id, neighbour_org_id, created_by)
    VALUES (p_neighbour_org_id, home_org, auth.uid())
    ON CONFLICT (org_id, neighbour_org_id) DO NOTHING;
  ELSE
    DELETE FROM public.org_neighbours n
    WHERE (n.org_id = home_org AND n.neighbour_org_id = p_neighbour_org_id)
       OR (n.org_id = p_neighbour_org_id AND n.neighbour_org_id = home_org);
  END IF;
END;
$$;

ALTER TABLE public.local_service_listings
  ADD COLUMN IF NOT EXISTS show_to_neighbours boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS local_service_listings_select ON public.local_service_listings;
CREATE POLICY local_service_listings_select ON public.local_service_listings
  FOR SELECT TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    OR (
      organization_id IN (SELECT public.current_org_ids())
      AND (status = 'published' OR public.can_moderate_resident_content(organization_id))
    )
    OR (
      status = 'published'
      AND show_to_neighbours
      AND public.is_direct_neighbour_org(organization_id)
    )
  );

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
        moderation_reason = 'Owner moved neighbourhood',
        updated_at = now()
    WHERE owner_user_id = NEW.id
      AND organization_id = OLD.organization_id
      AND status IN ('published', 'pending');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzz_pause_service_listings_on_move ON public.users;
CREATE TRIGGER zzz_pause_service_listings_on_move
  AFTER UPDATE OF organization_id ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_users_pause_service_listings_on_move();


-- =====================================================================
-- 3) RPCs
-- =====================================================================
CREATE OR REPLACE FUNCTION public.list_service_categories()
RETURNS SETOF public.local_service_categories
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.*
  FROM public.local_service_categories c
  WHERE c.active
  ORDER BY c.sort_order, c.label;
$$;

CREATE OR REPLACE FUNCTION public.upsert_service_listing(p_id uuid, p_payload jsonb)
RETURNS public.local_service_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id uuid := public.working_organization_id();
  caller public.users;
  listing_id uuid;
  next_status text;
  photo_prefix text;
  incoming_photos text[];
  incoming_tags text[];
  row_out public.local_service_listings;
  existing public.local_service_listings;
  active_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF org_id IS NULL OR org_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'not found';
  END IF;

  SELECT * INTO caller FROM public.users WHERE id = auth.uid();
  IF caller.id IS NULL OR NOT public.is_household_directory_role(caller.role::text) THEN
    RAISE EXCEPTION 'not found';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'listing details are required';
  END IF;
  IF coalesce((p_payload->>'consent_publish_contact')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'please agree to publish your contact details to members of this Neighbourhood Watch';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO existing FROM public.local_service_listings WHERE id = p_id;
    IF existing.id IS NULL OR existing.organization_id NOT IN (SELECT public.current_org_ids()) THEN
      RAISE EXCEPTION 'not found';
    END IF;
    IF existing.owner_user_id <> auth.uid()
       AND NOT public.can_moderate_resident_content(existing.organization_id) THEN
      RAISE EXCEPTION 'not found';
    END IF;
    listing_id := existing.id;
    org_id := existing.organization_id;
    next_status := existing.status;
  ELSE
    listing_id := gen_random_uuid();
    SELECT count(*) INTO active_count
    FROM public.local_service_listings
    WHERE owner_user_id = auth.uid()
      AND status IN ('pending', 'published', 'paused');
    IF active_count >= 3 THEN
      RAISE EXCEPTION 'you can have up to 3 active listings';
    END IF;
    next_status := CASE
      WHEN public.is_verified_household(auth.uid()) THEN 'published'
      ELSE 'pending'
    END;
  END IF;

  photo_prefix := org_id::text || '/services/' || listing_id::text || '/';
  incoming_photos := ARRAY(
    SELECT p
    FROM unnest(coalesce(
      ARRAY(SELECT jsonb_array_elements_text(coalesce(p_payload->'photo_paths', '[]'::jsonb))),
      '{}'::text[]
    )) AS p
    WHERE p LIKE photo_prefix || '%'
    LIMIT 6
  );
  incoming_tags := ARRAY(
    SELECT DISTINCT lower(trim(t))
    FROM jsonb_array_elements_text(coalesce(p_payload->'tags', '[]'::jsonb)) t
    WHERE char_length(trim(t)) BETWEEN 2 AND 30
    LIMIT 12
  );

  INSERT INTO public.local_service_listings (
    id, organization_id, owner_user_id, title, business_name, description, category_slug, tags,
    contact_name, phone, whatsapp, email, website, service_area, serves_whole_city, show_to_neighbours, hours_json,
    price_range, price_note, photo_paths, status, consent_publish_contact, last_confirmed_at
  )
  VALUES (
    listing_id,
    org_id,
    coalesce(existing.owner_user_id, auth.uid()),
    left(trim(p_payload->>'title'), 80),
    nullif(left(trim(p_payload->>'business_name'), 80), ''),
    left(trim(p_payload->>'description'), 2000),
    trim(p_payload->>'category_slug'),
    coalesce(incoming_tags, '{}'::text[]),
    nullif(left(trim(p_payload->>'contact_name'), 80), ''),
    nullif(trim(p_payload->>'phone'), ''),
    nullif(trim(p_payload->>'whatsapp'), ''),
    nullif(trim(p_payload->>'email'), ''),
    nullif(trim(p_payload->>'website'), ''),
    nullif(left(trim(p_payload->>'service_area'), 120), ''),
    false,  -- ignore any client serves_whole_city; neighbourhood-only at launch
    coalesce((p_payload->>'show_to_neighbours')::boolean, false),
    coalesce(p_payload->'hours_json', '{}'::jsonb),
    nullif(trim(p_payload->>'price_range'), ''),
    nullif(left(trim(p_payload->>'price_note'), 120), ''),
    coalesce(incoming_photos, '{}'::text[]),
    next_status,
    true,
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET title = EXCLUDED.title,
        business_name = EXCLUDED.business_name,
        description = EXCLUDED.description,
        category_slug = EXCLUDED.category_slug,
        tags = EXCLUDED.tags,
        contact_name = EXCLUDED.contact_name,
        phone = EXCLUDED.phone,
        whatsapp = EXCLUDED.whatsapp,
        email = EXCLUDED.email,
        website = EXCLUDED.website,
        service_area = EXCLUDED.service_area,
        show_to_neighbours = EXCLUDED.show_to_neighbours,
        hours_json = EXCLUDED.hours_json,
        price_range = EXCLUDED.price_range,
        price_note = EXCLUDED.price_note,
        photo_paths = EXCLUDED.photo_paths,
        consent_publish_contact = true,
        last_confirmed_at = now(),
        updated_at = now()
  RETURNING * INTO row_out;

  RETURN row_out;
END;
$$;

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
      NULL;
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

CREATE OR REPLACE FUNCTION public.confirm_service_listing_current(p_id uuid)
RETURNS public.local_service_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_out public.local_service_listings;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE public.local_service_listings
  SET last_confirmed_at = now(), updated_at = now()
  WHERE id = p_id
    AND owner_user_id = auth.uid()
    AND organization_id IN (SELECT public.current_org_ids())
    AND status IN ('published', 'paused', 'pending')
  RETURNING * INTO row_out;
  IF row_out.id IS NULL THEN RAISE EXCEPTION 'not found'; END IF;
  RETURN row_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.feature_service_listing(p_id uuid, p_on boolean)
RETURNS public.local_service_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  listing public.local_service_listings;
  row_out public.local_service_listings;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO listing FROM public.local_service_listings WHERE id = p_id;
  IF listing.id IS NULL OR listing.organization_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'not found';
  END IF;
  -- Pinning is staff-only (NW admin / committee / global), not resident moderators.
  IF NOT public.can_moderate_incidents() THEN
    RAISE EXCEPTION 'not found';
  END IF;
  UPDATE public.local_service_listings
  SET is_featured = coalesce(p_on, false), updated_at = now()
  WHERE id = listing.id
  RETURNING * INTO row_out;
  PERFORM public.write_staff_activity(
    'service_listing_feature',
    jsonb_build_object('listing_id', listing.id, 'on', coalesce(p_on, false)),
    auth.uid(),
    listing.organization_id
  );
  RETURN row_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_service_listing(p_id uuid)
RETURNS public.local_service_listings
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_out public.local_service_listings;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO row_out FROM public.local_service_listings WHERE id = p_id;
  IF row_out.id IS NULL OR NOT public.can_access_service_listing(p_id) THEN
    RAISE EXCEPTION 'not found';
  END IF;
  RETURN row_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_service_listings()
RETURNS SETOF public.local_service_listings
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN QUERY
  SELECT l.*
  FROM public.local_service_listings l
  WHERE l.owner_user_id = auth.uid()
    AND l.status <> 'removed'
  ORDER BY l.updated_at DESC;
END;
$$;

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
         WHERE char_length(t) >= 4 AND similarity(s.term, t) >= 0.5
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
  SELECT
    l.id,
    l.title,
    l.business_name,
    l.category_slug,
    c.label,
    l.tags,
    l.service_area,
    l.price_range,
    l.photo_paths[1],
    l.avg_rating,
    l.rating_count,
    l.vouch_count,
    l.phone,
    l.whatsapp,
    u.full_name,
    l.is_featured,
    l.organization_id,
    COALESCE(s.name, o.name),
    (l.organization_id NOT IN (SELECT public.current_org_ids())),
    (
      CASE WHEN tsq IS NOT NULL THEN ts_rank_cd(l.search_doc, tsq) * 2.0 ELSE 0 END
      + CASE WHEN q <> '' THEN word_similarity(q, l.search_text) ELSE 0 END
      + CASE WHEN l.category_slug = ANY (cat_hits) OR c.parent_slug = ANY (cat_hits) THEN 0.6 ELSE 0 END
      + CASE WHEN l.tags && expanded THEN 0.5 ELSE 0 END
      + least(l.vouch_count, 10) * 0.03
      + coalesce(l.avg_rating, 0) * 0.02
      + CASE WHEN l.is_featured THEN 0.2 ELSE 0 END
    )::real AS rank
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
  ORDER BY 20 DESC, l.vouch_count DESC, l.updated_at DESC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 20), 1), 50)
  OFFSET GREATEST(coalesce(p_offset, 0), 0);
END;
$$;

-- =====================================================================
-- 4) Grants
-- =====================================================================
REVOKE ALL ON FUNCTION public.trg_local_service_listing_search() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_local_service_listing_search() TO service_role;

REVOKE ALL ON FUNCTION public.trg_users_pause_service_listings_on_move() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_users_pause_service_listings_on_move() TO service_role;

REVOKE ALL ON FUNCTION public.list_service_categories() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_service_categories() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.upsert_service_listing(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_service_listing(uuid, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_service_listing_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_service_listing_status(uuid, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.confirm_service_listing_current(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_service_listing_current(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.feature_service_listing(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feature_service_listing(uuid, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_service_listing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_service_listing(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_my_service_listings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_service_listings() TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.search_local_services(text, text, integer, integer);
REVOKE ALL ON FUNCTION public.search_local_services(text, text, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_local_services(text, text, integer, integer, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.direct_neighbour_org_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.direct_neighbour_org_ids() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_direct_neighbour_org(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_direct_neighbour_org(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_access_service_listing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_service_listing(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_my_org_neighbours() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_org_neighbours() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_org_neighbour_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_org_neighbour_candidates() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_org_neighbour(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_org_neighbour(uuid, boolean) TO authenticated, service_role;

REVOKE INSERT, UPDATE, DELETE ON public.local_service_listings FROM anon, authenticated;
GRANT SELECT ON public.local_service_listings TO authenticated;
GRANT ALL ON public.local_service_listings TO service_role;

-- =====================================================================
-- 5) Verification
-- =====================================================================
DO $$
DECLARE
  missing text := '';
  n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    missing := missing || 'pg_trgm extension; ';
  END IF;

  SELECT count(*) INTO n FROM public.local_service_categories WHERE parent_slug IS NULL AND active;
  IF n < 9 THEN missing := missing || 'top-level categories (expected >= 9, got ' || n || '); '; END IF;

  SELECT count(*) INTO n FROM public.local_service_synonyms WHERE term IN ('sparky', 'loodgieter', 'welder', 'maths', 'braai');
  IF n < 5 THEN missing := missing || 'seed synonyms; '; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
    WHERE nsp.nspname = 'public' AND c.relname = 'local_service_listings' AND c.relrowsecurity
  ) THEN
    missing := missing || 'listings RLS; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'local_service_listings'
      AND column_name = 'show_to_neighbours'
  ) THEN
    missing := missing || 'show_to_neighbours; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
    WHERE nsp.nspname = 'public' AND c.relname = 'org_neighbours' AND c.relrowsecurity
  ) THEN
    missing := missing || 'org_neighbours RLS; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_neighbours_no_self'
  ) THEN
    missing := missing || 'org_neighbours_no_self; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
    WHERE nsp.nspname = 'public'
      AND p.proname = 'search_local_services'
      AND p.pronargs = 5
  ) THEN
    missing := missing || 'search_local_services(include_neighbours); ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
    WHERE nsp.nspname = 'public' AND p.proname = 'set_org_neighbour'
  ) THEN
    missing := missing || 'set_org_neighbour; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
    WHERE nsp.nspname = 'public' AND p.proname = 'can_access_service_listing'
  ) THEN
    missing := missing || 'can_access_service_listing; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
    WHERE nsp.nspname = 'public' AND p.proname = 'upsert_service_listing'
  ) THEN
    missing := missing || 'upsert_service_listing; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'zzz_pause_service_listings_on_move'
  ) THEN
    missing := missing || 'org-move pause trigger; ';
  END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION 'P4a verification failed: %', missing;
  END IF;

  RAISE NOTICE 'P4a local services directory: OK (categories, synonyms, listings, org_neighbours, search RPCs, RLS).';
END;
$$;
