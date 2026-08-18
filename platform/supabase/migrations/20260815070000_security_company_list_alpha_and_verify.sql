-- Resident company dropdown is A–Z by trading name (pending companies stay in that order).
-- Sample/partner flags must not push created companies to the bottom.

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
        ORDER BY lower(o.name)
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
        ORDER BY lower(o.name)
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
