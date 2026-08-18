-- Areas on the security command dashboard are registered neighborhood watches,
-- not only suburbs that already have a security_assignments row (Theescombe).

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
    SELECT o.id, o.city_id
    FROM public.organizations o
    WHERE o.id IN (SELECT public.my_security_company_ids())
      AND o.type = 'security_company'
  ),
  registered AS (
    SELECT DISTINCT ON (o.id)
      coalesce(o.primary_suburb_id, os.suburb_id) AS suburb_id,
      coalesce(ps.name, osn.name, o.name) AS suburb_name,
      'primary'::text AS assignment_type,
      o.id AS organization_id,
      o.name AS organization_name
    FROM public.organizations o
    LEFT JOIN public.organization_suburbs os
      ON os.organization_id = o.id AND os.active = true
    LEFT JOIN public.suburbs ps ON ps.id = o.primary_suburb_id
    LEFT JOIN public.suburbs osn ON osn.id = os.suburb_id
    WHERE o.type = 'nw_group'
      AND o.status <> 'suspended'
      AND (
        o.city_id IS NULL
        OR public.default_city_id() IS NULL
        OR o.city_id = public.default_city_id()
        OR o.city_id IN (SELECT city_id FROM my_companies WHERE city_id IS NOT NULL)
      )
    ORDER BY
      o.id,
      CASE WHEN o.primary_suburb_id IS NOT NULL THEN 0 ELSE 1 END,
      os.suburb_id NULLS LAST
  )
  SELECT
    r.suburb_id,
    r.suburb_name,
    r.assignment_type,
    r.organization_id,
    r.organization_name
  FROM registered r
  WHERE public.security_partner_can_view()
  ORDER BY lower(trim(r.organization_name)), r.organization_id;
$$;

REVOKE ALL ON FUNCTION public.security_partner_coverage_areas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_partner_coverage_areas() TO authenticated;
GRANT EXECUTE ON FUNCTION public.security_partner_coverage_areas() TO service_role;

CREATE OR REPLACE FUNCTION public.security_partner_assigned_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT DISTINCT organization_id
  FROM public.security_partner_coverage_areas()
  WHERE organization_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.security_partner_assigned_org_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_partner_assigned_org_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.security_partner_assigned_org_ids() TO service_role;

DROP FUNCTION IF EXISTS public.security_partner_live_patrols();
CREATE OR REPLACE FUNCTION public.security_partner_live_patrols()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  phone text,
  zone text,
  start_time timestamptz,
  organization_id uuid,
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
    coalesce(ap.organization_id, a.organization_id),
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
    SELECT organization_id, organization_name
    FROM assigned
    WHERE organization_id = ap.organization_id
       OR lower(trim(coalesce(ap.zone, ''))) = lower(trim(suburb_name))
       OR lower(trim(coalesce(ap.zone, ''))) = lower(trim(organization_name))
    LIMIT 1
  ) a ON true
  WHERE public.security_partner_can_view()
    AND (
      ap.organization_id IN (SELECT organization_id FROM assigned WHERE organization_id IS NOT NULL)
      OR lower(trim(coalesce(ap.zone, ''))) IN (
        SELECT lower(trim(suburb_name)) FROM assigned WHERE suburb_name IS NOT NULL
      )
      OR lower(trim(coalesce(ap.zone, ''))) IN (
        SELECT lower(trim(organization_name)) FROM assigned WHERE organization_name IS NOT NULL
      )
      OR (
        ap.organization_id IS NULL
        AND EXISTS (
          SELECT 1 FROM assigned
          WHERE lower(suburb_name) = 'theescombe'
             OR lower(organization_name) LIKE '%theescombe%'
        )
      )
    )
  ORDER BY ap.start_time DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.security_partner_live_patrols() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_partner_live_patrols() TO authenticated;
GRANT EXECUTE ON FUNCTION public.security_partner_live_patrols() TO service_role;

DROP FUNCTION IF EXISTS public.security_partner_scheduled_patrols(uuid);
CREATE OR REPLACE FUNCTION public.security_partner_scheduled_patrols(p_suburb_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  slot_date date,
  start_time text,
  end_time text,
  zone text,
  volunteer_name text,
  organization_id uuid,
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
    WHERE p_suburb_id IS NULL
       OR suburb_id = p_suburb_id
       OR organization_id = p_suburb_id
  )
  SELECT
    ps.id,
    ps.date,
    ps.start_time::text,
    ps.end_time::text,
    ps.zone,
    ps.volunteer_name,
    coalesce(ps.organization_id, a.organization_id),
    coalesce(o.name, a.organization_name)
  FROM public.patrol_slots ps
  LEFT JOIN public.organizations o ON o.id = ps.organization_id
  LEFT JOIN LATERAL (
    SELECT organization_id, organization_name
    FROM assigned
    WHERE organization_id = ps.organization_id
       OR lower(trim(coalesce(ps.zone, ''))) = lower(trim(suburb_name))
       OR lower(trim(coalesce(ps.zone, ''))) = lower(trim(organization_name))
    LIMIT 1
  ) a ON true
  WHERE public.security_partner_can_view()
    AND ps.date >= current_date
    AND (
      ps.organization_id IN (SELECT organization_id FROM assigned WHERE organization_id IS NOT NULL)
      OR lower(trim(coalesce(ps.zone, ''))) IN (
        SELECT lower(trim(suburb_name)) FROM assigned WHERE suburb_name IS NOT NULL
      )
      OR lower(trim(coalesce(ps.zone, ''))) IN (
        SELECT lower(trim(organization_name)) FROM assigned WHERE organization_name IS NOT NULL
      )
      OR (
        ps.organization_id IS NULL
        AND EXISTS (
          SELECT 1 FROM assigned
          WHERE lower(suburb_name) = 'theescombe'
             OR lower(organization_name) LIKE '%theescombe%'
        )
      )
    )
  ORDER BY ps.date, ps.start_time;
$$;

REVOKE ALL ON FUNCTION public.security_partner_scheduled_patrols(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_partner_scheduled_patrols(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.security_partner_scheduled_patrols(uuid) TO service_role;
