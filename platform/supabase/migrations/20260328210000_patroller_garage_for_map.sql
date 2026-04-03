-- Live map needs current vehicle colours from user_vehicles for everyone on patrol.
-- Direct SELECT is often blocked by RLS for other users' rows; this mirrors the avatar RPC pattern.

CREATE OR REPLACE FUNCTION public.get_patroller_garage_for_map()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  color text,
  is_primary boolean,
  make_model text,
  registration text,
  vehicle_type text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.id,
    v.user_id,
    v.color,
    COALESCE(v.is_primary, false) AS is_primary,
    v.make_model,
    v.registration,
    v.vehicle_type
  FROM public.user_vehicles v
  WHERE EXISTS (
    SELECT 1 FROM public.active_patrols ap WHERE ap.user_id = v.user_id
  );
$$;

REVOKE ALL ON FUNCTION public.get_patroller_garage_for_map() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_patroller_garage_for_map() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_patroller_garage_for_map() TO service_role;

COMMENT ON FUNCTION public.get_patroller_garage_for_map() IS
  'Rows from user_vehicles for users with an active patrol; for map marker colours.';
