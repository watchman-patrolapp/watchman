-- P4b — Local services: reviews, reports, moderation.
-- Apply in the Supabase SQL editor AFTER sql-p4a-services-directory.sql (staging first).
-- Idempotent and additive. When committed, save as:
--   platform/supabase/migrations/20261112142000_local_services_reviews.sql
-- Recreates report_community_content, list_community_reports and resolve_community_report
-- from their latest bodies (20261031020000 / 20261031050000), adding service_listing and
-- service_review branches only. Cross-org failures raise 'not found', except that a
-- verified member of a directly adjacent org may review or report a published listing
-- whose show_to_neighbours is true (P4a neighbouring-suburbs opt-in). Moderation,
-- hide, and owner-reply stay with the listing's own organisation.

-- =====================================================================
-- 1) Reviews table
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.local_service_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.local_service_listings (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  reviewer_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body text CHECK (body IS NULL OR char_length(body) <= 1000),
  used_service boolean NOT NULL DEFAULT false,
  vouch boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  hidden_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  hidden_reason text,
  owner_reply text CHECK (owner_reply IS NULL OR char_length(owner_reply) <= 600),
  owner_replied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, reviewer_user_id),
  CONSTRAINT vouch_requires_use CHECK (NOT vouch OR used_service)
);
CREATE INDEX IF NOT EXISTS local_service_reviews_listing_idx
  ON public.local_service_reviews (listing_id, created_at DESC);

ALTER TABLE public.local_service_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS local_service_reviews_select ON public.local_service_reviews;
CREATE POLICY local_service_reviews_select ON public.local_service_reviews
  FOR SELECT TO authenticated
  USING (
    reviewer_user_id = (SELECT auth.uid())
    OR (
      organization_id IN (SELECT public.current_org_ids())
      AND (status = 'published' OR public.can_moderate_resident_content(organization_id))
    )
  );

CREATE OR REPLACE FUNCTION public.trg_local_service_review_rollup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lid uuid := coalesce(NEW.listing_id, OLD.listing_id);
BEGIN
  UPDATE public.local_service_listings l
  SET avg_rating = s.avg_rating,
      rating_count = s.cnt,
      vouch_count = s.vouches
  FROM (
    SELECT
      round(avg(rating)::numeric, 2) AS avg_rating,
      count(*)::int AS cnt,
      count(*) FILTER (WHERE vouch)::int AS vouches
    FROM public.local_service_reviews
    WHERE listing_id = lid AND status = 'published'
  ) s
  WHERE l.id = lid;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS local_service_review_rollup ON public.local_service_reviews;
CREATE TRIGGER local_service_review_rollup
  AFTER INSERT OR UPDATE OR DELETE ON public.local_service_reviews
  FOR EACH ROW EXECUTE FUNCTION public.trg_local_service_review_rollup();

-- =====================================================================
-- 2) Review RPCs
-- =====================================================================
CREATE OR REPLACE FUNCTION public.upsert_service_review(
  p_listing_id uuid,
  p_rating integer,
  p_body text DEFAULT NULL,
  p_used_service boolean DEFAULT false,
  p_vouch boolean DEFAULT false
)
RETURNS public.local_service_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  l public.local_service_listings;
  row_out public.local_service_reviews;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO l FROM public.local_service_listings WHERE id = p_listing_id;
  IF l.id IS NULL OR l.status <> 'published' OR NOT public.can_access_service_listing(l.id) THEN
    RAISE EXCEPTION 'not found';
  END IF;
  IF l.owner_user_id = auth.uid() THEN
    RAISE EXCEPTION 'you cannot review your own listing';
  END IF;
  IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'please choose a rating from 1 to 5';
  END IF;
  IF NOT public.is_verified_household(auth.uid()) THEN
    RAISE EXCEPTION 'only verified households can rate services';
  END IF;
  IF (
    SELECT count(*) FROM public.local_service_reviews
    WHERE reviewer_user_id = auth.uid() AND created_at > now() - interval '24 hours'
  ) >= 10 THEN
    RAISE EXCEPTION 'review limit reached for today';
  END IF;

  INSERT INTO public.local_service_reviews (
    listing_id, organization_id, reviewer_user_id, rating, body, used_service, vouch
  )
  VALUES (
    l.id,
    l.organization_id,
    auth.uid(),
    p_rating,
    nullif(trim(p_body), ''),
    coalesce(p_used_service, false),
    coalesce(p_vouch, false) AND coalesce(p_used_service, false)
  )
  ON CONFLICT (listing_id, reviewer_user_id) DO UPDATE
    SET rating = EXCLUDED.rating,
        body = EXCLUDED.body,
        used_service = EXCLUDED.used_service,
        vouch = EXCLUDED.vouch,
        updated_at = now()
  RETURNING * INTO row_out;

  PERFORM public.notify_app_user(
    l.owner_user_id,
    'service_review',
    'New review on ' || l.title,
    repeat('★', p_rating) || coalesce(' · ' || left(p_body, 80), ''),
    '/resident/services/' || l.id
  );
  RETURN row_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.reply_to_service_review(p_review_id uuid, p_reply text)
