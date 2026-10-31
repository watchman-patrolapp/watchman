-- P0b (1/2) - Generic community content reports. NEW_FEATURES_BLUEPRINT sections 5.2, 5.5, 12.7.
--
-- Purely additive: one new table, its indexes, one new SELECT policy (created here),
-- two new functions. No existing rows, functions or policies are changed.
-- Existing helpers it CALLS (not re-created): working_organization_id, current_org_ids,
-- can_moderate_incidents [20260820060000], has_org_capability [P0a 20261031010000],
-- notify_app_user [G6 20261030010000].
--
-- Deviations from the 5.5 draft:
--   * Only the 'area_broadcast' branch ships now (the other content tables don't exist yet;
--     later migrations CREATE OR REPLACE report_community_content as they land).
--   * Duplicate open report -> friendly error 'you have already reported this' (the draft
--     silently returned NULL). Unknown content type / reason -> friendly errors.
--   * Moderators are notified only when a new row is inserted, and never the reporter.
--   * can_moderate_resident_content is wrapped in coalesce(..., false) so it never returns NULL.

-- ---------------------------------------------------------------------------
-- 1) Table + indexes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.community_content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN (
    'area_broadcast', 'service_listing', 'service_review',
    'lost_found', 'event'
  )),
  content_id uuid NOT NULL,
  reporter_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('spam', 'scam', 'offensive', 'false_info', 'privacy', 'duplicate', 'other')),
  details text CHECK (details IS NULL OR char_length(details) <= 1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  handled_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  handled_at timestamptz,
  resolution_note text CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One open report per reporter per item (prevents report-spamming).
CREATE UNIQUE INDEX IF NOT EXISTS community_reports_one_open_uidx
  ON public.community_content_reports (content_type, content_id, reporter_user_id)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS community_reports_org_open_idx
  ON public.community_content_reports (organization_id, created_at DESC)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS community_reports_reporter_created_idx
  ON public.community_content_reports (reporter_user_id, created_at DESC);

ALTER TABLE public.community_content_reports ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2) Who may moderate resident content in an org
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_moderate_resident_content(p_org_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    COALESCE(p_org_id, public.working_organization_id()) IN (SELECT public.current_org_ids())
    AND (
      public.can_moderate_incidents()   -- admin, tech, nw_admin, committee, city_admin + platform
      OR public.has_org_capability('resident_moderator', COALESCE(p_org_id, public.working_organization_id()))
    ),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- 3) RLS: reporter sees own reports; moderators of that org see the org's reports.
--    No INSERT/UPDATE/DELETE policies: writes go through RPCs only.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS community_reports_select ON public.community_content_reports;
CREATE POLICY community_reports_select ON public.community_content_reports
  FOR SELECT TO authenticated
  USING (
    reporter_user_id = (SELECT auth.uid())
    OR public.can_moderate_resident_content(organization_id)
  );

-- ---------------------------------------------------------------------------
-- 4) report_community_content (area_broadcast branch only for now)
-- ---------------------------------------------------------------------------
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
  IF p_content_type IS NULL OR p_content_type NOT IN ('area_broadcast') THEN
    RAISE EXCEPTION 'this content cannot be reported yet';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('spam', 'scam', 'offensive', 'false_info', 'privacy', 'duplicate', 'other') THEN
    RAISE EXCEPTION 'please choose a reason';
  END IF;
  IF p_details IS NOT NULL AND char_length(p_details) > 1000 THEN
    RAISE EXCEPTION 'details are too long (max 1000 characters)';
  END IF;

  -- Resolve the org from the content row (never trust the client).
  -- Every table referenced here must already exist (the CASE is planned as a whole);
  -- later migrations add service_listing / service_review / lost_found / event branches.
  org_id := CASE p_content_type
    WHEN 'area_broadcast' THEN (SELECT b.organization_id FROM public.area_broadcasts b WHERE b.id = p_content_id)
    ELSE NULL
  END;

  -- Cross-org (or missing) content always reads as not found.
  IF org_id IS NULL OR org_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'content not found';
  END IF;

  -- Simple rate limit: 10 reports / 24h per user.
  IF (SELECT count(*) FROM public.community_content_reports r
      WHERE r.reporter_user_id = auth.uid() AND r.created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'too many reports today';
  END IF;

  INSERT INTO public.community_content_reports (organization_id, content_type, content_id, reporter_user_id, reason, details)
  VALUES (org_id, p_content_type, p_content_id, auth.uid(), p_reason, nullif(trim(p_details), ''))
  ON CONFLICT DO NOTHING
  RETURNING id INTO new_id;

  IF new_id IS NULL THEN
    RAISE EXCEPTION 'you have already reported this';
  END IF;

  -- Notify resident moderators of this org (never the reporter).
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

-- resolve_community_report / list_community_reports ship with the moderation queue (P1).

-- ---------------------------------------------------------------------------
-- 5) Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.can_moderate_resident_content(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_moderate_resident_content(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.report_community_content(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_community_content(text, uuid, text, text) TO authenticated, service_role;

REVOKE ALL ON public.community_content_reports FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.community_content_reports FROM anon, authenticated;  -- RPC-only writes
GRANT SELECT ON public.community_content_reports TO authenticated;
GRANT ALL ON public.community_content_reports TO service_role;

-- ---------------------------------------------------------------------------
-- Verification (run manually in the SQL editor; read-only)
-- ---------------------------------------------------------------------------
-- PRE-CHECKS (before applying):
--   -- helpers this migration calls must exist (expect 5 rows):
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid)
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
--   WHERE p.proname IN ('working_organization_id','current_org_ids','can_moderate_incidents',
--     'has_org_capability','notify_app_user')
--   ORDER BY 1;
--   SELECT to_regclass('public.org_capability_grants');      -- not NULL (P0a applied)
--   SELECT to_regclass('public.community_content_reports');  -- NULL (not created yet)
--   SELECT (SELECT count(*) FROM public.area_broadcasts) AS area_broadcasts,
--          (SELECT count(*) FROM public.app_notifications) AS app_notifications;
--
-- POST-CHECKS (after applying):
--   SELECT to_regclass('public.community_content_reports');  -- not NULL
--   SELECT count(*) FROM public.community_content_reports;    -- 0
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.community_content_reports'::regclass; -- true
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'community_content_reports'; -- 1 row, SELECT
--   SELECT p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
--   WHERE p.proname IN ('can_moderate_resident_content','report_community_content');  -- anon false, authenticated true
--   SELECT privilege_type FROM information_schema.role_table_grants
--   WHERE table_name = 'community_content_reports' AND grantee = 'authenticated';  -- SELECT only
--   -- baseline counts unchanged (same query as pre-check).
