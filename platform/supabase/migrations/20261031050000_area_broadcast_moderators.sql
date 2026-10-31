-- P1 (1/2) - Resident moderators & street reps: area broadcasts.
-- NEW_FEATURES_BLUEPRINT section 6.5 (+ 12.7 checklist), D2 quota.
--
-- Purely additive: one new nullable column (author_badge). Existing notice rows are
-- not updated or deleted. Functions below are CREATE OR REPLACE (or DROP + CREATE
-- where the return type grows, exactly as G1 did).
--
-- Latest definitions copied forward (only the P1 changes were made):
--   can_post_area_broadcast        20260816002000_away_broadcasts_civic.sql
--   post_area_broadcast            20260818030000_area_broadcast_home_windows.sql
--   list_area_broadcasts           20261003001000_area_broadcast_hide_restore.sql (G1)
--   list_hidden_area_broadcasts    20261003001000 (G1)
--   hide/restore_area_broadcast    20261003001000 (G1)
--   trg_log_watch_staff_broadcast  20260819020100_watch_staff_activity_triggers.sql
-- is_area_broadcast_staff (G1) is NOT replaced: it already covers admin/tech via
-- is_global_app_staff(), plus nw_admin / committee.
--
-- New: list_community_reports, resolve_community_report (moderation queue).
--
-- Audit rows for capability holders carry a 'capability' key so the existing
-- list_watch_staff_activity filter (G2) shows them without replacing it.

ALTER TABLE public.area_broadcasts
  ADD COLUMN IF NOT EXISTS author_badge text;

ALTER TABLE public.area_broadcasts
  DROP CONSTRAINT IF EXISTS area_broadcasts_author_badge_check;
ALTER TABLE public.area_broadcasts
  ADD CONSTRAINT area_broadcasts_author_badge_check
  CHECK (author_badge IS NULL OR author_badge IN ('street_rep', 'moderator'));

-- ---------------------------------------------------------------------------
-- 1) Who may post: existing role list + resident_broadcaster in the working org
--    (has_org_capability treats resident_moderator as including broadcaster).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_post_area_broadcast()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_global_app_staff()
    OR public.is_platform_staff()
    OR EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND replace(lower(trim(cu.role::text)), '-', '_') IN (
          'admin',
          'technical_support',
          'nw_admin',
          'committee'
        )
    )
    OR public.has_org_capability('resident_broadcaster');
$$;

-- ---------------------------------------------------------------------------
-- 2) post_area_broadcast: 20260818030000 body + capability org check, D2 quota,
--    author_badge.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_area_broadcast(p_headline text, p_body text)
RETURNS public.area_broadcasts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id uuid;
  row_out public.area_broadcasts;
  cleaned_headline text;
  cleaned_body text;
  is_staff boolean;
  badge text := NULL;
  posted_today integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.can_post_area_broadcast() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  cleaned_headline := trim(p_headline);
  cleaned_body := trim(p_body);
  IF cleaned_headline = '' THEN
    RAISE EXCEPTION 'headline is required';
  END IF;
  IF char_length(cleaned_headline) > 120 THEN
    RAISE EXCEPTION 'headline is too long';
  END IF;
  IF cleaned_body = '' THEN
    RAISE EXCEPTION 'message is required';
  END IF;
  IF char_length(cleaned_body) > 4000 THEN
    RAISE EXCEPTION 'message is too long';
  END IF;

  SELECT public.working_organization_id() INTO org_id;

  IF org_id IS NULL THEN
    SELECT o.id INTO org_id
    FROM public.organizations o
    WHERE o.id IN (SELECT public.current_org_ids())
    ORDER BY o.name
    LIMIT 1;
  END IF;

  IF org_id IS NULL THEN
    RAISE EXCEPTION 'no neighbourhood selected';
  END IF;

  is_staff := public.is_area_broadcast_staff()
    OR EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND replace(lower(trim(cu.role::text)), '-', '_') IN ('admin', 'technical_support')
    );

  IF NOT is_staff THEN
    -- Capability holders post only into the org that granted the capability.
    IF NOT public.has_org_capability('resident_broadcaster', org_id) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
    badge := CASE
      WHEN public.has_org_capability('resident_moderator', org_id) THEN 'moderator'
      ELSE 'street_rep'
    END;
    -- D2: 3 notices per rolling 24 hours for capability holders. Staff unlimited.
    SELECT count(*) INTO posted_today
    FROM public.area_broadcasts
    WHERE author_id = auth.uid()
      AND created_at > now() - interval '24 hours';
    IF posted_today >= 3 THEN
      RAISE EXCEPTION 'daily notice limit reached (3 per 24 hours)';
    END IF;
  END IF;

  INSERT INTO public.area_broadcasts (organization_id, author_id, headline, body, expires_at, author_badge)
  VALUES (org_id, auth.uid(), cleaned_headline, cleaned_body, now() + interval '24 hours', badge)
  RETURNING * INTO row_out;

  RETURN row_out;
