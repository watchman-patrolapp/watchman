-- =============================================================================
-- 20261118030000_incident_evidence_profile_incidents_lock.sql
-- Lock incident_evidence (was world-readable, anon included), profile_incidents
-- and incident_acks to the same people who can see the incident.
--
-- Additive and idempotent: safe to re-run. Changes NO rows. It only replaces
-- policies on three tables and tightens one function grant.
--
-- incident_evidence (columns used by the app: id, incident_id, category,
-- description, metadata, media_urls, submitted_by, created_at). Media files are
-- in the incident-photos bucket, already locked by 20261118020000.
--   Drops the 3 dashboard policies ("Enable read access for all users" USING true
--   for {public}, "Enable insert for authenticated users", "Enable update own
--   evidence") and replaces them with authenticated-only ones:
--   - SELECT: the evidence's incident is visible to the caller under incidents
--     RLS (watch role in the incident's watch, or the caller's own incident),
--     or the caller submitted the evidence, or global/platform staff.
--   - INSERT: submitted_by = the caller AND the incident is visible to the caller.
--     Resident attachment bundles on their own report keep working.
--   - UPDATE: own evidence only (as before, now authenticated-only).
--   - DELETE (new): incident moderators (can_moderate_incidents()) for an incident
--     they can see. The staff edit form (IncidentForm, edit mode) already deletes
--     replaced evidence rows; without a DELETE policy those deletes did nothing.
--   anon loses all table privileges.
-- profile_incidents (suspect <-> incident links):
--   - SELECT: watch members with a watch role (can_view_criminal_intelligence()),
--     the same rule as criminal_profiles_select_org. Residents are out.
--     INSERT/UPDATE/DELETE policies are unchanged.
-- incident_acks:
--   - SELECT: your own acks, or watch members with a watch role, or global/
--     platform staff. Residents no longer see other people's acks.
--     INSERT/DELETE policies are unchanged.
-- get_evidence_summary(uuid): EXECUTE revoked from PUBLIC and anon (kept for
--   authenticated and service_role).
--
-- Requires: 20261118020000_incidents_resident_read_lock.sql.
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
    'public.can_moderate_incidents()',
    'public.current_org_ids()',
    'public.is_global_app_staff()',
    'public.is_platform_staff()'
  ]
  LOOP
    IF to_regprocedure(fn) IS NULL THEN
      missing := missing || fn || '; ';
    END IF;
  END LOOP;

  FOREACH col IN ARRAY ARRAY[
    'incident_evidence.incident_id', 'incident_evidence.submitted_by',
    'profile_incidents.organization_id',
    'incident_acks.user_id', 'incident_acks.organization_id'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = split_part(col, '.', 1)
        AND column_name = split_part(col, '.', 2)
    ) THEN
      missing := missing || col || '; ';
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'incidents'
      AND policyname = 'incidents_select_org'
      AND qual LIKE '%can_view_criminal_intelligence%'
  ) THEN
    missing := missing || 'run 20261118020000_incidents_resident_read_lock.sql first; ';
  END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION 'Evidence lock: missing prerequisites: %. Nothing was changed.', missing;
  END IF;

  IF NOT (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'incident_evidence') THEN
    RAISE NOTICE 'Evidence lock: row level security was OFF on incident_evidence; this file turns it on.';
  END IF;
END
$pre$;

-- 1) incident_evidence ------------------------------------------------------------
ALTER TABLE public.incident_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all users" ON public.incident_evidence;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.incident_evidence;
DROP POLICY IF EXISTS "Enable update own evidence" ON public.incident_evidence;

DROP POLICY IF EXISTS incident_evidence_select_visible ON public.incident_evidence;
CREATE POLICY incident_evidence_select_visible ON public.incident_evidence
  FOR SELECT TO authenticated
  USING (
    -- incidents RLS applies inside this subquery (watch role, or own incident)
    EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = incident_evidence.incident_id)
    OR submitted_by::text = auth.uid()::text
    OR public.is_global_app_staff()
    OR public.is_platform_staff()
  );

DROP POLICY IF EXISTS incident_evidence_insert_own ON public.incident_evidence;
CREATE POLICY incident_evidence_insert_own ON public.incident_evidence
  FOR INSERT TO authenticated
  WITH CHECK (
    submitted_by::text = auth.uid()::text
    AND EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = incident_evidence.incident_id)
  );

DROP POLICY IF EXISTS incident_evidence_update_own ON public.incident_evidence;
CREATE POLICY incident_evidence_update_own ON public.incident_evidence
  FOR UPDATE TO authenticated
  USING (submitted_by::text = auth.uid()::text)
  WITH CHECK (submitted_by::text = auth.uid()::text);

