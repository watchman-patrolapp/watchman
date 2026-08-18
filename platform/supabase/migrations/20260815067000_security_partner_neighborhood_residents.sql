-- Partner Residents list: registered households in covered neighborhoods,
-- not only people who linked a security-company membership.

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
  WITH covered AS (
    SELECT DISTINCT
      organization_id,
      suburb_id,
      suburb_name,
      organization_name
    FROM public.security_partner_coverage_areas()
  ),
  matched AS (
    SELECT DISTINCT ON (u.id)
      u.id AS user_id,
      coalesce(c.organization_id, u.organization_id) AS neighborhood_id,
      coalesce(c.organization_name, nw.name) AS neighborhood_name,
      coalesce(u.home_suburb_id, c.suburb_id) AS suburb_id,
      coalesce(s.name, c.suburb_name) AS suburb_name
    FROM public.users u
    LEFT JOIN public.organizations nw
      ON nw.id = u.organization_id AND nw.type = 'nw_group'
    LEFT JOIN public.suburbs s ON s.id = u.home_suburb_id
    LEFT JOIN covered c
      ON c.organization_id = u.organization_id
      OR (
        c.organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.organization_members om
          WHERE om.user_id = u.id
            AND om.organization_id = c.organization_id
            AND om.status = 'active'
        )
      )
      OR (
        c.suburb_id IS NOT NULL
        AND u.home_suburb_id = c.suburb_id
      )
    WHERE public.security_partner_can_view()
      AND replace(lower(trim(u.role::text)), '-', '_') IN ('resident', 'user')
      AND (
        u.organization_id IN (SELECT organization_id FROM covered WHERE organization_id IS NOT NULL)
        OR u.home_suburb_id IN (SELECT suburb_id FROM covered WHERE suburb_id IS NOT NULL)
        OR EXISTS (
          SELECT 1
          FROM public.organization_members om
          JOIN covered c2 ON c2.organization_id = om.organization_id
          WHERE om.user_id = u.id
            AND om.status = 'active'
        )
      )
    ORDER BY
      u.id,
      CASE WHEN c.organization_id = u.organization_id THEN 0 ELSE 1 END,
      c.organization_name
  )
  SELECT
    u.id,
    u.full_name,
    nullif(split_part(trim(coalesce(u.full_name, '')), ' ', 1), ''),
    nullif(btrim(substr(trim(coalesce(u.full_name, '')), length(split_part(trim(coalesce(u.full_name, '')), ' ', 1)) + 1)), ''),
    m.security_company_id,
    sc.name,
    CASE
      WHEN rp.verification_date IS NOT NULL THEN 'verified'
      WHEN m.resident_user_id IS NOT NULL THEN coalesce(nullif(trim(m.membership_status), ''), 'linked')
      ELSE 'registered'
    END,
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
    matched.suburb_id,
    matched.suburb_name,
    matched.neighborhood_id,
    matched.neighborhood_name,
    public.resident_street_label(coalesce(nullif(trim(rp.home_address), ''), u.address))
  FROM matched
  JOIN public.users u ON u.id = matched.user_id
  LEFT JOIN public.resident_profiles rp ON rp.user_id = u.id
  LEFT JOIN LATERAL (
    SELECT mm.*
    FROM public.resident_security_memberships mm
    WHERE mm.resident_user_id = u.id
      AND mm.security_company_id IN (SELECT public.my_security_company_ids())
    ORDER BY mm.created_at DESC NULLS LAST
    LIMIT 1
  ) m ON true
  LEFT JOIN public.organizations sc ON sc.id = m.security_company_id
  LEFT JOIN public.security_company_branding b ON b.security_company_id = m.security_company_id
  ORDER BY lower(trim(coalesce(matched.neighborhood_name, ''))), lower(trim(coalesce(u.full_name, '')));
$$;

REVOKE ALL ON FUNCTION public.security_partner_residents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_partner_residents() TO authenticated;
GRANT EXECUTE ON FUNCTION public.security_partner_residents() TO service_role;
