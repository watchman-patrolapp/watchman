-- G5: stop a signed-in user from promoting themselves, and stop local staff
-- from minting global roles or editing a user outside their neighbourhood.
-- Depends on G1 (public.is_area_broadcast_staff) and G2
-- (public.is_org_nw_admin, public.user_in_org, public.current_org_ids).
--
-- This file does not INSERT, UPDATE, or DELETE any public.users row.
-- It does not change roles, verification, organization_id, or status.
-- Existing accounts keep the roles they already have. No policy is dropped.
--
-- Direct client writes that must keep working (none of these columns are guarded):
--   Profile.jsx            full_name, address, phone, avatar_url
--   SOPFlashcards.jsx      sop_version_accepted, sop_accepted_at
--   AdminResidents.jsx     role on someone else (local staff, rules below)
--   UserManagement.jsx     role on someone else (same rules)
-- patroller_request_status is on public.resident_profiles, not public.users.
-- Household mode (ensure_my_household_profile) writes resident_profiles only.
-- Working-area switch is public.set_active_organization (SECURITY DEFINER),
-- so it does not run as authenticated and is not blocked here.
--
-- Read-only pre-check (run before this file; do not write):
--   SELECT count(*) AS users FROM public.users;
--   SELECT replace(lower(trim(role::text)), '-', '_') AS role, count(*) AS n
--   FROM public.users
--   GROUP BY 1
--   ORDER BY n DESC, role;
--   SELECT column_name
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'users'
--     AND column_name IN (
--       'role', 'platform_role', 'verified', 'verification_method',
--       'verified_by_user_id', 'organization_id', 'active_organization_id', 'status'
--     )
--   ORDER BY column_name;
--   SELECT policyname, cmd, roles::text, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'users'
--   ORDER BY policyname;
--   SELECT tgname, pg_get_triggerdef(t.oid) AS def
--   FROM pg_trigger t
--   JOIN pg_class c ON c.oid = t.tgrelid
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname = 'users' AND NOT t.tgisinternal
--   ORDER BY tgname;
-- Stop if status is missing (added by 20260815010000). After apply, the role
-- counts and the users count must match this pre-check exactly.
--
-- Why SECURITY INVOKER: current_user inside a SECURITY DEFINER function is the
-- owner (postgres / supabase_admin), so the client-only branch below would
-- never run. An invoker trigger sees the role that issued the UPDATE.
-- SECURITY DEFINER RPCs, edge functions (service_role), and migrations
-- (postgres) therefore pass through. user_in_org stays service_role-only (G2);
-- the narrow helper below is what this trigger calls for the caller's own org.

-- ---------------------------------------------------------------------------
-- Own-membership check. user_in_org(any user, any org) stays internal.
-- This answers only "is auth.uid() in p_org_id?" and cannot write.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.users_guard_self_in_org(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_in_org(auth.uid(), p_org_id);
$$;

COMMENT ON FUNCTION public.users_guard_self_in_org(uuid) IS
  'G5 helper: is the signed-in user a member of p_org_id? Does not write.';

REVOKE ALL ON FUNCTION public.users_guard_self_in_org(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.users_guard_self_in_org(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- BEFORE UPDATE guard. Name sorts first so it runs ahead of other BEFORE
-- triggers on public.users.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_users_privilege_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  is_global boolean;
  new_role text := replace(lower(trim(coalesce(NEW.role::text, ''))), '-', '_');
BEGIN
  -- Only police direct client writes. See the file header.
  -- anon has no users-update path in the app. Reject it before any helper call:
  -- PL/pgSQL may evaluate a function inside AND even when an earlier term is false,
  -- and anon cannot execute those helpers.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF current_user = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  is_global := public.is_global_app_staff();
  IF NOT is_global THEN
    is_global := public.is_platform_staff();
  END IF;

  -- 1) Self-edits can never touch privileged columns.
  --    users.status is the account status column from 20260815010000.
  --    patroller_request_status is not a users column (resident_profiles).
  IF NEW.id = auth.uid() AND NOT is_global AND (
       NEW.role IS DISTINCT FROM OLD.role
    OR NEW.platform_role IS DISTINCT FROM OLD.platform_role
    OR NEW.verified IS DISTINCT FROM OLD.verified
    OR NEW.verification_method IS DISTINCT FROM OLD.verification_method
    OR NEW.verified_by_user_id IS DISTINCT FROM OLD.verified_by_user_id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'you cannot change your own role, verification, account status or neighbourhood here';
  END IF;

  -- active_organization_id self-change is allowed only to an org the user belongs to.
  -- Clearing it (NULL) is allowed. Global / platform staff are not limited here;
  -- the app switch goes through set_active_organization and never reaches this branch.
  -- The helper call is in its own IF. PL/pgSQL can evaluate a function that sits
  -- in the same AND list even when an earlier comparison is false, which would
  -- run this check on every profile save.
  IF NEW.id = auth.uid()
     AND NEW.active_organization_id IS DISTINCT FROM OLD.active_organization_id
     AND NEW.active_organization_id IS NOT NULL
     AND NOT is_global THEN
    IF NOT public.users_guard_self_in_org(NEW.active_organization_id) THEN
      RAISE EXCEPTION 'not a member of that neighbourhood';
    END IF;
  END IF;

  -- 2) Editing someone else: global/platform staff, or NW admin/committee
  --    of an org the caller already belongs to.
  IF NEW.id <> auth.uid() AND NOT is_global THEN
    -- A real other neighbourhood must not be distinguishable from a missing row.
    IF OLD.organization_id IS NOT NULL THEN
      IF OLD.organization_id NOT IN (SELECT public.current_org_ids()) THEN
        RAISE EXCEPTION 'not found';
      END IF;
    END IF;

    -- NULL organization_id is unassigned, not another org. Still staff-only,
    -- so a resident cannot edit that row (NULL would skip a bare IN check).
    IF NOT public.is_area_broadcast_staff() THEN
      RAISE EXCEPTION 'forbidden';
    END IF;

    -- Local staff can never mint global/platform roles or move users across orgs.
    -- GLOBAL_APP_ROLES in roleMatrix.js are admin and technical_support.
    -- security_admin and city_admin are partner roles, also not local assignments.
    IF new_role IN ('admin', 'technical_support', 'city_admin', 'security_admin')
       OR NEW.platform_role IS DISTINCT FROM OLD.platform_role
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'only platform staff can make that change';
    END IF;

    -- Committee may not promote to nw_admin (D1).
    IF new_role = 'nw_admin' THEN
      IF NOT public.is_org_nw_admin(OLD.organization_id) THEN
        RAISE EXCEPTION 'only an NW admin can appoint another NW admin';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_users_privilege_guard() IS
  'BEFORE UPDATE guard for direct client writes to public.users. SECURITY INVOKER so current_user is the statement role.';

REVOKE ALL ON FUNCTION public.trg_users_privilege_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_users_privilege_guard() TO service_role;

DROP TRIGGER IF EXISTS aaa_users_privilege_guard ON public.users;
CREATE TRIGGER aaa_users_privilege_guard
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_users_privilege_guard();

-- Do not REVOKE UPDATE on public.users. Profile, avatar, and SOP acceptance
-- are still direct client updates. This trigger is the control.

NOTIFY pgrst, 'reload schema';
