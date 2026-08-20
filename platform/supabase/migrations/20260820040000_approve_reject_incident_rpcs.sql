-- Approve + reject incident RPCs used by IncidentModeration (with pending guard).

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

CREATE OR REPLACE FUNCTION public.approve_incident(p_incident_id uuid, p_admin_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  UPDATE public.incidents
  SET
    status = 'approved',
    approved_by = p_admin_id,
    approved_at = now()
  WHERE id = p_incident_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'incident not pending or not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_incident(
  p_incident_id uuid,
  p_admin_id uuid,
  p_rejection_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  UPDATE public.incidents
  SET
    status = 'rejected',
    rejected_by = p_admin_id,
    rejected_at = now(),
    rejection_reason = nullif(trim(p_rejection_reason), '')
  WHERE id = p_incident_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'incident not pending or not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_incident(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_incident(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.reject_incident(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_incident(uuid, uuid, text) TO authenticated;
