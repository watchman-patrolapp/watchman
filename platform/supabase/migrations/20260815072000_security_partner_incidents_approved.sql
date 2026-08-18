-- Partner incident list matches the watch Incident reports page: approved only.
-- Resident reports are household SOS / activity reports, not every patrol type.

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
      upper(coalesce(i.type, '')) = 'SOS'
      OR replace(lower(trim(coalesce(ru.role::text, ''))), '-', '_') IN ('resident', 'user')
      OR EXISTS (
        SELECT 1
        FROM public.resident_report_events e
        WHERE e.incident_id = i.id
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
    AND lower(trim(coalesce(i.status, ''))) = 'approved'
    AND lower(trim(coalesce(i.status, ''))) <> 'rejected'
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

REVOKE ALL ON FUNCTION public.security_partner_incidents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_partner_incidents() TO authenticated;
GRANT EXECUTE ON FUNCTION public.security_partner_incidents() TO service_role;
