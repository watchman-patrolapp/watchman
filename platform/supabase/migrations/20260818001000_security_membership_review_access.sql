-- Admin membership queue: main admin/tech support can review, and PostgREST
-- can embed branding from memberships even without a direct foreign key.

DROP POLICY IF EXISTS resident_security_memberships_select_scoped ON public.resident_security_memberships;
CREATE POLICY resident_security_memberships_select_scoped ON public.resident_security_memberships
  FOR SELECT TO authenticated
  USING (
    resident_user_id = auth.uid()
    OR public.is_platform_staff()
    OR public.is_global_app_staff()
  );

DROP POLICY IF EXISTS resident_security_memberships_write_scoped ON public.resident_security_memberships;
CREATE POLICY resident_security_memberships_write_scoped ON public.resident_security_memberships
  FOR ALL TO authenticated
  USING (
    resident_user_id = auth.uid()
    OR public.is_platform_staff()
    OR public.is_global_app_staff()
  )
  WITH CHECK (
    resident_user_id = auth.uid()
    OR public.is_platform_staff()
    OR public.is_global_app_staff()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.resident_security_memberships TO authenticated;
GRANT SELECT ON public.security_company_branding TO authenticated;

CREATE OR REPLACE FUNCTION public.security_company_branding(public.resident_security_memberships)
RETURNS SETOF public.security_company_branding
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT b.*
  FROM public.security_company_branding b
  WHERE b.security_company_id = $1.security_company_id
$$;

REVOKE ALL ON FUNCTION public.security_company_branding(public.resident_security_memberships) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_company_branding(public.resident_security_memberships) TO authenticated;
GRANT EXECUTE ON FUNCTION public.security_company_branding(public.resident_security_memberships) TO service_role;