RETURNS public.local_service_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_out public.local_service_reviews;
  listing public.local_service_listings;
  cleaned text := nullif(left(trim(p_reply), 600), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT r.* INTO row_out FROM public.local_service_reviews r WHERE r.id = p_review_id;
  IF row_out.id IS NULL OR row_out.organization_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'not found';
  END IF;
  SELECT * INTO listing FROM public.local_service_listings WHERE id = row_out.listing_id;
  IF listing.owner_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not found';
  END IF;
  IF cleaned IS NULL THEN
    RAISE EXCEPTION 'please write a short reply';
  END IF;
  UPDATE public.local_service_reviews
  SET owner_reply = cleaned, owner_replied_at = now(), updated_at = now()
  WHERE id = row_out.id
  RETURNING * INTO row_out;
  RETURN row_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.hide_service_review(p_review_id uuid, p_reason text)
RETURNS public.local_service_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_out public.local_service_reviews;
  reason_text text := nullif(trim(p_reason), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO row_out FROM public.local_service_reviews WHERE id = p_review_id;
  IF row_out.id IS NULL OR row_out.organization_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'not found';
  END IF;
  IF NOT public.can_moderate_resident_content(row_out.organization_id) THEN
    RAISE EXCEPTION 'not found';
  END IF;
  IF reason_text IS NULL THEN
    RAISE EXCEPTION 'please give a reason';
  END IF;
  UPDATE public.local_service_reviews
  SET status = 'hidden',
      hidden_by = auth.uid(),
      hidden_reason = reason_text,
      updated_at = now()
  WHERE id = row_out.id
  RETURNING * INTO row_out;
  PERFORM public.notify_app_user(
    row_out.reviewer_user_id,
    'moderation',
    'A review was hidden',
    reason_text,
    '/resident/services/' || row_out.listing_id
  );
  PERFORM public.write_staff_activity(
    'service_review_hidden',
    jsonb_build_object('review_id', row_out.id, 'listing_id', row_out.listing_id, 'reason', reason_text),
    auth.uid(),
    row_out.organization_id
  );
  RETURN row_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_my_service_review(p_review_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_out public.local_service_reviews;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO row_out FROM public.local_service_reviews WHERE id = p_review_id;
  IF row_out.id IS NULL OR row_out.reviewer_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not found';
  END IF;
  DELETE FROM public.local_service_reviews WHERE id = row_out.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_listing_reviews(p_listing_id uuid)
RETURNS TABLE (
  id uuid,
  rating smallint,
  body text,
  used_service boolean,
  vouch boolean,
  owner_reply text,
  owner_replied_at timestamptz,
  created_at timestamptz,
  reviewer_first_name text,
  reviewer_street text,
  is_mine boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  listing public.local_service_listings;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO listing FROM public.local_service_listings WHERE local_service_listings.id = p_listing_id;
  IF listing.id IS NULL OR NOT public.can_access_service_listing(p_listing_id) THEN
    RAISE EXCEPTION 'not found';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.rating,
    r.body,
    r.used_service,
    r.vouch,
    r.owner_reply,
    r.owner_replied_at,
    r.created_at,
    split_part(coalesce(u.full_name, 'Neighbour'), ' ', 1),
    public.resident_street_label(coalesce(nullif(trim(rp.home_address), ''), u.address)),
    r.reviewer_user_id = auth.uid()
  FROM public.local_service_reviews r
  JOIN public.users u ON u.id = r.reviewer_user_id
  LEFT JOIN public.resident_profiles rp ON rp.user_id = r.reviewer_user_id
  WHERE r.listing_id = listing.id
    AND (
      r.status = 'published'
      OR r.reviewer_user_id = auth.uid()
      OR public.can_moderate_resident_content(listing.organization_id)
    )
  ORDER BY r.created_at DESC
  LIMIT 100;
END;
$$;

-- =====================================================================
-- 3) Extend community reports (latest bodies + service branches only)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.report_community_content(
  p_content_type text,
  p_content_id uuid,
  p_reason text,
  p_details text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id uuid;
  new_id uuid;
  mod_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_content_type IS NULL OR p_content_type NOT IN (
    'area_broadcast', 'service_listing', 'service_review'
  ) THEN
    RAISE EXCEPTION 'this content cannot be reported yet';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN (
    'spam', 'scam', 'offensive', 'false_info', 'privacy', 'duplicate', 'other'
  ) THEN
    RAISE EXCEPTION 'please choose a reason';
  END IF;
  IF p_details IS NOT NULL AND char_length(p_details) > 1000 THEN
    RAISE EXCEPTION 'details are too long (max 1000 characters)';
  END IF;

  org_id := CASE p_content_type
    WHEN 'area_broadcast' THEN (
      SELECT b.organization_id FROM public.area_broadcasts b WHERE b.id = p_content_id
    )
    WHEN 'service_listing' THEN (
      SELECT l.organization_id FROM public.local_service_listings l WHERE l.id = p_content_id
    )
    WHEN 'service_review' THEN (
      SELECT r.organization_id FROM public.local_service_reviews r WHERE r.id = p_content_id
    )
    ELSE NULL
  END;

  IF org_id IS NULL THEN
    RAISE EXCEPTION 'content not found';
  END IF;
  IF org_id NOT IN (SELECT public.current_org_ids()) THEN
    -- Allow a report only when the caller can already see the neighbour listing.
    IF p_content_type = 'service_listing'
       AND public.can_access_service_listing(p_content_id) THEN
      NULL;
    ELSIF p_content_type = 'service_review' AND EXISTS (
      SELECT 1
      FROM public.local_service_reviews r
      WHERE r.id = p_content_id
        AND public.can_access_service_listing(r.listing_id)
    ) THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'content not found';
    END IF;
  END IF;

  IF (
    SELECT count(*) FROM public.community_content_reports r
    WHERE r.reporter_user_id = auth.uid() AND r.created_at > now() - interval '24 hours'
  ) >= 10 THEN
    RAISE EXCEPTION 'too many reports today';
  END IF;

  INSERT INTO public.community_content_reports (
    organization_id, content_type, content_id, reporter_user_id, reason, details
  )
  VALUES (org_id, p_content_type, p_content_id, auth.uid(), p_reason, nullif(trim(p_details), ''))
  ON CONFLICT DO NOTHING
  RETURNING id INTO new_id;

  IF new_id IS NULL THEN
    RAISE EXCEPTION 'you have already reported this';
  END IF;

  FOR mod_id IN
    SELECT DISTINCT g.user_id FROM public.org_capability_grants g
    WHERE g.organization_id = org_id
      AND g.capability = 'resident_moderator'
      AND g.revoked_at IS NULL
      AND (g.expires_at IS NULL OR g.expires_at > now())
      AND g.user_id <> auth.uid()
  LOOP
    PERFORM public.notify_app_user(
      mod_id, 'moderation', 'New report to review',
      replace(p_content_type, '_', ' ') || ' - ' || replace(p_reason, '_', ' '),
      '/resident/moderate'
    );
  END LOOP;

  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_community_reports(p_status text DEFAULT 'open')
RETURNS TABLE (
  content_type text,
  content_id uuid,
  report_ids uuid[],
  report_count integer,
  reasons text[],
  details text[],
  status text,
  first_reported_at timestamptz,
  last_reported_at timestamptz,
  headline text,
  body_preview text,
  author_name text,
  author_badge text,
  content_hidden_at timestamptz,
  can_hide boolean,
  reporter_ids uuid[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id uuid := public.working_organization_id();
  st text := coalesce(nullif(trim(p_status), ''), 'open');
  is_staff boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF org_id IS NULL THEN RAISE EXCEPTION 'no neighbourhood selected'; END IF;
  IF NOT public.can_moderate_resident_content(org_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF st NOT IN ('open', 'actioned', 'dismissed') THEN RAISE EXCEPTION 'unknown status'; END IF;
  is_staff := public.can_moderate_incidents();

  RETURN QUERY
  SELECT
    r.content_type,
    r.content_id,
    array_agg(r.id ORDER BY r.created_at),
    count(*)::integer,
    array_agg(DISTINCT r.reason),
    array_remove(array_agg(r.details ORDER BY r.created_at), NULL),
    st,
    min(r.created_at),
    max(r.created_at),
    max(
      CASE
        WHEN r.content_type = 'area_broadcast' THEN coalesce(nullif(trim(b.headline), ''), 'Neighbourhood notice')
        WHEN r.content_type = 'service_listing' THEN coalesce(nullif(trim(sl.title), ''), 'Service listing')
        WHEN r.content_type = 'service_review' THEN 'Service review'
        ELSE NULL
      END
    ),
    max(
      CASE
        WHEN r.content_type = 'area_broadcast' THEN left(b.body, 280)
        WHEN r.content_type = 'service_listing' THEN left(sl.description, 280)
        WHEN r.content_type = 'service_review' THEN left(sr.body, 280)
        ELSE NULL
      END
    ),
    max(
      CASE
        WHEN r.content_type = 'area_broadcast' THEN coalesce(nullif(trim(u.full_name), ''), 'Neighbourhood watch')
        WHEN r.content_type = 'service_listing' THEN coalesce(nullif(trim(slu.full_name), ''), 'Neighbour')
        WHEN r.content_type = 'service_review' THEN coalesce(nullif(trim(sru.full_name), ''), 'Neighbour')
        ELSE NULL
      END
    ),
    max(b.author_badge),
    max(
      CASE
        WHEN r.content_type = 'area_broadcast' THEN b.hidden_at
        WHEN r.content_type = 'service_listing' AND sl.status IN ('hidden', 'removed') THEN sl.moderated_at
        WHEN r.content_type = 'service_review' AND sr.status = 'hidden' THEN sr.updated_at
        ELSE NULL
      END
    ),
    bool_or(
      (r.content_type = 'area_broadcast' AND b.id IS NOT NULL
        AND (public.is_area_broadcast_staff() OR b.author_badge IS NOT NULL))
      OR (r.content_type = 'service_listing' AND sl.id IS NOT NULL)
      OR (r.content_type = 'service_review' AND sr.id IS NOT NULL)
    ),
    CASE WHEN is_staff THEN array_remove(array_agg(r.reporter_user_id), NULL) ELSE NULL END
  FROM public.community_content_reports r
  LEFT JOIN public.area_broadcasts b
    ON r.content_type = 'area_broadcast' AND b.id = r.content_id AND b.organization_id = r.organization_id
  LEFT JOIN public.users u ON u.id = b.author_id
  LEFT JOIN public.local_service_listings sl
    ON r.content_type = 'service_listing' AND sl.id = r.content_id AND sl.organization_id = r.organization_id
  LEFT JOIN public.users slu ON slu.id = sl.owner_user_id
  LEFT JOIN public.local_service_reviews sr
    ON r.content_type = 'service_review' AND sr.id = r.content_id AND sr.organization_id = r.organization_id
  LEFT JOIN public.users sru ON sru.id = sr.reviewer_user_id
  WHERE r.organization_id = org_id
    AND r.status = st
  GROUP BY r.content_type, r.content_id
  ORDER BY max(r.created_at) DESC
  LIMIT 100;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_community_report(
  p_report_id uuid,
  p_status text,
  p_note text DEFAULT NULL,
  p_hide_content boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.community_content_reports;
  cleaned_note text := nullif(trim(p_note), '');
  n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO r FROM public.community_content_reports WHERE id = p_report_id FOR UPDATE;
  IF r.id IS NULL OR r.organization_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'report not found';
  END IF;
  IF NOT public.can_moderate_resident_content(r.organization_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('actioned', 'dismissed') THEN
    RAISE EXCEPTION 'status must be actioned or dismissed';
  END IF;
  IF cleaned_note IS NOT NULL AND char_length(cleaned_note) > 1000 THEN
    RAISE EXCEPTION 'note is too long';
  END IF;
  IF r.status <> 'open' THEN
    RAISE EXCEPTION 'report already handled';
  END IF;

  IF coalesce(p_hide_content, false) THEN
    IF r.content_type = 'area_broadcast' THEN
      PERFORM public.hide_area_broadcast(r.content_id, left(cleaned_note, 300));
    ELSIF r.content_type = 'service_listing' THEN
      PERFORM public.set_service_listing_status(r.content_id, 'hidden', left(coalesce(cleaned_note, 'Reported'), 300));
    ELSIF r.content_type = 'service_review' THEN
      PERFORM public.hide_service_review(r.content_id, left(coalesce(cleaned_note, 'Reported'), 300));
    ELSE
      RAISE EXCEPTION 'this content cannot be hidden yet';
    END IF;
  END IF;

  UPDATE public.community_content_reports
  SET status = p_status, handled_by = auth.uid(), handled_at = now(), resolution_note = cleaned_note
  WHERE content_type = r.content_type
    AND content_id = r.content_id
    AND organization_id = r.organization_id
    AND status = 'open';
  GET DIAGNOSTICS n = ROW_COUNT;

  PERFORM public.write_staff_activity(
    'content_report_resolved',
    jsonb_build_object(
      'content_type', r.content_type,
      'content_id', r.content_id,
      'status', p_status,
      'reports', n,
      'hidden', coalesce(p_hide_content, false),
      'note', cleaned_note
    ) || CASE WHEN NOT public.can_moderate_incidents()
              THEN jsonb_build_object('capability', 'resident_moderator')
              ELSE '{}'::jsonb END,
    auth.uid(),
    r.organization_id
  );

  RETURN n;
END;
$$;

-- =====================================================================
-- 4) Grants
-- =====================================================================
REVOKE ALL ON FUNCTION public.trg_local_service_review_rollup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_local_service_review_rollup() TO service_role;

REVOKE ALL ON FUNCTION public.upsert_service_review(uuid, integer, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_service_review(uuid, integer, text, boolean, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reply_to_service_review(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reply_to_service_review(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.hide_service_review(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hide_service_review(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.delete_my_service_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_service_review(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_listing_reviews(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_listing_reviews(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.report_community_content(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_community_content(text, uuid, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_community_reports(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_community_reports(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.resolve_community_report(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_community_report(uuid, text, text, boolean) TO authenticated, service_role;

REVOKE INSERT, UPDATE, DELETE ON public.local_service_reviews FROM anon, authenticated;
GRANT SELECT ON public.local_service_reviews TO authenticated;
GRANT ALL ON public.local_service_reviews TO service_role;

-- =====================================================================
-- 5) Verification
-- =====================================================================
DO $$
DECLARE
  missing text := '';
BEGIN
  IF to_regclass('public.local_service_listings') IS NULL THEN
    RAISE EXCEPTION 'P4b verification failed: apply sql-p4a-services-directory.sql first';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
    WHERE nsp.nspname = 'public' AND c.relname = 'local_service_reviews' AND c.relrowsecurity
  ) THEN
    missing := missing || 'reviews RLS; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
    WHERE nsp.nspname = 'public' AND p.proname = 'upsert_service_review'
  ) THEN
    missing := missing || 'upsert_service_review; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
    WHERE nsp.nspname = 'public' AND p.proname = 'report_community_content'
  ) THEN
    missing := missing || 'report_community_content; ';
  END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION 'P4b verification failed: %', missing;
  END IF;

  RAISE NOTICE 'P4b local services reviews: OK (reviews, rollup, report/moderation RPCs).';
END;
$$;
