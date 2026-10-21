-- G2 — Audit log hardening + org audit viewer.
--
-- Does not DELETE, UPDATE, TRUNCATE, or rewrite any activity_logs row.
-- Existing rows stay byte-for-byte. The two foreign keys on activity_logs
-- (user_id, organization_id, both ON DELETE SET NULL in
-- 20260815010000_scale_multitenant_foundation.sql) are dropped so a later
-- user delete does not UPDATE the log. Dropping a foreign key removes no rows.
--
-- Repo constraint names (inline REFERENCES, so Postgres defaults):
--   activity_logs_user_id_fkey
--   activity_logs_organization_id_fkey
-- Live names can differ if the table was created outside this migration.
-- The DO block below drops whatever foreign keys are actually on those two
-- columns. Confirm first with:
--
--   SELECT c.conname, pg_get_constraintdef(c.oid) AS def
--   FROM pg_constraint c
--   JOIN pg_class t ON t.oid = c.conrelid
--   JOIN pg_namespace n ON n.oid = t.relnamespace
--   JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
--   WHERE n.nspname = 'public'
--     AND t.relname = 'activity_logs'
--     AND c.contype = 'f'
--     AND a.attname IN ('user_id', 'organization_id');
--
-- Also useful before apply:
--   SELECT policyname, cmd, roles::text, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'activity_logs'
--   ORDER BY policyname;
--   SELECT count(*) AS activity_logs_rows FROM public.activity_logs;
--   SELECT rolname, rolbypassrls
--   FROM pg_roles
--   WHERE rolname = 'service_role';
-- service_role must bypass RLS (true on Supabase). admin-delete-user and
-- delete-my-account insert with that role and there is deliberately no INSERT
-- policy. If rolbypassrls is false, do not redeploy those two functions.
--
-- 5-year retention is NOT scheduled here. A later job may, in its own
-- transaction only:
--   SELECT set_config('app.audit_retention', 'on', true);
--   DELETE FROM public.activity_logs
--   WHERE created_at < timezone('Africa/Johannesburg', now()) - interval '5 years';
-- Do not run that DELETE as part of applying this file.

-- ---------------------------------------------------------------------------
-- (a) No direct client writes. Triggers keep writing through
--     write_staff_activity(), which is SECURITY DEFINER (owner insert).
--     20260820080000 already revoked that helper from authenticated.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'activity_logs'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.activity_logs', r.policyname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS activity_logs_insert_actor ON public.activity_logs;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.activity_logs FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.activity_logs FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.activity_logs FROM authenticated;
-- SELECT stays so a resident query returns 0 rows (RLS) rather than a privilege error.
GRANT SELECT ON TABLE public.activity_logs TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.activity_logs TO service_role;

-- ---------------------------------------------------------------------------
-- Append-only. UPDATE always fails. DELETE fails unless this transaction set
-- app.audit_retention = on (the optional later retention job). TRUNCATE always
-- fails, including for the table owner — retention must use DELETE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_activity_logs_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.audit_retention', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'activity_logs is append-only';
END $$;

CREATE OR REPLACE FUNCTION public.trg_activity_logs_no_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'activity_logs is append-only';
END $$;

DROP TRIGGER IF EXISTS activity_logs_append_only ON public.activity_logs;
CREATE TRIGGER activity_logs_append_only
  BEFORE UPDATE OR DELETE ON public.activity_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_activity_logs_append_only();

DROP TRIGGER IF EXISTS activity_logs_no_truncate ON public.activity_logs;
CREATE TRIGGER activity_logs_no_truncate
  BEFORE TRUNCATE ON public.activity_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_activity_logs_no_truncate();

