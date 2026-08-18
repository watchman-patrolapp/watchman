-- Staff Verify residents: next-of-kin including relationship.
-- Explicit columns so PostgREST is not stuck on a stale SETOF public.users cache.

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

CREATE OR REPLACE FUNCTION public.list_neighborhood_next_of_kin()
RETURNS TABLE (
  user_id uuid,
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_user_id uuid,
  emergency_contact_relationship text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    u.emergency_contact_name,
    u.emergency_contact_phone,
    u.emergency_contact_user_id,
    u.emergency_contact_relationship
  FROM public.users u
  WHERE (
    public.is_platform_staff()
    OR public.is_global_app_staff()
    OR u.organization_id IN (SELECT public.current_org_ids())
    OR u.id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.list_neighborhood_next_of_kin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_neighborhood_next_of_kin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_neighborhood_next_of_kin() TO service_role;

COMMENT ON FUNCTION public.list_neighborhood_next_of_kin() IS
  'Next-of-kin name, phone, linked neighbour, and relationship for residents visible to the caller.';

NOTIFY pgrst, 'reload schema';
