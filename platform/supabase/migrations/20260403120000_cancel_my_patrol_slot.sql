-- Patrollers cancel their own schedule rows. Direct DELETE from the client often hits RLS and
-- returns 0 rows with no error, so the UI showed success while the row remained.

CREATE OR REPLACE FUNCTION public.cancel_my_patrol_slot(p_slot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  deleted_count int;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  DELETE FROM public.patrol_slots
  WHERE id = p_slot_id
    AND volunteer_uid = uid;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count = 0 THEN
    RAISE EXCEPTION 'patrol signup not found or you can only remove your own sign-ups';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_my_patrol_slot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_my_patrol_slot(uuid) TO authenticated;

COMMENT ON FUNCTION public.cancel_my_patrol_slot(uuid) IS
  'Delete one patrol_slots row when volunteer_uid matches auth.uid(); bypasses RLS safely';