-- Drop the ON DELETE SET NULL foreign keys. A user delete would otherwise
-- UPDATE activity_logs.user_id to NULL, and the append-only trigger would
-- abort the delete. Names are resolved at read time ("Former member" when
-- the user row is gone). No rows are removed.
ALTER TABLE public.activity_logs DROP CONSTRAINT IF EXISTS activity_logs_user_id_fkey;
ALTER TABLE public.activity_logs DROP CONSTRAINT IF EXISTS activity_logs_organization_id_fkey;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
    WHERE n.nspname = 'public'
      AND t.relname = 'activity_logs'
      AND c.contype = 'f'
      AND a.attname IN ('user_id', 'organization_id')
  LOOP
    EXECUTE format('ALTER TABLE public.activity_logs DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS activity_logs_org_created_idx
  ON public.activity_logs (organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- (a2) Org helpers. Same bodies as the later capability migration, created
--      here so G3–G5 can use them. user_in_org is internal (service_role).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_org_nw_admin(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_org_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.users cu
    WHERE cu.id = auth.uid()
      AND replace(lower(trim(cu.role::text)), '-', '_') = 'nw_admin'
      AND (
        cu.organization_id = p_org_id
        OR EXISTS (
          SELECT 1 FROM public.organization_members om
          WHERE om.user_id = cu.id AND om.organization_id = p_org_id
            AND om.status = 'active' AND om.member_role = 'nw_admin'
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.user_in_org(p_user_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.organization_id = p_org_id)
      OR EXISTS (SELECT 1 FROM public.organization_members om
                 WHERE om.user_id = p_user_id AND om.organization_id = p_org_id AND om.status = 'active');
$$;

-- ---------------------------------------------------------------------------
-- (b) Read: global/platform staff, or the NW admin of that org. Residents,
--     patrollers, and committee get zero rows. Replaces the latest policy
--     (20260819020200 activity_logs_select_scope), which let every org member
--     read the staff log. Any other live SELECT policy name is dropped too.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'activity_logs'
      AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.activity_logs', r.policyname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS activity_logs_select_scope ON public.activity_logs;
DROP POLICY IF EXISTS activity_logs_select_org ON public.activity_logs;

CREATE POLICY activity_logs_select_scope ON public.activity_logs
  FOR SELECT TO authenticated
  USING (
    public.is_global_app_staff()
    OR public.is_platform_staff()
    OR (
      organization_id IN (SELECT public.current_org_ids())
      AND public.is_org_nw_admin(organization_id)
    )
  );

-- ---------------------------------------------------------------------------
-- (c) Org audit viewer. NW admin sees their own org. Global / platform staff
--     see the working neighbourhood (switching area switches the log).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_org_audit_log(
  p_limit integer DEFAULT 200,
  p_before timestamptz DEFAULT NULL,
  p_action_prefix text DEFAULT NULL,
  p_actor uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  action text,
  details_json jsonb,
  organization_id uuid,
  actor_user_id uuid,
  actor_name text,
  actor_role text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org uuid := public.working_organization_id();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF org IS NULL OR org NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'choose a working neighbourhood';
  END IF;
  IF NOT (
    public.is_global_app_staff()
    OR public.is_platform_staff()
    OR public.is_org_nw_admin(org)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    al.id,
    al.created_at,
    al.action,
    al.details_json,
    al.organization_id,
    al.user_id,
    coalesce(
      nullif(trim(al.details_json->>'actor_name'), ''),
      nullif(trim(u.full_name), ''),
      'Former member'
    ),
    coalesce(
      nullif(trim(al.details_json->>'actor_role'), ''),
      replace(lower(trim(u.role::text)), '-', '_')
    )
  FROM public.activity_logs al
  LEFT JOIN public.users u ON u.id = al.user_id
  WHERE al.organization_id = org
    AND (p_before IS NULL OR al.created_at < p_before)
    AND (
      p_action_prefix IS NULL
      OR al.action LIKE replace(replace(p_action_prefix, '%', ''), '_', '\_') || '%'
    )
    AND (p_actor IS NULL OR al.user_id = p_actor)
  ORDER BY al.created_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 200), 500));
END $$;

COMMENT ON FUNCTION public.list_org_audit_log(integer, timestamptz, text, uuid) IS
  'Working-org audit log for that org''s NW admin, or for global/platform staff. Cross-org callers get forbidden. Does not write.';

-- ---------------------------------------------------------------------------
-- (c2) list_watch_staff_activity — latest body is 20260820060000 (p_all_areas).
--      Actor filter widened from nw_admin/committee only to any non-resident
--      actor, plus rows that record a capability grant. Return type unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_watch_staff_activity(
  p_limit integer DEFAULT 150,
  p_role text DEFAULT NULL,
  p_all_areas boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  action text,
  details_json jsonb,
  organization_id uuid,
  organization_name text,
  actor_user_id uuid,
  actor_name text,
  actor_email text,
  actor_role text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  role_filter text;
  lim integer;
  all_areas boolean := coalesce(p_all_areas, false);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.is_global_app_staff() OR public.is_platform_staff()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  role_filter := replace(lower(trim(coalesce(p_role, ''))), '-', '_');
  IF role_filter NOT IN (
    'nw_admin', 'committee', 'volunteer', 'patroller', 'investigator',
    'admin', 'technical_support', 'security_admin', 'city_admin'
  ) THEN
    role_filter := NULL;
  END IF;
  lim := GREATEST(1, LEAST(coalesce(p_limit, 150), 400));

  RETURN QUERY
  SELECT
    al.id,
    al.created_at,
    al.action,
    al.details_json,
    al.organization_id,
    o.name,
    al.user_id,
    coalesce(nullif(trim(al.details_json->>'actor_name'), ''), nullif(trim(u.full_name), ''), u.email),
    u.email,
    coalesce(
      nullif(trim(al.details_json->>'actor_role'), ''),
      replace(lower(trim(u.role::text)), '-', '_')
    )
  FROM public.activity_logs al
  LEFT JOIN public.users u ON u.id = al.user_id
  LEFT JOIN public.organizations o ON o.id = al.organization_id
  WHERE (
      coalesce(
        nullif(trim(al.details_json->>'actor_role'), ''),
        replace(lower(trim(u.role::text)), '-', '_')
      ) IN (
        'nw_admin', 'committee', 'volunteer', 'patroller', 'investigator',
        'admin', 'technical_support', 'security_admin', 'city_admin'
      )
      OR replace(lower(trim(coalesce(al.details_json->>'subject_role', ''))), '-', '_') IN (
        'nw_admin', 'committee', 'volunteer', 'patroller', 'investigator',
        'admin', 'technical_support', 'security_admin', 'city_admin'
      )
      OR nullif(trim(al.details_json->>'capability'), '') IS NOT NULL
    )
    AND (
      role_filter IS NULL
      OR coalesce(
        nullif(trim(al.details_json->>'actor_role'), ''),
        replace(lower(trim(u.role::text)), '-', '_'),
        al.details_json->>'subject_role'
      ) = role_filter
    )
    AND (
      all_areas
      OR al.organization_id IN (SELECT public.current_org_ids())
    )
  ORDER BY al.created_at DESC
  LIMIT lim;
END $$;

COMMENT ON FUNCTION public.list_watch_staff_activity(integer, text, boolean) IS
  'Global staff activity feed. Non-resident actors (watch staff, patrollers, global roles) and capability rows. Defaults to the working org unless p_all_areas.';

-- ---------------------------------------------------------------------------
-- (d) Log every role change, every platform_role change, and verified flips.
--     Latest body was 20260819020100, which only logged a role change when
--     the old or new role was nw_admin/committee. Household assignment logging
--     is unchanged (watch-local staff actor only).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_log_watch_staff_user_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role text;
  old_role text;
  new_role text;
  old_platform text;
  new_platform text;
BEGIN
  old_role := replace(lower(trim(OLD.role::text)), '-', '_');
  new_role := replace(lower(trim(NEW.role::text)), '-', '_');

  SELECT replace(lower(trim(role::text)), '-', '_')
    INTO actor_role
  FROM public.users
  WHERE id = auth.uid();

  IF old_role IS DISTINCT FROM new_role THEN
    PERFORM public.write_staff_activity(
      'role_changed',
      jsonb_build_object(
        'subject_user_id', NEW.id,
        'subject_name', nullif(trim(NEW.full_name), ''),
        'from_role', old_role,
        'to_role', new_role,
        'subject_role', new_role
      ),
      auth.uid(),
      COALESCE(NEW.organization_id, OLD.organization_id)
    );
  END IF;

  old_platform := lower(trim(coalesce(OLD.platform_role, 'none')));
  new_platform := lower(trim(coalesce(NEW.platform_role, 'none')));
  IF old_platform IS DISTINCT FROM new_platform THEN
    PERFORM public.write_staff_activity(
      'platform_role_changed',
      jsonb_build_object(
        'subject_user_id', NEW.id,
        'subject_name', nullif(trim(NEW.full_name), ''),
        'from_platform_role', old_platform,
        'to_platform_role', new_platform,
        'subject_role', new_role
      ),
      auth.uid(),
      COALESCE(NEW.organization_id, OLD.organization_id)
    );
  END IF;

  IF NEW.verified IS DISTINCT FROM OLD.verified THEN
    PERFORM public.write_staff_activity(
      CASE WHEN NEW.verified THEN 'resident_verified' ELSE 'resident_unverified' END,
      jsonb_build_object(
        'resident_user_id', NEW.id,
        'subject_user_id', NEW.id,
        'resident_name', nullif(trim(NEW.full_name), ''),
        'subject_name', nullif(trim(NEW.full_name), ''),
        'subject_role', new_role,
        'verified', NEW.verified
      ),
      auth.uid(),
      COALESCE(NEW.organization_id, OLD.organization_id)
    );
  END IF;

  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     AND public.is_watch_local_staff_role(actor_role) THEN
    PERFORM public.write_staff_activity(
      'resident_assigned',
      jsonb_build_object(
        'subject_user_id', NEW.id,
        'subject_name', nullif(trim(NEW.full_name), ''),
        'from_organization_id', OLD.organization_id,
        'to_organization_id', NEW.organization_id
      ),
      auth.uid(),
      NEW.organization_id
    );
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS zzz_log_watch_staff_user_changes ON public.users;
CREATE TRIGGER zzz_log_watch_staff_user_changes
  AFTER UPDATE OF role, platform_role, organization_id, verified ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_log_watch_staff_user_changes();

-- ---------------------------------------------------------------------------
-- (e) City Hub. Real columns (20260815010000 / 20260815032000):
--     author_organization_id, title, status text CHECK (draft|published|archived).
--     Archive is status = 'archived' (no separate archived column).
--     delete_city_hub_post DELETEs the row; archive_city_hub_post sets status.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_log_city_hub_post_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.write_staff_activity(
    'city_hub_post_deleted',
    jsonb_build_object(
      'post_id', OLD.id,
      'title', left(coalesce(OLD.title, ''), 160)
    ),
    auth.uid(),
    OLD.author_organization_id
  );
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public.trg_log_city_hub_post_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'archived' THEN
    PERFORM public.write_staff_activity(
      'city_hub_post_archived',
      jsonb_build_object(
        'post_id', NEW.id,
        'title', left(coalesce(NEW.title, ''), 160),
        'from_status', OLD.status,
        'to_status', NEW.status
      ),
      auth.uid(),
      NEW.author_organization_id
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS zzz_log_city_hub_post_deleted ON public.city_hub_posts;
CREATE TRIGGER zzz_log_city_hub_post_deleted
  AFTER DELETE ON public.city_hub_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_log_city_hub_post_deleted();

DROP TRIGGER IF EXISTS zzz_log_city_hub_post_status ON public.city_hub_posts;
CREATE TRIGGER zzz_log_city_hub_post_status
  AFTER UPDATE OF status ON public.city_hub_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_log_city_hub_post_status();

-- ---------------------------------------------------------------------------
-- Grants. Client RPCs: authenticated + service_role. Helpers/triggers: service_role.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.list_org_audit_log(integer, timestamptz, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_org_audit_log(integer, timestamptz, text, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_watch_staff_activity(integer, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_watch_staff_activity(integer, text, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_org_nw_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_nw_admin(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.user_in_org(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_in_org(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.trg_activity_logs_append_only() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_activity_logs_append_only() TO service_role;

REVOKE ALL ON FUNCTION public.trg_activity_logs_no_truncate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_activity_logs_no_truncate() TO service_role;

REVOKE ALL ON FUNCTION public.trg_log_watch_staff_user_changes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_watch_staff_user_changes() TO service_role;

REVOKE ALL ON FUNCTION public.trg_log_city_hub_post_deleted() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_city_hub_post_deleted() TO service_role;

REVOKE ALL ON FUNCTION public.trg_log_city_hub_post_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_log_city_hub_post_status() TO service_role;

-- write_staff_activity stays service_role only (20260820080000). Do not grant it
-- back to authenticated: the helper accepts any action text and would re-open forgery.
REVOKE ALL ON FUNCTION public.write_staff_activity(text, jsonb, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_staff_activity(text, jsonb, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.trg_activity_logs_append_only() IS
  'Rejects UPDATE, and DELETE unless app.audit_retention=on in this transaction. The 5-year retention job is not created by G2.';

NOTIFY pgrst, 'reload schema';
