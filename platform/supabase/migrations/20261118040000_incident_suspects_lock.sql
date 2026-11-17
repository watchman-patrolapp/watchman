-- =============================================================================
-- 20261118040000_incident_suspects_lock.sql
-- Lock incident_suspects (was world-readable, anon included) to watch roles.
--
-- Additive and idempotent: safe to re-run. Changes NO rows. Independent of
-- 20261118030000 (needs only 20261118020000 and the helpers below).
--
-- incident_suspects (columns the app uses: id, incident_id, evidence_id,
-- description, estimated_age, clothing_description, distinguishing_features,
-- direction_last_seen, time_observed, photo_urls). Photos live in the
-- incident-photos bucket (locked by 20261118020000).
-- Used only by staff/patrol screens (IncidentDetail, IncidentForm,
-- ShareToCityHubSheet). No resident, Android or edge-function code reads it,
-- so residents get no access, not even on their own incident.
--
--   Drops "Enable read access for all users" (SELECT {public} USING true) and
--   "Enable insert for authenticated users" (INSERT {public}), revokes anon, and adds:
--   - SELECT: watch role (can_view_criminal_intelligence()) AND the incident is
--     visible to the caller under incidents RLS; or global/platform staff.
--   - INSERT: watch role AND the incident is visible to the caller. If the table
--     has a creator column (created_by or submitted_by) with a default, it must
--     equal the caller. The app does not send one, so without a default the
--     check is skipped (a NOTICE says so) to keep IncidentForm working.
--   - DELETE (new): incident moderators (can_moderate_incidents()) for an incident
--     they can see. IncidentForm edit mode deletes replaced suspect rows; with no
--     DELETE policy those deletes did nothing.
--   No UPDATE policy (the app never updates suspects; none existed before).
--
-- Run the whole file at once in the Supabase SQL editor. It is one transaction:
-- if the verification at the end fails, nothing in this file is kept.
-- =============================================================================

-- 0) Preconditions ------------------------------------------------------------
DO $pre$
DECLARE
  missing text := '';
  fn text;
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

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'incident_suspects' AND column_name = 'incident_id'
  ) THEN
    missing := missing || 'incident_suspects.incident_id; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'incidents'
      AND policyname = 'incidents_select_org'
      AND qual LIKE '%can_view_criminal_intelligence%'
  ) THEN
    missing := missing || 'run 20261118020000_incidents_resident_read_lock.sql first; ';
  END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION 'Suspects lock: missing prerequisites: %. Nothing was changed.', missing;
  END IF;
END
$pre$;

-- 1) Policies -----------------------------------------------------------------
ALTER TABLE public.incident_suspects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all users" ON public.incident_suspects;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.incident_suspects;

DROP POLICY IF EXISTS incident_suspects_select_watch ON public.incident_suspects;
CREATE POLICY incident_suspects_select_watch ON public.incident_suspects
  FOR SELECT TO authenticated
  USING (
    (
      public.can_view_criminal_intelligence()
      -- incidents RLS applies inside this subquery
      AND EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = incident_suspects.incident_id)
    )
    OR public.is_global_app_staff()
    OR public.is_platform_staff()
  );

DO $ins$
DECLARE
  creator_col text;
  creator_check text := '';
BEGIN
  SELECT c.column_name INTO creator_col
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'incident_suspects'
    AND c.column_name IN ('created_by', 'submitted_by')
    AND c.column_default IS NOT NULL
  ORDER BY c.column_name
  LIMIT 1;

  IF creator_col IS NOT NULL THEN
    creator_check := format(' AND %I::text = auth.uid()::text', creator_col);
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'incident_suspects'
      AND c.column_name IN ('created_by', 'submitted_by')
  ) THEN
    RAISE NOTICE 'Suspects lock: creator column has no default and the app does not set it, so INSERT does not check it.';
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS incident_suspects_insert_watch ON public.incident_suspects';
  EXECUTE 'CREATE POLICY incident_suspects_insert_watch ON public.incident_suspects
    FOR INSERT TO authenticated
    WITH CHECK (
      public.can_view_criminal_intelligence()
      AND EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = incident_suspects.incident_id)'
    || creator_check || '
    )';
END
$ins$;

DROP POLICY IF EXISTS incident_suspects_delete_moderator ON public.incident_suspects;
CREATE POLICY incident_suspects_delete_moderator ON public.incident_suspects
  FOR DELETE TO authenticated
  USING (
    public.can_moderate_incidents()
    AND EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = incident_suspects.incident_id)
  );

REVOKE ALL ON public.incident_suspects FROM anon;
GRANT SELECT, INSERT, DELETE ON public.incident_suspects TO authenticated;

NOTIFY pgrst, 'reload schema';

-- 2) Verification ---------------------------------------------------------------
DO $verify$
DECLARE
  problems text := '';
  r record;
BEGIN
  IF NOT (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'incident_suspects') THEN
    problems := problems || 'RLS off; ';
  END IF;
  IF has_table_privilege('anon', 'public.incident_suspects', 'SELECT')
     OR has_table_privilege('anon', 'public.incident_suspects', 'INSERT') THEN
    problems := problems || 'anon has table privileges; ';
  END IF;

  FOR r IN
    SELECT policyname, cmd FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'incident_suspects'
      AND (
        roles && ARRAY['public', 'anon']::name[]
        OR btrim(coalesce(qual, '')) IN ('true', '(true)')
        OR btrim(coalesce(with_check, '')) IN ('true', '(true)')
        OR (cmd IN ('SELECT', 'ALL', 'DELETE', 'UPDATE') AND qual IS NULL)
        OR (cmd = 'INSERT' AND with_check IS NULL)
      )
  LOOP
    problems := problems || 'open policy ' || r.policyname || ' (' || r.cmd || '); ';
  END LOOP;

  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'incident_suspects'
      AND permissive = 'PERMISSIVE'
      AND policyname NOT IN ('incident_suspects_select_watch', 'incident_suspects_insert_watch', 'incident_suspects_delete_moderator')
  LOOP
    problems := problems || 'unexpected policy ' || r.policyname || '; ';
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'incident_suspects'
                 AND policyname = 'incident_suspects_select_watch' AND qual LIKE '%can_view_criminal_intelligence%') THEN
    problems := problems || 'select policy missing role gate; ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'incident_suspects'
                 AND policyname = 'incident_suspects_insert_watch' AND with_check LIKE '%can_view_criminal_intelligence%') THEN
    problems := problems || 'insert policy missing role gate; ';
  END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'Suspects lock: verification failed: %', problems;
  END IF;

  RAISE NOTICE 'Suspects lock: OK (incident_suspects readable by watch roles only).';
END
$verify$;
