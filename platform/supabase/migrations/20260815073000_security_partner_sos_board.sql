-- Security command SOS board: every assigned neighborhood, not the working-area /sos board.

CREATE OR REPLACE FUNCTION public.security_partner_sos_alerts()
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
  organization_name text,
  suburb_id uuid,
  suburb_name text,
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
  WITH assigned AS (
    SELECT * FROM public.security_partner_coverage_areas()
  )
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
    COALESCE(s.organization_id, i.organization_id, u.organization_id),
    COALESCE(NULLIF(trim(o.name), ''), NULLIF(trim(asg.organization_name), ''), NULLIF(trim(sub.name), '')),
    COALESCE(asg.suburb_id, u.home_suburb_id),
    COALESCE(NULLIF(trim(asg.suburb_name), ''), NULLIF(trim(sub.name), '')),
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
  LEFT JOIN public.organizations o
    ON o.id = COALESCE(s.organization_id, i.organization_id, u.organization_id)
  LEFT JOIN public.suburbs sub
    ON sub.id = COALESCE(o.primary_suburb_id, u.home_suburb_id)
  LEFT JOIN LATERAL (
    SELECT a.organization_id, a.organization_name, a.suburb_id, a.suburb_name
    FROM assigned a
    WHERE a.organization_id = COALESCE(s.organization_id, i.organization_id, u.organization_id)
       OR a.suburb_id = u.home_suburb_id
    ORDER BY a.organization_name
    LIMIT 1
  ) asg ON true
  WHERE public.security_partner_can_view()
    AND (
      COALESCE(s.organization_id, i.organization_id, u.organization_id) IN (
        SELECT organization_id FROM assigned WHERE organization_id IS NOT NULL
      )
      OR u.home_suburb_id IN (
        SELECT suburb_id FROM assigned WHERE suburb_id IS NOT NULL
      )
    )
  ORDER BY s.created_at DESC
  LIMIT 150;
$$;

REVOKE ALL ON FUNCTION public.security_partner_sos_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_partner_sos_alerts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.security_partner_sos_alerts() TO service_role;

COMMENT ON FUNCTION public.security_partner_sos_alerts() IS
  'SOS alerts across every neighborhood assigned to the caller''s security company.';

CREATE OR REPLACE FUNCTION public.security_partner_sos_update(
  p_alert_id uuid,
  p_action text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  IF NOT public.security_partner_can_view() THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF p_action NOT IN ('respond', 'resolve') THEN
    RAISE EXCEPTION 'Invalid SOS action';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.sos_alerts s
    LEFT JOIN public.incidents i ON i.id = s.incident_id
    LEFT JOIN public.users u ON u.id = s.resident_id
    WHERE s.id = p_alert_id
      AND (
        COALESCE(s.organization_id, i.organization_id, u.organization_id) IN (
          SELECT organization_id
          FROM public.security_partner_coverage_areas()
          WHERE organization_id IS NOT NULL
        )
        OR u.home_suburb_id IN (
          SELECT suburb_id
          FROM public.security_partner_coverage_areas()
          WHERE suburb_id IS NOT NULL
        )
      )
  )
  INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'SOS is not in an assigned area';
  END IF;

  IF p_action = 'respond' THEN
    UPDATE public.sos_alerts
    SET
      acknowledged_at = COALESCE(acknowledged_at, now()),
      acknowledged_by_user_id = COALESCE(acknowledged_by_user_id, auth.uid())
    WHERE id = p_alert_id
      AND resolved_at IS NULL;
  ELSE
    UPDATE public.sos_alerts
    SET
      resolved_at = now(),
      resolved_by_user_id = auth.uid()
    WHERE id = p_alert_id
      AND resolved_at IS NULL;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.security_partner_sos_update(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_partner_sos_update(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.security_partner_sos_update(uuid, text) TO service_role;
