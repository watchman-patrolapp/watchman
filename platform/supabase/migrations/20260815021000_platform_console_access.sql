-- Platform console access split:
-- - Neighborhood admins keep operational access
-- - Creator/IT platform roles get commercialization + governance modules

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS platform_role text NOT NULL DEFAULT 'none'
  CHECK (platform_role IN ('none', 'platform_owner', 'platform_ops', 'platform_support'));

CREATE OR REPLACE FUNCTION public.current_platform_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (SELECT lower(trim(u.platform_role)) FROM public.users u WHERE u.id = auth.uid()),
    'none'
  );
$$;

REVOKE ALL ON FUNCTION public.current_platform_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_platform_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_platform_role() TO service_role;

CREATE OR REPLACE FUNCTION public.is_platform_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT public.current_platform_role() IN ('platform_owner', 'platform_ops', 'platform_support');
$$;

REVOKE ALL ON FUNCTION public.is_platform_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_staff() TO service_role;

-- Organizations:
-- - platform staff sees/manages all
-- - all authenticated can still list active security companies (resident membership UX)
-- - org members can see own org
DROP POLICY IF EXISTS organizations_select_member ON public.organizations;
DROP POLICY IF EXISTS organizations_manage_staff ON public.organizations;
DROP POLICY IF EXISTS organizations_insert_staff ON public.organizations;
DROP POLICY IF EXISTS organizations_select_scoped ON public.organizations;
DROP POLICY IF EXISTS organizations_insert_platform_only ON public.organizations;
DROP POLICY IF EXISTS organizations_update_platform_only ON public.organizations;
DROP POLICY IF EXISTS organizations_delete_platform_only ON public.organizations;

CREATE POLICY organizations_select_scoped ON public.organizations
  FOR SELECT TO authenticated
  USING (
    public.is_platform_staff()
    OR id IN (SELECT public.current_org_ids())
    OR (type = 'security_company' AND status = 'active')
  );

CREATE POLICY organizations_insert_platform_only ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_staff());

CREATE POLICY organizations_update_platform_only ON public.organizations
  FOR UPDATE TO authenticated
  USING (public.is_platform_staff())
  WITH CHECK (public.is_platform_staff());

CREATE POLICY organizations_delete_platform_only ON public.organizations
  FOR DELETE TO authenticated
  USING (public.is_platform_staff());

-- Subscriptions and commercialization are platform-only.
DROP POLICY IF EXISTS subscriptions_select_org ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_manage_staff ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_platform_select ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_platform_write ON public.subscriptions;

CREATE POLICY subscriptions_platform_select ON public.subscriptions
  FOR SELECT TO authenticated
  USING (public.is_platform_staff());

CREATE POLICY subscriptions_platform_write ON public.subscriptions
  FOR ALL TO authenticated
  USING (public.is_platform_staff())
  WITH CHECK (public.is_platform_staff());

-- Organization allocations are platform-owned.
DROP POLICY IF EXISTS org_members_select_member ON public.organization_members;
DROP POLICY IF EXISTS org_members_manage_staff ON public.organization_members;
DROP POLICY IF EXISTS org_members_insert_self ON public.organization_members;
DROP POLICY IF EXISTS org_members_select_scope ON public.organization_members;

CREATE POLICY org_members_select_scope ON public.organization_members
  FOR SELECT TO authenticated
  USING (
    public.is_platform_staff()
    OR organization_id IN (SELECT public.current_org_ids())
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS org_members_write_scope ON public.organization_members;
DROP POLICY IF EXISTS org_members_platform_write ON public.organization_members;
DROP POLICY IF EXISTS org_members_org_invite_insert ON public.organization_members;
DROP POLICY IF EXISTS org_members_org_status_update ON public.organization_members;
DROP POLICY IF EXISTS org_members_org_delete_blocked ON public.organization_members;

-- Platform staff can fully manage allocations.
CREATE POLICY org_members_platform_write ON public.organization_members
  FOR ALL TO authenticated
  USING (public.is_platform_staff())
  WITH CHECK (public.is_platform_staff());

-- Neighborhood staff can invite only into their own org, pending state only,
-- and cannot assign platform/support-style roles.
CREATE POLICY org_members_org_invite_insert ON public.organization_members
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT public.is_platform_staff()
    AND organization_id IN (SELECT public.current_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND public.is_staff_role(cu.role::text)
    )
    AND status = 'pending'
    AND member_role IN ('resident', 'patroller', 'nw_admin', 'committee')
  );

-- Neighborhood staff can only change member status (activate/suspend/pending)
-- for users in their own org; they cannot change role or identity columns.
CREATE POLICY org_members_org_status_update ON public.organization_members
  FOR UPDATE TO authenticated
  USING (
    NOT public.is_platform_staff()
    AND organization_id IN (SELECT public.current_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND public.is_staff_role(cu.role::text)
    )
  )
  WITH CHECK (
    NOT public.is_platform_staff()
    AND organization_id IN (SELECT public.current_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND public.is_staff_role(cu.role::text)
    )
    AND status IN ('pending', 'active', 'suspended')
    AND member_role IN ('resident', 'patroller', 'nw_admin', 'committee')
    AND organization_id = (
      SELECT om.organization_id
      FROM public.organization_members om
      WHERE om.organization_id = organization_members.organization_id
        AND om.user_id = organization_members.user_id
    )
    AND user_id = (
      SELECT om.user_id
      FROM public.organization_members om
      WHERE om.organization_id = organization_members.organization_id
        AND om.user_id = organization_members.user_id
    )
    AND member_role = (
      SELECT om.member_role
      FROM public.organization_members om
      WHERE om.organization_id = organization_members.organization_id
        AND om.user_id = organization_members.user_id
    )
  );

