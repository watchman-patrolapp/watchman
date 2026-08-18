-- Partner overview was empty: coverage only followed security_assignments,
-- and Theescombe was not linked as a suburb/org. Resolve live Theescombe data.

INSERT INTO public.organization_suburbs (organization_id, suburb_id, assignment_type, active)
SELECT o.id, s.id, 'primary', true
FROM public.organizations o
JOIN public.suburbs s ON lower(s.name) = 'theescombe'
WHERE o.type = 'nw_group'
  AND (
    o.primary_suburb_id = s.id
    OR lower(o.name) LIKE '%theescombe%'
  )
ON CONFLICT (organization_id, suburb_id) DO UPDATE
SET active = true,
    assignment_type = EXCLUDED.assignment_type;

UPDATE public.organizations o
SET primary_suburb_id = s.id
FROM public.suburbs s
WHERE o.type = 'nw_group'
  AND o.primary_suburb_id IS NULL
  AND lower(s.name) = 'theescombe'
  AND lower(o.name) LIKE '%theescombe%';

-- Companies with no suburb assignment yet cover the live Theescombe area.
INSERT INTO public.security_assignments (security_company_id, suburb_id, assignment_type, active)
SELECT o.id, s.id, 'primary', true
FROM public.organizations o
JOIN public.suburbs s ON lower(s.name) = 'theescombe'
WHERE o.type = 'security_company'
  AND o.status <> 'suspended'
  AND NOT EXISTS (
    SELECT 1
    FROM public.security_assignments sa
    WHERE sa.security_company_id = o.id
      AND sa.active = true
  )
ON CONFLICT (security_company_id, suburb_id) DO UPDATE
SET active = true;

CREATE OR REPLACE FUNCTION public.my_security_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT u.organization_id
  FROM public.users u
  JOIN public.organizations o ON o.id = u.organization_id AND o.type = 'security_company'
  WHERE u.id = auth.uid()
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

CREATE OR REPLACE FUNCTION public.security_partner_can_view()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users cu
    WHERE cu.id = auth.uid()
      AND (
        replace(lower(trim(cu.role::text)), '-', '_') = 'security_admin'
        OR public.is_global_app_staff()
        OR public.is_platform_staff()
      )
  );
$$;

REVOKE ALL ON FUNCTION public.security_partner_can_view() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_partner_can_view() TO authenticated;

CREATE OR REPLACE FUNCTION public.security_partner_coverage_areas()
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
  WITH my_companies AS (
    SELECT o.id, o.settings_json
    FROM public.organizations o
    WHERE o.id IN (SELECT public.my_security_company_ids())
      AND o.type = 'security_company'
  ),
  nw_for_suburb AS (
    SELECT DISTINCT ON (s.id)
      s.id AS suburb_id,
      os.organization_id,
      o.name AS organization_name
    FROM public.suburbs s
    LEFT JOIN public.organization_suburbs os
      ON os.suburb_id = s.id AND os.active = true
    LEFT JOIN public.organizations o
      ON o.id = os.organization_id AND o.type = 'nw_group'
    LEFT JOIN public.organizations po
      ON po.primary_suburb_id = s.id AND po.type = 'nw_group'
    ORDER BY
      s.id,
      CASE WHEN o.id IS NOT NULL THEN 0 ELSE 1 END,
      o.name
  ),
  explicit AS (
    SELECT
      s.id AS suburb_id,
      s.name AS suburb_name,
      sa.assignment_type,
      coalesce(n.organization_id, po.id) AS organization_id,
      coalesce(n.organization_name, po.name) AS organization_name
    FROM public.security_assignments sa
    JOIN public.suburbs s ON s.id = sa.suburb_id
    LEFT JOIN nw_for_suburb n ON n.suburb_id = s.id
    LEFT JOIN public.organizations po
      ON po.primary_suburb_id = s.id AND po.type = 'nw_group'
    WHERE sa.active = true
      AND sa.security_company_id IN (SELECT id FROM my_companies)
  ),
  city_wide AS (
    SELECT
      s.id AS suburb_id,
      s.name AS suburb_name,
      'primary'::text AS assignment_type,
      n.organization_id,
      n.organization_name
    FROM my_companies c
    JOIN public.suburbs s
      ON s.active = true
     AND (s.city_id = public.default_city_id() OR public.default_city_id() IS NULL)
    LEFT JOIN nw_for_suburb n ON n.suburb_id = s.id
    WHERE coalesce(c.settings_json->>'coverage_scope', c.settings_json->>'latest_signup_coverage_scope', '') = 'city'
  ),
  pilot AS (
    SELECT
      s.id AS suburb_id,
      s.name AS suburb_name,
      'primary'::text AS assignment_type,
      coalesce(n.organization_id, o.id) AS organization_id,
      coalesce(n.organization_name, o.name) AS organization_name
    FROM public.suburbs s
    LEFT JOIN nw_for_suburb n ON n.suburb_id = s.id
    LEFT JOIN public.organizations o
      ON o.type = 'nw_group'
     AND lower(o.name) LIKE '%theescombe%'
    WHERE lower(s.name) = 'theescombe'
      AND (
        EXISTS (SELECT 1 FROM my_companies)
        OR public.is_global_app_staff()
        OR public.is_platform_staff()
      )
  )
  SELECT DISTINCT ON (suburb_id, organization_id)
    suburb_id,
    suburb_name,
    assignment_type,
    organization_id,
    organization_name
  FROM (
    SELECT * FROM explicit
    UNION ALL
    SELECT * FROM city_wide
    UNION ALL
    SELECT * FROM pilot
    WHERE NOT EXISTS (SELECT 1 FROM explicit)
      AND NOT EXISTS (SELECT 1 FROM city_wide)
  ) coverage
  WHERE public.security_partner_can_view()
  ORDER BY suburb_id, organization_id, suburb_name;
