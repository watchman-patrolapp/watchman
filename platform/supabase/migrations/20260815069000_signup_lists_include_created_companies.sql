-- Resident company dropdowns must include admin-created companies, not only
-- the seeded Gqeberha sample list. Pending partners stay listable; suspended stay hidden.

DROP POLICY IF EXISTS organizations_select_scoped ON public.organizations;
CREATE POLICY organizations_select_scoped ON public.organizations
  FOR SELECT TO authenticated
  USING (
    public.is_platform_staff()
    OR public.is_global_app_staff()
    OR id IN (SELECT public.current_org_ids())
    OR (type = 'security_company' AND status <> 'suspended')
    OR id IN (
      SELECT p.author_organization_id
      FROM public.city_hub_posts p
      WHERE p.status = 'published'
    )
  );

CREATE OR REPLACE FUNCTION public.list_public_signup_options()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'city', (
      SELECT jsonb_build_object('id', c.id, 'name', c.name)
      FROM public.cities c
      WHERE c.id = public.default_city_id()
    ),
    'areas', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object('id', o.id, 'name', o.name)
        ORDER BY o.name
      )
      FROM public.organizations o
      WHERE o.type = 'nw_group'
        AND o.status = 'active'
    ), '[]'::jsonb),
    'security_companies', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'name', o.name,
          'status', o.status,
          'psira_reg', nullif(o.settings_json->>'psira_reg', ''),
          'partner_note', nullif(o.settings_json->>'partner_note', ''),
          'sample_listed', coalesce(o.settings_json->>'sample_listed', '') = 'true'
        )
        ORDER BY
          CASE WHEN coalesce(o.settings_json->>'theescombe_partner', '') = 'true' THEN 0 ELSE 1 END,
          CASE WHEN coalesce(o.settings_json->>'sample_listed', '') = 'true' THEN 1 ELSE 2 END,
          o.name
      )
      FROM public.organizations o
      WHERE o.type = 'security_company'
        AND o.status <> 'suspended'
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.list_public_signup_options() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_public_signup_options() TO anon;
GRANT EXECUTE ON FUNCTION public.list_public_signup_options() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_public_signup_options() TO service_role;
