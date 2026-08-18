-- SOS is an emergency alert, not a written incident for the moderation queue.
-- Keep the incident row for analytics (type = SOS) with status approved.
-- Board listing RPC avoids fragile PostgREST embeds and includes the household address card.

ALTER TABLE public.sos_alerts
  ADD COLUMN IF NOT EXISTS acknowledged_by_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;

UPDATE public.incidents
SET status = 'approved'
WHERE upper(trim(coalesce(type, ''))) = 'SOS'
  AND lower(trim(coalesce(status, ''))) = 'pending';

CREATE OR REPLACE FUNCTION public.list_sos_board_alerts()
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  incident_id uuid,
  resident_id uuid,
  trigger_type text,
  escalation_level smallint,
  acknowledged_at timestamptz,
  acknowledged_by_user_id uuid,
  organization_id uuid,
  incident_status text,
  incident_description text,
  incident_location text,
  full_name text,
  email text,
  phone text,
  address text,
  home_address text,
  avatar_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.created_at,
    s.incident_id,
    s.resident_id,
    s.trigger_type,
    s.escalation_level,
    s.acknowledged_at,
    s.acknowledged_by_user_id,
    s.organization_id,
    i.status,
    i.description,
    i.location,
    u.full_name,
    u.email,
    u.phone,
    u.address,
    rp.home_address,
    u.avatar_url
  FROM public.sos_alerts s
  LEFT JOIN public.incidents i ON i.id = s.incident_id
  LEFT JOIN public.users u ON u.id = s.resident_id
  LEFT JOIN public.resident_profiles rp ON rp.user_id = s.resident_id
  WHERE
    auth.uid() IS NOT NULL
    AND (
      public.is_global_app_staff()
      OR public.is_platform_staff()
      OR s.resident_id = auth.uid()
      OR s.organization_id IN (SELECT public.current_org_ids())
      OR i.organization_id IN (SELECT public.current_org_ids())
    )
  ORDER BY s.created_at DESC
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.list_sos_board_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_sos_board_alerts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_sos_board_alerts() TO service_role;
