-- Neighborhood member counts for the security Areas panel (view-only).

CREATE OR REPLACE FUNCTION public.security_partner_neighborhood_counts()
RETURNS TABLE (
  organization_id uuid,
  member_count bigint,
  resident_count bigint,
  linked_resident_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    a.organization_id,
    (
      SELECT count(*)::bigint
      FROM public.users u
      WHERE u.organization_id = a.organization_id
    ),
    (
      SELECT count(*)::bigint
      FROM public.users u
      WHERE u.organization_id = a.organization_id
        AND replace(lower(trim(u.role::text)), '-', '_') IN ('resident', 'user')
    ),
    (
      SELECT count(*)::bigint
      FROM public.resident_security_memberships m
      JOIN public.users ru ON ru.id = m.resident_user_id
      WHERE m.security_company_id IN (SELECT public.my_security_company_ids())
        AND ru.organization_id = a.organization_id
    )
  FROM public.security_partner_coverage_areas() a
  WHERE public.security_partner_can_view()
    AND a.organization_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.security_partner_neighborhood_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_partner_neighborhood_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.security_partner_neighborhood_counts() TO service_role;
