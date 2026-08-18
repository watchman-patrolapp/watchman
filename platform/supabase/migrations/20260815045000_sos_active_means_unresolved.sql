-- Active SOS = not resolved on the SOS board.
-- Do not use incident moderation status (pending/approved/rejected) to hide a live emergency.

ALTER TABLE public.sos_alerts
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.is_sos_responder()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_global_app_staff()
    OR public.is_platform_staff()
    OR EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND replace(lower(trim(cu.role::text)), '-', '_') IN (
          'admin',
          'technical_support',
          'nw_admin',
          'committee',
          'patroller',
          'volunteer',
          'investigator',
          'security_admin',
          'city_admin'
        )
    );
$$;

REVOKE ALL ON FUNCTION public.is_sos_responder() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_sos_responder() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_sos_responder() TO service_role;

-- Return type adds resolved_* columns; DROP first (CREATE OR REPLACE cannot change OUT columns).
DROP FUNCTION IF EXISTS public.list_sos_board_alerts();

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
  resolved_at timestamptz,
  resolved_by_user_id uuid,
  acknowledged_by_name text,
  resolved_by_name text,
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
    s.resolved_at,
    s.resolved_by_user_id,
    COALESCE(NULLIF(trim(ack.full_name), ''), ack.email::text),
    COALESCE(NULLIF(trim(res.full_name), ''), res.email::text),
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
  LEFT JOIN public.users ack ON ack.id = s.acknowledged_by_user_id
  LEFT JOIN public.users res ON res.id = s.resolved_by_user_id
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
