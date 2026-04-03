-- Staff UIs (Member profiles, etc.) need full public.users rows including phone.
-- Direct SELECT is often restricted by RLS; this mirrors get_active_patroller_avatars* patterns.

CREATE OR REPLACE FUNCTION public.list_users_for_staff()
RETURNS SETOF public.users
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT u.*
  FROM public.users u
  WHERE EXISTS (
    SELECT 1
    FROM public.users cu
    WHERE cu.id = auth.uid()
      AND lower(trim(cu.role::text)) IN ('admin', 'committee')
  )
  ORDER BY u.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_users_for_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_users_for_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_users_for_staff() TO service_role;

COMMENT ON FUNCTION public.list_users_for_staff() IS
  'Returns all member rows for admin/committee callers; bypasses RLS for staff directory UIs.';
