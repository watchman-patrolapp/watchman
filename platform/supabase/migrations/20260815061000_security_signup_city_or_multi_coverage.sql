-- Security-company signup coverage: whole city, or one or more neighborhoods.

CREATE OR REPLACE FUNCTION public.apply_security_company_signup(
  p_user_id uuid,
  p_meta jsonb,
  p_member_role text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta jsonb := coalesce(p_meta, '{}'::jsonb);
  org_id uuid;
  company_org_id uuid;
  coverage_org_id uuid;
  coverage_scope text;
  company_name text;
  matched_org_name text;
  neighborhood_note text;
  coverage_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  BEGIN
    company_org_id := nullif(trim(coalesce(meta->>'company_organization_id', '')), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    company_org_id := NULL;
  END;

  BEGIN
    coverage_org_id := nullif(trim(coalesce(meta->>'coverage_organization_id', '')), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    coverage_org_id := NULL;
  END;

  coverage_scope := lower(trim(coalesce(meta->>'coverage_scope', '')));
  company_name := nullif(trim(coalesce(meta->>'company_name', '')), '');

  IF jsonb_typeof(meta->'coverage_organization_ids') = 'array' THEN
    SELECT coalesce(array_agg(value::uuid), ARRAY[]::uuid[])
      INTO coverage_ids
    FROM jsonb_array_elements_text(meta->'coverage_organization_ids') AS t(value)
    WHERE value ~* '^[0-9a-f-]{36}$';
  END IF;

  IF coverage_org_id IS NOT NULL AND NOT (coverage_org_id = ANY (coverage_ids)) THEN
    coverage_ids := coverage_ids || coverage_org_id;
  END IF;

  IF coverage_scope <> 'city' AND cardinality(coverage_ids) > 0 THEN
    SELECT string_agg(o.name, ', ' ORDER BY o.name)
      INTO neighborhood_note
    FROM public.organizations o
    WHERE o.id = ANY (coverage_ids)
      AND o.type = 'nw_group'
      AND o.status = 'active';
  ELSIF coverage_scope = 'city' THEN
    neighborhood_note := coalesce(
      nullif(trim(coalesce(meta->>'coverage_area', '')), ''),
      (SELECT c.name FROM public.cities c WHERE c.id = public.default_city_id() LIMIT 1),
      'Gqeberha (Port Elizabeth)'
    );
  END IF;

  IF company_org_id IS NOT NULL THEN
    SELECT o.id INTO org_id
    FROM public.organizations o
    WHERE o.id = company_org_id
      AND o.type = 'security_company'
      AND o.status <> 'suspended';
  END IF;

  IF org_id IS NULL AND company_name IS NOT NULL THEN
    SELECT o.id INTO org_id
    FROM public.organizations o
    WHERE o.type = 'security_company'
      AND o.status <> 'suspended'
      AND lower(trim(o.name)) = lower(company_name)
    LIMIT 1;
  END IF;

  IF org_id IS NULL AND company_name IS NOT NULL THEN
    INSERT INTO public.organizations (
      name,
      type,
      status,
      subscription_tier,
      annual_fee_status,
      city_id,
      settings_json
    )
    VALUES (
      company_name,
      'security_company',
      'pending',
      'beta',
      'pending',
      public.default_city_id(),
      jsonb_strip_nulls(jsonb_build_object(
        'source', 'security_signup',
        'psira_or_registration', nullif(trim(coalesce(meta->>'company_registration', '')), ''),
        'coverage_scope', nullif(coverage_scope, ''),
        'coverage_area', coalesce(
          neighborhood_note,
          nullif(trim(coalesce(meta->>'coverage_area', '')), '')
        ),
        'coverage_organization_ids', to_jsonb(coverage_ids),
        'contact_job_title', nullif(trim(coalesce(meta->>'job_title', '')), '')
      ))
    )
    RETURNING id INTO org_id;
  END IF;

  IF org_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.organization_members (
    organization_id,
    user_id,
    member_role,
    status
  )
  VALUES (org_id, p_user_id, p_member_role, 'active')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  UPDATE public.users
  SET
    organization_id = COALESCE(organization_id, org_id),
    active_organization_id = COALESCE(active_organization_id, org_id)
  WHERE id = p_user_id;

  UPDATE public.organizations
  SET settings_json = settings_json || jsonb_strip_nulls(jsonb_build_object(
    'latest_signup_psira_or_registration', nullif(trim(coalesce(meta->>'company_registration', '')), ''),
    'latest_signup_coverage_scope', nullif(coverage_scope, ''),
    'latest_signup_coverage_area', coalesce(
      neighborhood_note,
      nullif(trim(coalesce(meta->>'coverage_area', '')), '')
    ),
    'latest_signup_coverage_organization_ids', to_jsonb(coverage_ids),
    'latest_signup_contact_job_title', nullif(trim(coalesce(meta->>'job_title', '')), '')
  ))
  WHERE id = org_id;

  IF coverage_scope = 'city' THEN
    INSERT INTO public.security_assignments (
      security_company_id,
      suburb_id,
      assignment_type,
      active
    )
    SELECT org_id, s.id, 'primary', true
    FROM public.suburbs s
    WHERE s.active = true
      AND (s.city_id = public.default_city_id() OR public.default_city_id() IS NULL)
    ON CONFLICT (security_company_id, suburb_id) DO UPDATE
    SET active = true,
        assignment_type = EXCLUDED.assignment_type;
  ELSE
    INSERT INTO public.security_assignments (
      security_company_id,
      suburb_id,
      assignment_type,
      active
    )
    SELECT org_id, o.primary_suburb_id, 'primary', true
    FROM public.organizations o
    WHERE o.id = ANY (coverage_ids)
      AND o.type = 'nw_group'
      AND o.status = 'active'
      AND o.primary_suburb_id IS NOT NULL
    ON CONFLICT (security_company_id, suburb_id) DO UPDATE
    SET active = true,
        assignment_type = EXCLUDED.assignment_type;
  END IF;

  RETURN org_id;
END;
$$;
