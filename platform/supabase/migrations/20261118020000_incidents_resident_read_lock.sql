-- =============================================================================
-- 20261118020000_incidents_resident_read_lock.sql
-- Residents can no longer read other people's incidents or incident photos.
--
-- Additive and idempotent: safe to re-run. Changes NO rows. It only replaces
-- policies on public.incidents, and two storage helper functions used by the
-- incident-photos policies.
--
-- Who can read public.incidents after this file:
--   - incidents_select_org: members of the incident's watch (current_org_ids())
--     who ALSO have a watch role (public.can_view_criminal_intelligence():
--     volunteer, patroller, investigator, committee, nw_admin, admin,
--     technical_support, security_admin, city_admin, or global app staff).
--     Residents, the legacy 'user' role and blank roles are out.
--   - incidents_select_own (unchanged): the submitter / reporter of the row.
--     Residents need it: "Your reports" lists their own rows, and the resident
--     report and SOS flows insert with RETURNING id.
-- INSERT is unchanged (any member of the watch), so resident reports, tips
-- and SOS keep working.
-- UPDATE and DELETE: same rule as read (watch role, or your own row), still
-- limited to your watch. Before, any watch member, including residents, could
-- update or delete any incident in the watch.
--
-- incident-photos (private bucket):
--   - read: global/platform staff; watch role in the incident's watch; or the
--     incident's own submitter/reporter (also for incidents with no watch).
--   - upload: watch role in the incident's watch, or the incident's own
--     submitter/reporter. Residents can still attach photos to their own report.
--
-- Not changed (SECURITY DEFINER RPCs that read incidents on purpose and bypass
-- RLS): list_resident_neighbourhood_activity (resident activity feed),
-- list_sos_board_alerts, widget_* and car_* RPCs, security_partner_* RPCs,
-- approve/reject/admin_delete, report_community_content/list_community_reports.
--
-- Requires: 20261021005000 (can_view_criminal_intelligence), 20260820060000
-- (incident_in_caller_orgs), 20261106210000 (storage_incident_readable).
-- Run the whole file at once in the Supabase SQL editor. It is one transaction:
-- if the verification at the end fails, nothing in this file is kept.
-- =============================================================================

-- 0) Preconditions ------------------------------------------------------------
DO $pre$
DECLARE
  missing text := '';
  fn text;
  col text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.can_view_criminal_intelligence()',
    'public.current_org_ids()',
    'public.is_global_app_staff()',
    'public.is_platform_staff()',
    'public.try_uuid(text)',
    'public.incident_in_caller_orgs(uuid)',
    'public.storage_incident_readable(text)',
    'public.storage_incident_writable(text)'
  ]
  LOOP
    IF to_regprocedure(fn) IS NULL THEN
      missing := missing || fn || '; ';
    END IF;
  END LOOP;

  FOREACH col IN ARRAY ARRAY['organization_id', 'reporter_id', 'submitted_by']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'incidents' AND column_name = col
    ) THEN
      missing := missing || 'incidents.' || col || '; ';
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'incident_photos_authenticated_select'
      AND qual ILIKE '%storage_incident_readable%'
  ) THEN
    missing := missing || 'storage policy incident_photos_authenticated_select (run 20261106210000 first); ';
  END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION 'Incidents resident lock: missing prerequisites: %. Nothing was changed.', missing;
  END IF;
END
$pre$;

-- 1) public.incidents policies --------------------------------------------------
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS incidents_select_org ON public.incidents;
CREATE POLICY incidents_select_org ON public.incidents
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT public.current_org_ids())
    AND public.can_view_criminal_intelligence()
  );

-- Kept as in 20260815051000 (recreated so a re-run always ends in the same state).
DROP POLICY IF EXISTS incidents_select_own ON public.incidents;
CREATE POLICY incidents_select_own ON public.incidents
  FOR SELECT TO authenticated
  USING (
    reporter_id::text = auth.uid()::text
    OR submitted_by::text = auth.uid()::text
  );