END;
$$;

-- Remaining notices today for the caller (null = unlimited / staff).
CREATE OR REPLACE FUNCTION public.my_area_broadcast_quota()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  posted integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF public.is_area_broadcast_staff()
     OR EXISTS (
       SELECT 1 FROM public.users cu
       WHERE cu.id = auth.uid()
         AND replace(lower(trim(cu.role::text)), '-', '_') IN ('admin', 'technical_support')
     ) THEN
    RETURN NULL;
  END IF;
  IF NOT public.has_org_capability('resident_broadcaster') THEN
    RETURN 0;
  END IF;
  SELECT count(*) INTO posted
  FROM public.area_broadcasts
  WHERE author_id = auth.uid()
    AND created_at > now() - interval '24 hours';
  RETURN GREATEST(0, 3 - posted);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) list_area_broadcasts: G1 body + author_badge. Return type grows => DROP.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_area_broadcasts(integer);
CREATE FUNCTION public.list_area_broadcasts(p_limit integer DEFAULT 8)
RETURNS TABLE (
  id uuid,
  headline text,
  body text,
  created_at timestamptz,
  expires_at timestamptz,
  author_name text,
  pinned_until timestamptz,
  activity_until timestamptz,
  edited_at timestamptz,
  author_id uuid,
  author_badge text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id,
    coalesce(nullif(trim(b.headline), ''), 'Neighbourhood notice'),
    b.body,
    b.created_at,
    b.expires_at,
    coalesce(nullif(trim(u.full_name), ''), 'Neighbourhood watch'),
    b.created_at + interval '12 hours',
    b.created_at + interval '24 hours',
    b.edited_at,
    b.author_id,
    b.author_badge
  FROM public.area_broadcasts b
  LEFT JOIN public.users u ON u.id = b.author_id
  WHERE b.organization_id = public.working_organization_id()
    AND b.created_at >= now() - interval '24 hours'
    AND b.hidden_at IS NULL
  ORDER BY b.created_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 8), 30));
$$;

