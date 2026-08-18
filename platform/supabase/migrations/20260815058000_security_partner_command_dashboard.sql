-- Security company command dashboard: assigned-area incidents + resident area labels.
-- Partner staff still only see neighborhoods they are assigned to.

CREATE OR REPLACE FUNCTION public.security_partner_assigned_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT DISTINCT os.organization_id
  FROM public.security_assignments sa
  JOIN public.organization_suburbs os ON os.suburb_id = sa.suburb_id
  JOIN public.organizations o ON o.id = os.organization_id AND o.type = 'nw_group'
  WHERE sa.active = true
    AND sa.security_company_id IN (SELECT public.my_security_company_ids())
    AND os.organization_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.security_partner_assigned_org_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_partner_assigned_org_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.security_partner_assigned_org_ids() TO service_role;

DROP FUNCTION IF EXISTS public.security_partner_residents();

CREATE OR REPLACE FUNCTION public.security_partner_residents()
RETURNS TABLE (
  resident_user_id uuid,
  full_name text,
  first_name text,
  last_name text,
  security_company_id uuid,
  security_company_name text,
  membership_status text,
  logo_url text,
  primary_color_token text,
  secondary_color_token text,
  card_style text,
  sos_count bigint,
  incident_count bigint,
  suburb_id uuid,
  suburb_name text,
  neighborhood_id uuid,
  neighborhood_name text,
  street_label text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    u.id,
    u.full_name,
    nullif(split_part(trim(coalesce(u.full_name, '')), ' ', 1), ''),
    nullif(btrim(substr(trim(coalesce(u.full_name, '')), length(split_part(trim(coalesce(u.full_name, '')), ' ', 1)) + 1)), ''),
    m.security_company_id,
    o.name,
    m.membership_status,
    b.logo_url,
    b.primary_color_token,
    b.secondary_color_token,
    b.card_style,
    (
      SELECT count(*)
      FROM public.sos_alerts sos
      WHERE sos.resident_id = u.id
    ),
    (
      SELECT count(*)
      FROM public.incidents i
      WHERE i.reporter_id = u.id
    ),
    u.home_suburb_id,
    s.name,
    u.organization_id,
    nw.name,
    public.resident_street_label(coalesce(nullif(trim(rp.home_address), ''), u.address))
  FROM public.resident_security_memberships m
  JOIN public.users u ON u.id = m.resident_user_id
  JOIN public.organizations o ON o.id = m.security_company_id
  LEFT JOIN public.security_company_branding b ON b.security_company_id = m.security_company_id
  LEFT JOIN public.suburbs s ON s.id = u.home_suburb_id
  LEFT JOIN public.organizations nw ON nw.id = u.organization_id AND nw.type = 'nw_group'
  LEFT JOIN public.resident_profiles rp ON rp.user_id = u.id
  WHERE m.security_company_id IN (SELECT public.my_security_company_ids())
    AND (
      EXISTS (
        SELECT 1 FROM public.users cu
        WHERE cu.id = auth.uid()
          AND replace(lower(trim(cu.role::text)), '-', '_') = 'security_admin'
      )
      OR public.is_global_app_staff()
      OR public.is_platform_staff()
    )
  ORDER BY lower(trim(coalesce(u.full_name, '')));
$$;

REVOKE ALL ON FUNCTION public.security_partner_residents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_partner_residents() TO authenticated;

CREATE OR REPLACE FUNCTION public.security_partner_incidents()
RETURNS TABLE (
  id uuid,
  incident_date timestamptz,
  submitted_at timestamptz,
  type text,
  title text,
  description text,
  location text,
  status text,
  organization_id uuid,
  organization_name text,
  suburb_id uuid,
  suburb_name text,
  reporter_id uuid,
  reporter_name text,
  reporter_role text,
  is_resident_report boolean,
  is_anonymous_tip boolean,
  is_sos boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH assigned AS (
    SELECT DISTINCT
      sa.suburb_id,
      s.name AS suburb_name,
      os.organization_id
    FROM public.security_assignments sa
    JOIN public.suburbs s ON s.id = sa.suburb_id
    LEFT JOIN public.organization_suburbs os ON os.suburb_id = sa.suburb_id
    WHERE sa.active = true
      AND sa.security_company_id IN (SELECT public.my_security_company_ids())
  )
  SELECT
    i.id,
    i.incident_date,
    i.submitted_at,
    i.type,
    i.title,
    left(coalesce(i.description, ''), 280),
    i.location,
    i.status,
    i.organization_id,
    o.name,
    coalesce(asg.suburb_id, ru.home_suburb_id),
    coalesce(asg.suburb_name, s.name),
    i.reporter_id,
    CASE
      WHEN coalesce(i.is_anonymous_tip, false) THEN 'Anonymous resident'
      ELSE coalesce(nullif(trim(i.submitted_by_name), ''), nullif(trim(ru.full_name), ''), 'Reporter')
    END,
    ru.role::text,
    (
      replace(lower(trim(coalesce(ru.role::text, ''))), '-', '_') IN ('resident', 'user')
      OR EXISTS (
        SELECT 1
        FROM public.resident_report_events e
        WHERE e.incident_id = i.id
      )
      OR lower(coalesce(i.type, '')) IN (
        'suspicious activity',
        'suspicious vehicle',
        'noise complaint',
        'other'
      )
    ),
    coalesce(i.is_anonymous_tip, false),
    upper(coalesce(i.type, '')) = 'SOS'
  FROM public.incidents i
  LEFT JOIN public.organizations o ON o.id = i.organization_id
  LEFT JOIN public.users ru ON ru.id = i.reporter_id
  LEFT JOIN public.suburbs s ON s.id = ru.home_suburb_id
  LEFT JOIN LATERAL (
    SELECT a.suburb_id, a.suburb_name
    FROM assigned a
    WHERE a.organization_id = i.organization_id
    ORDER BY a.suburb_name
    LIMIT 1
  ) asg ON true
  WHERE (
    i.organization_id IN (SELECT organization_id FROM assigned WHERE organization_id IS NOT NULL)
    OR ru.home_suburb_id IN (SELECT suburb_id FROM assigned)
  )
    AND (
      EXISTS (
        SELECT 1 FROM public.users cu
        WHERE cu.id = auth.uid()
          AND replace(lower(trim(cu.role::text)), '-', '_') = 'security_admin'
      )
      OR public.is_global_app_staff()
      OR public.is_platform_staff()
    )
  ORDER BY coalesce(i.submitted_at, i.incident_date) DESC NULLS LAST
  LIMIT 250;
$$;

REVOKE ALL ON FUNCTION public.security_partner_incidents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_partner_incidents() TO authenticated;
GRANT EXECUTE ON FUNCTION public.security_partner_incidents() TO service_role;
