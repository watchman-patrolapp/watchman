-- Include patroller phone on active patrol directory (requires public.users.phone).
-- Return type change requires DROP; CREATE OR REPLACE cannot alter OUT parameters.

DROP FUNCTION IF EXISTS public.get_active_patroller_avatars();

CREATE FUNCTION public.get_active_patroller_avatars()
RETURNS TABLE (user_id uuid, avatar_url text, phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT u.id AS user_id, u.avatar_url, u.phone
  FROM public.active_patrols ap
  INNER JOIN public.users u ON u.id = ap.user_id;
$$;

REVOKE ALL ON FUNCTION public.get_active_patroller_avatars() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_patroller_avatars() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_patroller_avatars() TO service_role;

COMMENT ON FUNCTION public.get_active_patroller_avatars() IS
  'Returns user_id, avatar_url, and phone for users with an active patrol row; for directory UI.';
