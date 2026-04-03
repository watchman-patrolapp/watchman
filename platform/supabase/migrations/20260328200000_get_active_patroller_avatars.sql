-- Allow any authenticated user to resolve avatar URLs for users currently on patrol,
-- without opening full public.users SELECT (which is often restricted by RLS).
-- Used by the dashboard / admin "Currently on Patrol" UI and live map.

CREATE OR REPLACE FUNCTION public.get_active_patroller_avatars()
RETURNS TABLE (user_id uuid, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT u.id AS user_id, u.avatar_url
  FROM public.active_patrols ap
  INNER JOIN public.users u ON u.id = ap.user_id;
$$;

REVOKE ALL ON FUNCTION public.get_active_patroller_avatars() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_patroller_avatars() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_patroller_avatars() TO service_role;

COMMENT ON FUNCTION public.get_active_patroller_avatars() IS
  'Returns user_id and avatar_url for users with an active patrol row; for directory UI only.';