DROP POLICY IF EXISTS incident_evidence_delete_moderator ON public.incident_evidence;
CREATE POLICY incident_evidence_delete_moderator ON public.incident_evidence
  FOR DELETE TO authenticated
  USING (
    public.can_moderate_incidents()
    AND EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = incident_evidence.incident_id)
  );

REVOKE ALL ON public.incident_evidence FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.incident_evidence TO authenticated;

-- 2) profile_incidents --------------------------------------------------------------
ALTER TABLE public.profile_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profile_incidents_select_org ON public.profile_incidents;
CREATE POLICY profile_incidents_select_org ON public.profile_incidents
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT public.current_org_ids())
    AND public.can_view_criminal_intelligence()
  );

REVOKE ALL ON public.profile_incidents FROM anon;

-- 3) incident_acks -------------------------------------------------------------------
ALTER TABLE public.incident_acks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS incident_acks_select_org ON public.incident_acks;
CREATE POLICY incident_acks_select_org ON public.incident_acks
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      organization_id IN (SELECT public.current_org_ids())
      AND public.can_view_criminal_intelligence()
    )
    OR public.is_global_app_staff()
    OR public.is_platform_staff()
  );

REVOKE ALL ON public.incident_acks FROM anon;

-- 4) get_evidence_summary: no anon / PUBLIC execute ----------------------------------
DO $fn$
BEGIN
  IF to_regprocedure('public.get_evidence_summary(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.get_evidence_summary(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.get_evidence_summary(uuid) TO authenticated, service_role;
  END IF;
END
$fn$;

NOTIFY pgrst, 'reload schema';

-- 5) Verification ---------------------------------------------------------------------
DO $verify$
DECLARE
  problems text := '';
  r record;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['incident_evidence', 'profile_incidents', 'incident_acks']
  LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = t) THEN
      problems := problems || 'RLS off on ' || t || '; ';
    END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT') THEN
      problems := problems || 'anon can SELECT ' || t || '; ';
    END IF;
  END LOOP;

  -- No read policy may be open to public/anon or be USING true.
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('incident_evidence', 'profile_incidents', 'incident_acks')
      AND cmd IN ('SELECT', 'ALL')
      AND (
        roles && ARRAY['public', 'anon']::name[]
        OR qual IS NULL
        OR btrim(qual) IN ('true', '(true)')
      )
  LOOP
    problems := problems || 'open read policy ' || r.tablename || '.' || r.policyname || '; ';
  END LOOP;

  -- No write policy open to public/anon either.
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('incident_evidence', 'profile_incidents', 'incident_acks')
      AND roles && ARRAY['public', 'anon']::name[]
  LOOP
    problems := problems || 'policy open to public/anon ' || r.tablename || '.' || r.policyname || '; ';
  END LOOP;

  -- Only the expected read policies.
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd IN ('SELECT', 'ALL')
      AND permissive = 'PERMISSIVE'
      AND (
        (tablename = 'incident_evidence' AND policyname <> 'incident_evidence_select_visible')
        OR (tablename = 'profile_incidents' AND policyname <> 'profile_incidents_select_org')
        OR (tablename = 'incident_acks' AND policyname <> 'incident_acks_select_org')
      )
  LOOP
    problems := problems || 'unexpected read policy ' || r.tablename || '.' || r.policyname || '; ';
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profile_incidents'
                 AND policyname = 'profile_incidents_select_org' AND qual LIKE '%can_view_criminal_intelligence%') THEN
    problems := problems || 'profile_incidents_select_org missing role gate; ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'incident_acks'
                 AND policyname = 'incident_acks_select_org' AND qual LIKE '%can_view_criminal_intelligence%') THEN
    problems := problems || 'incident_acks_select_org missing role gate; ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'incident_evidence'
                 AND policyname = 'incident_evidence_insert_own' AND with_check LIKE '%submitted_by%') THEN
    problems := problems || 'incident_evidence_insert_own missing; ';
  END IF;

  IF to_regprocedure('public.get_evidence_summary(uuid)') IS NOT NULL
     AND has_function_privilege('anon', 'public.get_evidence_summary(uuid)', 'EXECUTE') THEN
    problems := problems || 'anon can execute get_evidence_summary; ';
  END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'Evidence lock: verification failed: %', problems;
  END IF;

  RAISE NOTICE 'Evidence lock: OK (incident_evidence, profile_incidents, incident_acks).';
END
$verify$;