$$;

REVOKE ALL ON FUNCTION public.security_partner_coverage_areas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_partner_coverage_areas() TO authenticated;
GRANT EXECUTE ON FUNCTION public.security_partner_coverage_areas() TO service_role;

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
  SELECT suburb_id, suburb_name, assignment_type, organization_id, organization_name
  FROM public.security_partner_coverage_areas();
$$;

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
  WITH assigned AS (
    SELECT * FROM public.security_partner_coverage_areas()
  )
  SELECT
    ap.user_id,
    coalesce(nullif(trim(u.full_name), ''), ap.user_name, u.email, 'Patroller'),
    u.phone,
    ap.zone,
    ap.start_time,
    coalesce(o.name, a.organization_name),
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
  LEFT JOIN LATERAL (
    SELECT organization_name
    FROM assigned
    WHERE organization_id = ap.organization_id
       OR lower(trim(coalesce(ap.zone, ''))) = lower(trim(suburb_name))
    LIMIT 1
  ) a ON true
  WHERE public.security_partner_can_view()
    AND (
      ap.organization_id IN (SELECT organization_id FROM assigned WHERE organization_id IS NOT NULL)
      OR lower(trim(coalesce(ap.zone, ''))) IN (SELECT lower(trim(suburb_name)) FROM assigned)
      OR (
        ap.organization_id IS NULL
        AND EXISTS (
          SELECT 1 FROM assigned
          WHERE lower(suburb_name) = 'theescombe'
        )
      )
    )
  ORDER BY ap.start_time DESC NULLS LAST;
$$;

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
    SELECT *
    FROM public.security_partner_coverage_areas()
    WHERE p_suburb_id IS NULL OR suburb_id = p_suburb_id
  )
  SELECT
    ps.id,
    ps.date,
    ps.start_time::text,
    ps.end_time::text,
    ps.zone,
    ps.volunteer_name,
    coalesce(o.name, a.organization_name)
  FROM public.patrol_slots ps
  LEFT JOIN public.organizations o ON o.id = ps.organization_id
  LEFT JOIN LATERAL (
    SELECT organization_name
    FROM assigned
    WHERE organization_id = ps.organization_id
       OR lower(trim(coalesce(ps.zone, ''))) = lower(trim(suburb_name))
    LIMIT 1
  ) a ON true
  WHERE public.security_partner_can_view()
    AND ps.date >= current_date
    AND (
      ps.organization_id IN (SELECT organization_id FROM assigned WHERE organization_id IS NOT NULL)
      OR lower(trim(coalesce(ps.zone, ''))) IN (SELECT lower(trim(suburb_name)) FROM assigned)
      OR (
        ps.organization_id IS NULL
        AND EXISTS (
          SELECT 1 FROM assigned
          WHERE lower(suburb_name) = 'theescombe'
        )
      )
    )
  ORDER BY ps.date, ps.start_time;
$$;

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
    SELECT * FROM public.security_partner_coverage_areas()
  )
  SELECT
    i.id,
    i.incident_date::timestamptz,
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
       OR a.suburb_id = ru.home_suburb_id
    ORDER BY a.suburb_name
    LIMIT 1
  ) asg ON true
  WHERE public.security_partner_can_view()
    AND (
      i.organization_id IN (SELECT organization_id FROM assigned WHERE organization_id IS NOT NULL)
      OR ru.home_suburb_id IN (SELECT suburb_id FROM assigned)
      OR (
        i.organization_id IS NULL
        AND EXISTS (
          SELECT 1 FROM assigned
          WHERE lower(suburb_name) = 'theescombe'
        )
      )
    )
  ORDER BY coalesce(i.submitted_at, i.incident_date::timestamptz) DESC NULLS LAST
  LIMIT 250;
$$;