-- G1 body + author_badge. Staff see every hidden notice in the working org;
-- resident moderators see only hidden capability-authored notices.
DROP FUNCTION IF EXISTS public.list_hidden_area_broadcasts(integer);
CREATE FUNCTION public.list_hidden_area_broadcasts(p_limit integer DEFAULT 30)
RETURNS TABLE (
  id uuid,
  headline text,
  body text,
  created_at timestamptz,
  expires_at timestamptz,
  author_name text,
  pinned_until timestamptz,
  activity_until timestamptz,
  edited_at timestamptz,
  author_id uuid,
  hidden_at timestamptz,
  hidden_reason text,
  author_badge text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_staff boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  is_staff := public.is_area_broadcast_staff();
  IF NOT (is_staff OR public.has_org_capability('resident_moderator')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    coalesce(nullif(trim(b.headline), ''), 'Neighbourhood notice'),
    b.body,
    b.created_at,
    b.expires_at,
    coalesce(nullif(trim(u.full_name), ''), 'Neighbourhood watch'),
    b.created_at + interval '12 hours',
    b.created_at + interval '24 hours',
    b.edited_at,
    b.author_id,
    b.hidden_at,
    b.hidden_reason,
    b.author_badge
  FROM public.area_broadcasts b
  LEFT JOIN public.users u ON u.id = b.author_id
  WHERE b.organization_id = public.working_organization_id()
    AND b.hidden_at IS NOT NULL
    AND (is_staff OR b.author_badge IS NOT NULL)
  ORDER BY b.hidden_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 30), 30));
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) hide / restore: G1 bodies + resident-moderator clause for
--    capability-authored notices (author_badge IS NOT NULL). Never staff notices.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hide_area_broadcast(p_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b public.area_broadcasts;
  cleaned_reason text;
  was_hidden boolean;
  is_staff boolean;
  via_capability boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO b
  FROM public.area_broadcasts
  WHERE id = p_id
  FOR UPDATE;

  IF b.id IS NULL OR b.organization_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'notice not found';
  END IF;

  is_staff := public.is_area_broadcast_staff();
  IF NOT (b.author_id = auth.uid() OR is_staff) THEN
    IF b.author_badge IS NOT NULL
       AND public.has_org_capability('resident_moderator', b.organization_id) THEN
      via_capability := true;
    ELSE
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;

  cleaned_reason := nullif(trim(p_reason), '');
  IF cleaned_reason IS NOT NULL AND char_length(cleaned_reason) > 300 THEN
    RAISE EXCEPTION 'reason is too long';
  END IF;

  was_hidden := b.hidden_at IS NOT NULL;

  UPDATE public.area_broadcasts
  SET
    hidden_at = now(),
    hidden_by = auth.uid(),
    hidden_reason = cleaned_reason
  WHERE id = p_id;

  PERFORM public.write_staff_activity(
    'area_broadcast_hidden',
    jsonb_build_object(
      'broadcast_id', b.id,
      'headline', left(coalesce(b.headline, ''), 160),
      'reason', cleaned_reason,
      'author_badge', b.author_badge
    ) || CASE WHEN via_capability
              THEN jsonb_build_object('capability', 'resident_moderator')
              ELSE '{}'::jsonb END,
    auth.uid(),
    b.organization_id
  );

  IF NOT was_hidden AND b.author_id IS NOT NULL AND b.author_id <> auth.uid() THEN
    PERFORM public.notify_app_user(
      b.author_id,
      'moderation',
      'Your notice was hidden',
      coalesce(cleaned_reason, nullif(trim(b.headline), '')),
      '/resident'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_area_broadcast(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b public.area_broadcasts;
  via_capability boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO b
  FROM public.area_broadcasts
  WHERE id = p_id
  FOR UPDATE;

  IF b.id IS NULL OR b.organization_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'notice not found';
  END IF;

  IF NOT public.is_area_broadcast_staff() THEN
    IF b.author_badge IS NOT NULL
       AND public.has_org_capability('resident_moderator', b.organization_id) THEN
      via_capability := true;
    ELSE
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;
  IF b.hidden_at IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.area_broadcasts
  SET
    hidden_at = NULL,
    hidden_by = NULL,
    hidden_reason = NULL
  WHERE id = p_id;

  PERFORM public.write_staff_activity(
    'area_broadcast_restored',
    jsonb_build_object('broadcast_id', b.id)
      || CASE WHEN via_capability
              THEN jsonb_build_object('capability', 'resident_moderator')
              ELSE '{}'::jsonb END,
    auth.uid(),
    b.organization_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Audit: also log capability-authored notices (20260819020100 body + badge).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_log_watch_staff_broadcast()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role text;
BEGIN
  SELECT replace(lower(trim(role::text)), '-', '_')
    INTO actor_role
  FROM public.users
  WHERE id = NEW.author_id;

  IF NOT public.is_watch_local_staff_role(actor_role) AND NEW.author_badge IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.write_staff_activity(
    'area_broadcast',
    jsonb_build_object(
      'broadcast_id', NEW.id,
      'headline', left(coalesce(NEW.headline, ''), 160),
      'body_preview', left(coalesce(NEW.body, ''), 200),
      'author_badge', NEW.author_badge
    ) || CASE WHEN NEW.author_badge IS NOT NULL
              THEN jsonb_build_object('capability',
                     CASE NEW.author_badge WHEN 'moderator' THEN 'resident_moderator' ELSE 'resident_broadcaster' END)
              ELSE '{}'::jsonb END,
    NEW.author_id,
    NEW.organization_id
  );
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) Moderation queue. Grouped per reported item. Reporter identities are
--    returned only to incident staff (POPIA 6.9); resident moderators get counts.
-- ---------------------------------------------------------------------------
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF org_id IS NULL THEN
    RAISE EXCEPTION 'no neighbourhood selected';
  END IF;
  IF NOT public.can_moderate_resident_content(org_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF st NOT IN ('open', 'actioned', 'dismissed') THEN
    RAISE EXCEPTION 'unknown status';
  END IF;
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
    max(CASE WHEN r.content_type = 'area_broadcast'
             THEN coalesce(nullif(trim(b.headline), ''), 'Neighbourhood notice') END),
    max(CASE WHEN r.content_type = 'area_broadcast' THEN left(b.body, 280) END),
    max(CASE WHEN r.content_type = 'area_broadcast'
             THEN coalesce(nullif(trim(u.full_name), ''), 'Neighbourhood watch') END),
    max(b.author_badge),
    max(b.hidden_at),
    bool_or(
      r.content_type = 'area_broadcast' AND b.id IS NOT NULL
      AND (public.is_area_broadcast_staff() OR b.author_badge IS NOT NULL)
    ),
    CASE WHEN is_staff THEN array_remove(array_agg(r.reporter_user_id), NULL) ELSE NULL END
  FROM public.community_content_reports r
  LEFT JOIN public.area_broadcasts b
    ON r.content_type = 'area_broadcast' AND b.id = r.content_id AND b.organization_id = r.organization_id
  LEFT JOIN public.users u ON u.id = b.author_id
  WHERE r.organization_id = org_id
    AND r.status = st
  GROUP BY r.content_type, r.content_id
  ORDER BY max(r.created_at) DESC
  LIMIT 100;
END;
$$;

-- Resolves every open report on the same item. p_hide_content = true hides the
-- item through its own hide RPC (same permission checks apply).
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

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

-- ---------------------------------------------------------------------------
-- 7) Grants (convention: REVOKE FROM PUBLIC, anon; client RPCs -> authenticated
--    + service_role; trigger function -> service_role only)
-- ---------------------------------------------------------------------------
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.can_post_area_broadcast()',
    'public.post_area_broadcast(text, text)',
    'public.my_area_broadcast_quota()',
    'public.list_area_broadcasts(integer)',
    'public.list_hidden_area_broadcasts(integer)',
    'public.hide_area_broadcast(uuid, text)',
    'public.restore_area_broadcast(uuid)',
    'public.list_community_reports(text)',
    'public.resolve_community_report(uuid, text, text, boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.trg_log_watch_staff_broadcast() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_watch_staff_broadcast() TO service_role;

-- area_broadcasts / community_content_reports stay RPC-only for writes (G1 / P0b).
REVOKE INSERT, UPDATE, DELETE ON TABLE public.area_broadcasts FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_content_reports FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verification (read-only, run manually)
-- ---------------------------------------------------------------------------
-- PRE:  SELECT to_regclass('public.org_capability_grants'), to_regclass('public.community_content_reports'); -- both not NULL
--       SELECT count(*) FROM public.area_broadcasts;  -- note the number
-- POST: SELECT column_name FROM information_schema.columns
--         WHERE table_name = 'area_broadcasts' AND column_name = 'author_badge';  -- 1 row
--       SELECT count(*) FROM public.area_broadcasts;  -- same number as PRE
--       SELECT count(*) FROM public.area_broadcasts WHERE author_badge IS NOT NULL;  -- 0
--       SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
--       WHERE p.proname IN ('post_area_broadcast','list_area_broadcasts','list_hidden_area_broadcasts',
--         'hide_area_broadcast','restore_area_broadcast','list_community_reports',
--         'resolve_community_report','my_area_broadcast_quota');  -- anon false everywhere