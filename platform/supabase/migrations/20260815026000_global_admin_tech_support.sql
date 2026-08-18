-- Main admin and technical support are global profiles.
-- They can see every organization, but they are not neighborhood members
-- and must not be counted toward an organization's user-based subscription.

CREATE OR REPLACE FUNCTION public.is_global_app_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND lower(trim(u.role::text)) IN ('admin', 'technical_support')
  );
$$;

REVOKE ALL ON FUNCTION public.is_global_app_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_global_app_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_global_app_staff() TO service_role;

CREATE OR REPLACE FUNCTION public.current_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT o.id
  FROM public.organizations o
  WHERE public.is_global_app_staff()
     OR public.is_platform_staff()
  UNION
  SELECT om.organization_id
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.status = 'active'
  UNION
  SELECT u.organization_id
  FROM public.users u
  WHERE u.id = auth.uid()
    AND u.organization_id IS NOT NULL
$$;

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
    OR public.is_global_app_staff()
    OR u.organization_id IN (SELECT public.current_org_ids())
    OR u.id = auth.uid()
  )
  ORDER BY u.created_at DESC;
$$;

COMMENT ON FUNCTION public.list_users_for_staff() IS
  'Returns users visible to caller: global admin/tech support and platform staff see all; others see own organizations.';

CREATE OR REPLACE FUNCTION public.prevent_global_role_org_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = NEW.user_id
      AND lower(trim(u.role::text)) IN ('admin', 'technical_support')
  ) THEN
    RAISE EXCEPTION 'Main admin and technical support are global and cannot be added to a neighborhood organization';
  END IF;

  IF lower(trim(coalesce(NEW.member_role, ''))) IN ('admin', 'technical_support') THEN
    RAISE EXCEPTION 'admin and technical_support cannot be organization member roles';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organization_members_block_global_roles ON public.organization_members;
CREATE TRIGGER organization_members_block_global_roles
  BEFORE INSERT OR UPDATE OF user_id, member_role
  ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_global_role_org_membership();

DELETE FROM public.organization_members om
USING public.users u
WHERE om.user_id = u.id
  AND lower(trim(u.role::text)) IN ('admin', 'technical_support');

UPDATE public.users
SET organization_id = NULL
WHERE lower(trim(role::text)) IN ('admin', 'technical_support');