-- Neighborhood staff cannot hard-delete org members; platform-only.
CREATE POLICY org_members_org_delete_blocked ON public.organization_members
  FOR DELETE TO authenticated
  USING (false);

-- Security membership review queue:
-- residents can maintain own row, platform staff can review all.
DROP POLICY IF EXISTS resident_security_memberships_select ON public.resident_security_memberships;
DROP POLICY IF EXISTS resident_security_memberships_write ON public.resident_security_memberships;
DROP POLICY IF EXISTS resident_security_memberships_select_scoped ON public.resident_security_memberships;
DROP POLICY IF EXISTS resident_security_memberships_write_scoped ON public.resident_security_memberships;

CREATE POLICY resident_security_memberships_select_scoped ON public.resident_security_memberships
  FOR SELECT TO authenticated
  USING (
    resident_user_id = auth.uid()
    OR public.is_platform_staff()
  );

CREATE POLICY resident_security_memberships_write_scoped ON public.resident_security_memberships
  FOR ALL TO authenticated
  USING (
    resident_user_id = auth.uid()
    OR public.is_platform_staff()
  )
  WITH CHECK (
    resident_user_id = auth.uid()
    OR public.is_platform_staff()
  );

-- Platform staff can review activity logs across orgs.
DROP POLICY IF EXISTS activity_logs_select_org ON public.activity_logs;
DROP POLICY IF EXISTS activity_logs_select_scope ON public.activity_logs;
CREATE POLICY activity_logs_select_scope ON public.activity_logs
  FOR SELECT TO authenticated
  USING (
    public.is_platform_staff()
    OR organization_id IN (SELECT public.current_org_ids())
  );

-- Restrict global staff RPC listing to platform staff; org admins use scoped table access.
CREATE OR REPLACE FUNCTION public.list_users_for_staff()
RETURNS SETOF public.users
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT u.*
  FROM public.users u
  WHERE (
    public.is_platform_staff()
    OR u.organization_id IN (SELECT public.current_org_ids())
    OR u.id = auth.uid()
  )
  ORDER BY u.created_at DESC;
$$;

COMMENT ON FUNCTION public.list_users_for_staff() IS
  'Returns users visible to caller: platform staff see all; others see own organizations.';

-- Explicit enterprise-grade membership actions
CREATE OR REPLACE FUNCTION public.invite_org_member(
  p_organization_id uuid,
  p_user_id uuid,
  p_member_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_is_platform boolean;
  caller_is_org_staff boolean;
  role_norm text := lower(trim(coalesce(p_member_role, '')));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  caller_is_platform := public.is_platform_staff();
  caller_is_org_staff := EXISTS (
    SELECT 1 FROM public.users cu
    WHERE cu.id = auth.uid()
      AND public.is_staff_role(cu.role::text)
  );

  IF NOT caller_is_platform THEN
    IF NOT caller_is_org_staff THEN
      RAISE EXCEPTION 'forbidden: org staff required';
    END IF;
    IF p_organization_id NOT IN (SELECT public.current_org_ids()) THEN
      RAISE EXCEPTION 'forbidden: organization out of scope';
    END IF;
    IF role_norm NOT IN ('resident', 'patroller', 'nw_admin', 'committee') THEN
      RAISE EXCEPTION 'forbidden: role not assignable by org staff';
    END IF;
  END IF;

  INSERT INTO public.organization_members (
    organization_id,
    user_id,
    member_role,
    status,
    invited_by_user_id
  )
  VALUES (
    p_organization_id,
    p_user_id,
    role_norm,
    'pending',
    auth.uid()
  )
  ON CONFLICT (organization_id, user_id)
  DO UPDATE SET
    member_role = EXCLUDED.member_role,
    status = 'pending',
    invited_by_user_id = auth.uid(),
    joined_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.invite_org_member(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_org_member(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_org_member_status(
  p_organization_id uuid,
  p_user_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_is_platform boolean;
  status_norm text := lower(trim(coalesce(p_status, '')));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF status_norm NOT IN ('pending', 'active', 'suspended') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;

  caller_is_platform := public.is_platform_staff();
  IF NOT caller_is_platform THEN
    IF p_organization_id NOT IN (SELECT public.current_org_ids()) THEN
      RAISE EXCEPTION 'forbidden: organization out of scope';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND public.is_staff_role(cu.role::text)
    ) THEN
      RAISE EXCEPTION 'forbidden: org staff required';
    END IF;
  END IF;

  UPDATE public.organization_members om
  SET status = status_norm
  WHERE om.organization_id = p_organization_id
    AND om.user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization member not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_org_member_status(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_org_member_status(uuid, uuid, text) TO authenticated;

-- Helper for owner-managed platform role assignment.
CREATE OR REPLACE FUNCTION public.set_user_platform_role(
  p_user_id uuid,
  p_platform_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF public.current_platform_role() <> 'platform_owner' THEN
    RAISE EXCEPTION 'forbidden: platform_owner required';
  END IF;

  IF lower(trim(coalesce(p_platform_role, ''))) NOT IN ('none', 'platform_owner', 'platform_ops', 'platform_support') THEN
    RAISE EXCEPTION 'invalid platform_role';
  END IF;

  UPDATE public.users
  SET platform_role = lower(trim(p_platform_role))
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_platform_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_platform_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_platform_role(uuid, text) TO service_role;
