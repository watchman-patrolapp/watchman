-- 20261119010000_incident_evidence_keep_submitter.sql
--
-- Incident edit form: keep the original submitter on evidence.
--
-- Before: editing an incident deleted every incident_evidence row and inserted
-- copies with submitted_by = the editor, so photos and notes added by the
-- original reporter showed up as the editor's. Moderators could not update
-- other people's rows in place (update policy was own rows only).
--
-- After:
--   - incident moderators (can_moderate_incidents) may UPDATE evidence on
--     incidents they can see, so the edit form updates rows in place;
--   - a BEFORE UPDATE trigger keeps submitted_by, incident_id and created_at
--     unchanged on every update, for every caller.
--
-- Additive and idempotent. Changes no rows. Needs 20261118030000.

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'incident_evidence' AND policyname = 'incident_evidence_insert_own') THEN
    RAISE EXCEPTION 'Keep submitter: missing prerequisites. Run 20261118030000_incident_evidence_profile_incidents_lock.sql first.';
  END IF;
  IF to_regprocedure('public.can_moderate_incidents()') IS NULL THEN
    RAISE EXCEPTION 'Keep submitter: missing prerequisites. public.can_moderate_incidents() not found.';
  END IF;
END
$pre$;

-- 1) Moderators can update evidence on incidents they can see ----------------
DROP POLICY IF EXISTS incident_evidence_update_moderator ON public.incident_evidence;
CREATE POLICY incident_evidence_update_moderator ON public.incident_evidence
  FOR UPDATE TO authenticated
  USING (
    public.can_moderate_incidents()
    AND EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = incident_evidence.incident_id)
  )
  WITH CHECK (
    public.can_moderate_incidents()
    AND EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = incident_evidence.incident_id)
  );

-- 2) Ownership columns never change on update --------------------------------
CREATE OR REPLACE FUNCTION public.incident_evidence_keep_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.submitted_by := OLD.submitted_by;
  NEW.incident_id := OLD.incident_id;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS incident_evidence_keep_owner ON public.incident_evidence;
CREATE TRIGGER incident_evidence_keep_owner
  BEFORE UPDATE ON public.incident_evidence
  FOR EACH ROW EXECUTE FUNCTION public.incident_evidence_keep_owner();

-- 3) Verification ------------------------------------------------------------
DO $verify$
DECLARE
  problems text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'incident_evidence'
                 AND policyname = 'incident_evidence_update_moderator' AND cmd = 'UPDATE'
                 AND qual LIKE '%can_moderate_incidents%' AND with_check LIKE '%can_moderate_incidents%') THEN
    problems := problems || 'incident_evidence_update_moderator missing; ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                 WHERE c.relname = 'incident_evidence' AND t.tgname = 'incident_evidence_keep_owner'
                 AND NOT t.tgisinternal AND t.tgenabled <> 'D') THEN
    problems := problems || 'incident_evidence_keep_owner trigger missing; ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'incident_evidence'
                 AND policyname = 'incident_evidence_insert_own' AND with_check LIKE '%submitted_by%') THEN
    problems := problems || 'incident_evidence_insert_own missing; ';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'incident_evidence'
             AND cmd IN ('SELECT', 'ALL') AND permissive = 'PERMISSIVE'
             AND policyname <> 'incident_evidence_select_visible') THEN
    problems := problems || 'unexpected read policy on incident_evidence; ';
  END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'Keep submitter: verification failed: %', problems;
  END IF;
  RAISE NOTICE 'Keep submitter: OK (moderators update evidence in place; submitter is kept).';
END
$verify$;
