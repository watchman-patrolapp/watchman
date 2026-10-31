-- Role-change fix: one server-side path for staff role changes.
--
-- Why: UserManagement.jsx and AdminResidents.jsx wrote public.users.role
-- directly. The live UPDATE policy "Admins and committee can update users"
-- (USING is_admin_or_committee_check(auth.uid())) does not cover nw_admin, so
-- those updates matched 0 rows with no error and the page showed success.
-- Some global-admin updates also matched 0 rows (see the diagnostics below).
--
-- This file only ADDS one function. It does not INSERT, UPDATE or DELETE any
-- row, drop any policy, or change any trigger. The G5 guard
-- (aaa_users_privilege_guard) stays as the backstop for direct client writes.
-- The existing audit trigger (zzz_log_watch_staff_user_changes) still writes
-- the role_changed row into public.activity_logs; this function adds none.
--
-- Rules (mirror trg_users_privilege_guard, 20261022001000):
--   * Nobody changes their own role here.
--   * admin / technical_support are never assigned here (matches the UI).
--   * city_admin / security_admin: global or platform staff only.
--   * Local staff (nw_admin, committee): only users in one of their own
--     neighbourhoods (current_org_ids). Anything else -> 'not found'.
--   * Only an NW admin of that neighbourhood (or global staff) appoints nw_admin.
--   * Same role as now -> no write, no log row, changed = false.
--   * 0 rows updated, or the role did not stick -> raises 'role not saved'.
--   * organization_members.member_role is kept in sync for the user's
--     neighbourhood memberships, using the same mapping as
--     assign_resident_to_neighborhood (20260819031000).
--
-- Read-only pre-check (run before applying):
--   SELECT to_regprocedure('public.admin_set_user_role(uuid,text)') AS should_be_null;
--   SELECT count(*) AS users FROM public.users;
--   SELECT replace(lower(trim(role::text)), '-', '_') AS role, count(*) FROM public.users GROUP BY 1 ORDER BY 1;
--   SELECT member_role, count(*) FROM public.organization_members GROUP BY 1 ORDER BY 1;
--
-- Read-only post-check (counts must equal the pre-check):
--   SELECT to_regprocedure('public.admin_set_user_role(uuid,text)') AS should_exist;
--   SELECT count(*) AS users FROM public.users;
--   SELECT replace(lower(trim(role::text)), '-', '_') AS role, count(*) FROM public.users GROUP BY 1 ORDER BY 1;
--   SELECT member_role, count(*) FROM public.organization_members GROUP BY 1 ORDER BY 1;
--   SELECT has_function_privilege('authenticated', 'public.admin_set_user_role(uuid,text)', 'EXECUTE') AS auth_can_call,
--          has_function_privilege('anon', 'public.admin_set_user_role(uuid,text)', 'EXECUTE') AS anon_can_call; -- true, false

CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_user_id uuid, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  is_global boolean;
  new_role text := replace(lower(trim(coalesce(p_role, ''))), '-', '_');
  old_role text;
  saved_role text;
  target_org uuid;
  in_scope boolean;
  n int;
  member_role_out text;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user is required';
  END IF;
  IF new_role NOT IN ('resident', 'volunteer', 'patroller', 'investigator',
                      'nw_admin', 'committee', 'city_admin', 'security_admin',
                      'admin', 'technical_support') THEN
    RAISE EXCEPTION 'unknown role: %', p_role;
  END IF;

  is_global := public.is_global_app_staff() OR public.is_platform_staff();

  IF NOT is_global AND NOT public.is_area_broadcast_staff() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_user_id = caller THEN
    RAISE EXCEPTION 'you cannot change your own role here';
  END IF;

  SELECT replace(lower(trim(u.role::text)), '-', '_'), u.organization_id
    INTO old_role, target_org
  FROM public.users u
  WHERE u.id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not found';
  END IF;

  -- Local staff: the target must be in one of the caller's neighbourhoods.
  -- Another neighbourhood must look the same as a missing user.
  IF NOT is_global THEN
    IF target_org IS NOT NULL THEN
      in_scope := target_org IN (SELECT public.current_org_ids());
    ELSE
      in_scope := EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.user_id = p_user_id AND om.status = 'active'
          AND om.organization_id IN (SELECT public.current_org_ids())
      );
    END IF;
    IF NOT coalesce(in_scope, false) THEN
      RAISE EXCEPTION 'not found';
    END IF;
  END IF;

  IF new_role IN ('admin', 'technical_support') THEN
    RAISE EXCEPTION 'main admin and technical support are global and cannot be assigned here';
  END IF;
  IF old_role IN ('admin', 'technical_support') AND NOT is_global THEN
    RAISE EXCEPTION 'only platform staff can make that change';
  END IF;
  IF new_role IN ('city_admin', 'security_admin') AND NOT is_global THEN
    RAISE EXCEPTION 'only platform staff can make that change';
  END IF;
  IF new_role = 'nw_admin' AND NOT is_global
     AND NOT public.is_org_nw_admin(target_org) THEN
    RAISE EXCEPTION 'only an NW admin can appoint another NW admin';
  END IF;

  IF old_role IS NOT DISTINCT FROM new_role THEN
    RETURN jsonb_build_object('id', p_user_id, 'role', new_role,
      'previous_role', old_role, 'organization_id', target_org, 'changed', false);
  END IF;

  EXECUTE 'UPDATE public.users SET role = $1 WHERE id = $2' USING new_role, p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RAISE EXCEPTION 'role not saved (0 rows updated)';
  END IF;

  SELECT replace(lower(trim(u.role::text)), '-', '_') INTO saved_role
  FROM public.users u WHERE u.id = p_user_id;
  IF saved_role IS DISTINCT FROM new_role THEN
    RAISE EXCEPTION 'role not saved (a trigger kept %)', saved_role;
  END IF;

  -- Same mapping as assign_resident_to_neighborhood.
  member_role_out := CASE new_role
    WHEN 'nw_admin' THEN 'nw_admin'
    WHEN 'committee' THEN 'committee'
    WHEN 'security_admin' THEN 'security_admin'
    WHEN 'city_admin' THEN 'city_admin'
    WHEN 'patroller' THEN 'patroller'
    WHEN 'volunteer' THEN 'patroller'
    WHEN 'investigator' THEN 'patroller'
    ELSE 'resident'
  END;

  UPDATE public.organization_members om
  SET member_role = member_role_out
  FROM public.organizations o
  WHERE om.user_id = p_user_id
    AND om.organization_id = o.id
    AND o.type = 'nw_group'
    AND om.member_role IS DISTINCT FROM member_role_out;

  RETURN jsonb_build_object('id', p_user_id, 'role', new_role,
    'previous_role', old_role, 'organization_id', target_org,
    'member_role', member_role_out, 'changed', true);
END;
$$;

COMMENT ON FUNCTION public.admin_set_user_role(uuid, text) IS
  'Staff role change with G5 rules; raises instead of silently saving 0 rows; syncs organization_members.member_role.';

REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
