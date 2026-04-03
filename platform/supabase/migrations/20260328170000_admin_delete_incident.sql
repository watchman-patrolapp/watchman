-- Admin-only hard delete for an incident and related rows (app: admin_delete_incident RPC)
-- Storage objects under incident-photos/{id}/ are removed from the client after this succeeds.

CREATE OR REPLACE FUNCTION public.admin_delete_incident(p_incident_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  is_admin boolean;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE id = uid AND lower(trim(role::text)) = 'admin'
  ) INTO is_admin;

  IF NOT is_admin THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  DELETE FROM public.profile_match_queue
  WHERE source_incident_id = p_incident_id
     OR source_evidence_id IN (
       SELECT id FROM public.incident_evidence WHERE incident_id = p_incident_id
     );

  DELETE FROM public.incident_evidence WHERE incident_id = p_incident_id;
  DELETE FROM public.incident_suspects WHERE incident_id = p_incident_id;
  DELETE FROM public.profile_incidents WHERE incident_id = p_incident_id;
  DELETE FROM public.incidents WHERE id = p_incident_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_incident(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_incident(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_delete_incident(uuid) IS 'Hard-delete one incident and related intelligence/evidence rows; caller must be users.role = admin';
