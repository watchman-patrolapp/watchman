-- Security company + city admin / police dashboards.
-- Partner staff may only see assigned areas, their own members, and patrols in those areas.

CREATE OR REPLACE FUNCTION public.is_hotspot_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND replace(lower(trim(u.role::text)), '-', '_') IN (
        'admin',
        'committee',
        'technical_support',
        'nw_admin',
        'security_admin',
        'city_admin'
      )
  )
  OR public.is_global_app_staff()
  OR public.is_platform_staff();
$$;

CREATE OR REPLACE FUNCTION public.my_security_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT u.organization_id
  FROM public.users u
  WHERE u.id = auth.uid()
    AND u.organization_id IS NOT NULL
    AND (
      replace(lower(trim(u.role::text)), '-', '_') = 'security_admin'
      OR public.is_global_app_staff()
      OR public.is_platform_staff()
    )
  UNION
  SELECT om.organization_id
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.user_id = auth.uid()
    AND om.status = 'active'
    AND o.type = 'security_company'
    AND (
      lower(trim(om.member_role)) = 'security_admin'
      OR public.is_global_app_staff()
      OR public.is_platform_staff()
    );
$$;

REVOKE ALL ON FUNCTION public.my_security_company_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_security_company_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_security_company_ids() TO service_role;

CREATE OR REPLACE FUNCTION public.security_partner_areas()
RETURNS TABLE (
  suburb_id uuid,
  suburb_name text,
  assignment_type text,
  organization_id uuid,
  organization_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    s.id,
    s.name,
    sa.assignment_type,
    os.organization_id,
    o.name
  FROM public.security_assignments sa
  JOIN public.suburbs s ON s.id = sa.suburb_id
  LEFT JOIN public.organization_suburbs os ON os.suburb_id = sa.suburb_id
  LEFT JOIN public.organizations o ON o.id = os.organization_id AND o.type = 'nw_group'
  WHERE sa.active = true
    AND sa.security_company_id IN (SELECT public.my_security_company_ids())
    AND (
      EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid()
          AND replace(lower(trim(u.role::text)), '-', '_') = 'security_admin'
      )
      OR public.is_global_app_staff()
      OR public.is_platform_staff()
    );
$$;

REVOKE ALL ON FUNCTION public.security_partner_areas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_partner_areas() TO authenticated;

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
  incident_count bigint
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
    )
  FROM public.resident_security_memberships m
  JOIN public.users u ON u.id = m.resident_user_id
  JOIN public.organizations o ON o.id = m.security_company_id
  LEFT JOIN public.security_company_branding b ON b.security_company_id = m.security_company_id
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

CREATE OR REPLACE FUNCTION public.security_partner_live_patrols()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  phone text,
  zone text,
  start_time timestamptz,
  organization_name text,
  latitude double precision,
  longitude double precision,
  last_gps_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH assigned_orgs AS (
    SELECT DISTINCT os.organization_id
    FROM public.security_assignments sa
    JOIN public.organization_suburbs os ON os.suburb_id = sa.suburb_id
    WHERE sa.active = true
      AND sa.security_company_id IN (SELECT public.my_security_company_ids())
  )
  SELECT
    ap.user_id,
    coalesce(nullif(trim(u.full_name), ''), ap.user_name, u.email, 'Patroller'),
    u.phone,
    ap.zone,
    ap.start_time,
    o.name,
    loc.latitude,
    loc.longitude,
    loc.last_gps_at
  FROM public.active_patrols ap
  LEFT JOIN public.users u ON u.id = ap.user_id
  LEFT JOIN public.organizations o ON o.id = ap.organization_id
  LEFT JOIN LATERAL (
    SELECT pl.latitude, pl.longitude, coalesce(pl."timestamp", pl.created_at) AS last_gps_at
    FROM public.patrol_locations pl
    WHERE pl.patrol_id = ap.user_id
      AND pl.deleted_at IS NULL
      AND coalesce(pl.is_archived, false) = false
    ORDER BY coalesce(pl."timestamp", pl.created_at) DESC
    LIMIT 1
  ) loc ON true
  WHERE (
    ap.organization_id IN (SELECT organization_id FROM assigned_orgs)
    OR (
      NOT EXISTS (SELECT 1 FROM assigned_orgs)
      AND ap.organization_id IN (SELECT public.current_org_ids())
    )
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
  ORDER BY ap.start_time DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.security_partner_live_patrols() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_partner_live_patrols() TO authenticated;

CREATE OR REPLACE FUNCTION public.security_partner_scheduled_patrols(p_suburb_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  slot_date date,
  start_time text,
  end_time text,
  zone text,
  volunteer_name text,
  organization_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH assigned AS (
    SELECT
      sa.suburb_id,
      s.name AS suburb_name,
      os.organization_id
    FROM public.security_assignments sa
    JOIN public.suburbs s ON s.id = sa.suburb_id
    LEFT JOIN public.organization_suburbs os ON os.suburb_id = sa.suburb_id
    WHERE sa.active = true
      AND sa.security_company_id IN (SELECT public.my_security_company_ids())
      AND (p_suburb_id IS NULL OR sa.suburb_id = p_suburb_id)
  )
  SELECT
    ps.id,
    ps.date,
    ps.start_time::text,
    ps.end_time::text,
    ps.zone,
    ps.volunteer_name,
    o.name
  FROM public.patrol_slots ps
  LEFT JOIN public.organizations o ON o.id = ps.organization_id
  WHERE ps.date >= current_date
    AND (
      ps.organization_id IN (SELECT organization_id FROM assigned WHERE organization_id IS NOT NULL)
      OR lower(trim(coalesce(ps.zone, ''))) IN (
        SELECT lower(trim(suburb_name)) FROM assigned
      )
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
  ORDER BY ps.date, ps.start_time;
$$;

REVOKE ALL ON FUNCTION public.security_partner_scheduled_patrols(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_partner_scheduled_patrols(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.city_admin_communities()
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  organization_type text,
  status text,
  member_count bigint,
  admin_name text,
  admin_email text,
  admin_phone text,
  admin_role text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    o.id,
    o.name,
    o.type,
    o.status,
    (
      SELECT count(*)
      FROM public.organization_members om
      WHERE om.organization_id = o.id
        AND om.status = 'active'
    ),
    u.full_name,
    u.email::text,
    u.phone,
    u.role::text
  FROM public.organizations o
  LEFT JOIN LATERAL (
    SELECT cu.full_name, cu.email, cu.phone, cu.role
    FROM public.organization_members om
    JOIN public.users cu ON cu.id = om.user_id
    WHERE om.organization_id = o.id
      AND om.status = 'active'
      AND lower(trim(om.member_role)) IN ('nw_admin', 'admin', 'committee', 'city_admin')
    ORDER BY
      CASE lower(trim(om.member_role))
        WHEN 'nw_admin' THEN 0
        WHEN 'admin' THEN 1
        WHEN 'city_admin' THEN 2
        ELSE 3
      END,
      cu.full_name
    LIMIT 1
  ) u ON true
  WHERE o.type IN ('nw_group', 'security_company', 'city_admin')
    AND (
      EXISTS (
        SELECT 1 FROM public.users cu
        WHERE cu.id = auth.uid()
          AND replace(lower(trim(cu.role::text)), '-', '_') = 'city_admin'
      )
      OR public.is_global_app_staff()
      OR public.is_platform_staff()
    )
  ORDER BY o.type, lower(o.name);
$$;

REVOKE ALL ON FUNCTION public.city_admin_communities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.city_admin_communities() TO authenticated;
GRANT EXECUTE ON FUNCTION public.city_admin_communities() TO service_role;