DROP POLICY IF EXISTS incidents_update_org ON public.incidents;
CREATE POLICY incidents_update_org ON public.incidents
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (SELECT public.current_org_ids())
    AND (
      public.can_view_criminal_intelligence()
      OR reporter_id::text = auth.uid()::text
      OR submitted_by::text = auth.uid()::text
    )
  )
  WITH CHECK (organization_id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS incidents_delete_org ON public.incidents;
CREATE POLICY incidents_delete_org ON public.incidents
  FOR DELETE TO authenticated
  USING (
    organization_id IN (SELECT public.current_org_ids())
    AND (
      public.can_view_criminal_intelligence()
      OR reporter_id::text = auth.uid()::text
      OR submitted_by::text = auth.uid()::text
    )
  );

-- incidents_insert_org is left exactly as it is.

-- 2) incident-photos helpers ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.storage_incident_readable(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_global_app_staff()
    OR public.is_platform_staff()
    OR (
      public.can_view_criminal_intelligence()
      AND public.incident_in_caller_orgs(public.try_uuid((storage.foldername(p_name))[1]))
    )
    OR EXISTS (
      SELECT 1
      FROM public.incidents i
      WHERE i.id = public.try_uuid((storage.foldername(p_name))[1])
        AND auth.uid() IS NOT NULL
        AND (
          i.organization_id IS NULL
          OR i.organization_id IN (SELECT public.current_org_ids())
        )
        AND (
          i.reporter_id::text = auth.uid()::text
          OR i.submitted_by::text = auth.uid()::text
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.storage_incident_writable(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (
      public.can_view_criminal_intelligence()
      AND public.incident_in_caller_orgs(public.try_uuid((storage.foldername(p_name))[1]))
    )
    OR EXISTS (
      SELECT 1
      FROM public.incidents i
      WHERE i.id = public.try_uuid((storage.foldername(p_name))[1])
        AND auth.uid() IS NOT NULL
        AND (
          i.organization_id IS NULL
          OR i.organization_id IN (SELECT public.current_org_ids())
        )
        AND (
          i.reporter_id::text = auth.uid()::text
          OR i.submitted_by::text = auth.uid()::text
        )
    );
$$;

REVOKE ALL ON FUNCTION public.storage_incident_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_incident_readable(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.storage_incident_writable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_incident_writable(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- 3) Verification -----------------------------------------------------------------
DO $verify$
DECLARE
  problems text := '';
  r record;
  fn_def text;
BEGIN
  IF NOT (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'incidents') THEN
    problems := problems || 'RLS is off on incidents; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'incidents' AND policyname = 'incidents_select_org'
      AND qual LIKE '%can_view_criminal_intelligence%' AND qual LIKE '%current_org_ids%'
  ) THEN
    problems := problems || 'incidents_select_org missing role gate; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'incidents' AND policyname = 'incidents_select_own'
      AND qual LIKE '%reporter_id%' AND qual LIKE '%submitted_by%'
  ) THEN
    problems := problems || 'incidents_select_own missing; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'incidents' AND policyname = 'incidents_insert_org'
  ) THEN
    problems := problems || 'incidents_insert_org missing (residents could not submit); ';
  END IF;

  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'incidents' AND policyname IN ('incidents_update_org', 'incidents_delete_org')
      AND qual NOT LIKE '%can_view_criminal_intelligence%'
  LOOP
    problems := problems || r.policyname || ' missing role gate; ';
  END LOOP;

  -- Any other permissive read policy would re-open incidents to residents.
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'incidents'
      AND permissive = 'PERMISSIVE'
      AND cmd IN ('SELECT', 'ALL')
      AND policyname NOT IN ('incidents_select_org', 'incidents_select_own')
  LOOP
    problems := problems || 'unexpected read policy on incidents: ' || r.policyname || '; ';
  END LOOP;

  fn_def := pg_get_functiondef('public.storage_incident_readable(text)'::regprocedure);
  IF fn_def NOT LIKE '%can_view_criminal_intelligence()%' OR fn_def NOT LIKE '%reporter_id%' THEN
    problems := problems || 'storage_incident_readable not gated; ';
  END IF;
  fn_def := pg_get_functiondef('public.storage_incident_writable(text)'::regprocedure);
  IF fn_def NOT LIKE '%can_view_criminal_intelligence()%' OR fn_def NOT LIKE '%reporter_id%' THEN
    problems := problems || 'storage_incident_writable not gated; ';
  END IF;
  IF public.storage_incident_readable('not-a-uuid/file.jpg') IS DISTINCT FROM false THEN
    problems := problems || 'storage_incident_readable accepted a bad path; ';
  END IF;

  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND permissive = 'PERMISSIVE'
      AND cmd IN ('SELECT', 'ALL')
      AND (qual ILIKE '%incident-photos%' OR qual IS NULL)
      AND coalesce(qual, '') NOT ILIKE '%storage_incident_readable%'
      AND roles && ARRAY['authenticated', 'anon', 'public']::name[]
  LOOP
    problems := problems || 'storage read policy bypasses incident gate: ' || r.policyname || '; ';
  END LOOP;

  IF has_function_privilege('anon', 'public.storage_incident_readable(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.storage_incident_writable(text)', 'EXECUTE') THEN
    problems := problems || 'anon can execute incident storage helpers; ';
  END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'Incidents resident lock: verification failed: %', problems;
  END IF;

  RAISE NOTICE 'Incidents resident lock: OK (residents read only their own incidents and photos).';
END
$verify$;
