-- Admin/committee can remove any planned patrol signup (RLS on patrol_slots often limits DELETE to the volunteer).

CREATE OR REPLACE FUNCTION public.admin_delete_patrol_slot(p_slot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  ok boolean;
  deleted_count int;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = uid
      AND lower(trim(role::text)) IN ('admin', 'committee')
  ) INTO ok;

  IF NOT ok THEN
    RAISE EXCEPTION 'forbidden: admin or committee role required';
  END IF;

  DELETE FROM public.patrol_slots WHERE id = p_slot_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count = 0 THEN
    RAISE EXCEPTION 'patrol slot not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_patrol_slot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_patrol_slot(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_delete_patrol_slot(uuid) IS 'Delete one patrol_slots row; caller must be users.role admin or committee';
