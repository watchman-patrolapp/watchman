-- Security-company signup: listed company OR a typed name (creates a pending org).

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
  company_name text;
  matched_org_name text;
  neighborhood_note text;
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

  company_name := nullif(trim(coalesce(meta->>'company_name', '')), '');

  IF coverage_org_id IS NOT NULL THEN
    SELECT o.id, o.name
      INTO coverage_org_id, matched_org_name
    FROM public.organizations o
    WHERE o.id = coverage_org_id
      AND o.type = 'nw_group'
      AND o.status = 'active';
    IF matched_org_name IS NOT NULL THEN
      neighborhood_note := matched_org_name;
    END IF;
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
        'coverage_area', coalesce(
          neighborhood_note,
          nullif(trim(coalesce(meta->>'coverage_area', '')), '')
        ),
        'coverage_organization_id', coverage_org_id,
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
    'latest_signup_coverage_area', coalesce(
      neighborhood_note,
      nullif(trim(coalesce(meta->>'coverage_area', '')), '')
    ),
    'latest_signup_coverage_organization_id', coverage_org_id,
    'latest_signup_contact_job_title', nullif(trim(coalesce(meta->>'job_title', '')), '')
  ))
  WHERE id = org_id;

  IF coverage_org_id IS NOT NULL THEN
    INSERT INTO public.organization_suburbs (
      organization_id,
      suburb_id,
      assignment_type
    )
    SELECT org_id, o.primary_suburb_id, 'secondary'
    FROM public.organizations o
    WHERE o.id = coverage_org_id
      AND o.primary_suburb_id IS NOT NULL
    ON CONFLICT (organization_id, suburb_id) DO NOTHING;
  END IF;

  RETURN org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_security_company_signup(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_security_company_signup(uuid, jsonb, text) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_signup_profile_for_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta jsonb := '{}'::jsonb;
  track text;
  allowed_role text;
  current_track text;
  org_id uuid;
  company_name text;
  watch_name text;
  member_role text;
  neighborhood_note text;
  first_name text;
  last_name text;
  full_name_value text;
  emergency_first text;
  emergency_last text;
  emergency_name text;
  neighborhood_org_id uuid;
  security_company_id uuid;
  suburb_id uuid;
  matched_org_name text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'no_user');
  END IF;

  SELECT coalesce(raw_user_meta_data, '{}'::jsonb)
    INTO meta
  FROM auth.users
  WHERE id = p_user_id;

  IF meta IS NULL THEN
    meta := '{}'::jsonb;
  END IF;

  SELECT signup_track INTO current_track
  FROM public.users
  WHERE id = p_user_id;

  track := lower(trim(coalesce(meta->>'signup_track', meta->>'app_role', meta->>'role', 'resident')));
  IF track IN ('security_admin', 'security', 'security_company') THEN
    track := 'security_company';
    allowed_role := 'security_admin';
    member_role := 'security_admin';
  ELSIF track IN ('neighborhood_watch', 'nw_admin', 'nw', 'watch') THEN
    track := 'neighborhood_watch';
    allowed_role := 'nw_admin';
    member_role := 'nw_admin';
  ELSIF track IN ('patroller', 'patrol', 'volunteer') THEN
    track := 'patroller';
    allowed_role := CASE
      WHEN lower(trim(coalesce(meta->>'app_role', meta->>'role', ''))) = 'volunteer' THEN 'volunteer'
      ELSE 'patroller'
    END;
    member_role := 'patroller';
  ELSE
    track := 'resident';
    allowed_role := 'resident';
    member_role := 'resident';
  END IF;

  first_name := nullif(trim(coalesce(meta->>'first_name', '')), '');
  last_name := nullif(trim(coalesce(meta->>'last_name', '')), '');
  full_name_value := nullif(trim(coalesce(meta->>'full_name', '')), '');
  IF full_name_value IS NULL THEN
    full_name_value := nullif(trim(concat_ws(' ', first_name, last_name)), '');
  END IF;

  emergency_first := nullif(trim(coalesce(meta->>'emergency_contact_first_name', '')), '');
  emergency_last := nullif(trim(coalesce(meta->>'emergency_contact_last_name', '')), '');
  emergency_name := nullif(trim(coalesce(meta->>'emergency_contact_name', '')), '');
  IF emergency_name IS NULL THEN
    emergency_name := nullif(trim(concat_ws(' ', emergency_first, emergency_last)), '');
  END IF;

  UPDATE public.users
  SET
    phone = CASE
      WHEN phone IS NULL OR btrim(phone) = '' THEN nullif(trim(coalesce(
        meta->>'contact_phone',
        meta->>'phone',
        ''
      )), '')
      ELSE phone
    END,
    address = CASE
      WHEN address IS NULL OR btrim(address) = '' THEN nullif(trim(coalesce(
        meta->>'address',
        meta->>'company_address',
        ''
      )), '')
      ELSE address
    END,
    full_name = CASE
      WHEN full_name IS NULL OR btrim(full_name) = '' THEN full_name_value
      ELSE full_name
    END,
    emergency_contact_name = CASE
      WHEN emergency_contact_name IS NULL OR btrim(emergency_contact_name) = '' THEN emergency_name
      ELSE emergency_contact_name
    END,
    emergency_contact_phone = CASE
      WHEN emergency_contact_phone IS NULL OR btrim(emergency_contact_phone) = '' THEN nullif(trim(coalesce(meta->>'emergency_contact_phone', '')), '')
      ELSE emergency_contact_phone
    END
  WHERE id = p_user_id;

  IF current_track IS NOT NULL AND btrim(current_track) <> '' THEN
    RETURN jsonb_build_object(
      'applied', false,
      'reason', 'already_applied',
      'signup_track', current_track
    );
  END IF;

  UPDATE public.users
  SET
    role = allowed_role,
    signup_track = track
  WHERE id = p_user_id;

  neighborhood_note := nullif(trim(coalesce(meta->>'neighborhood_name', meta->>'watch_area', '')), '');

  BEGIN
    neighborhood_org_id := nullif(trim(coalesce(meta->>'neighborhood_organization_id', '')), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    neighborhood_org_id := NULL;
  END;

  IF neighborhood_org_id IS NOT NULL THEN
    SELECT o.id, o.primary_suburb_id, o.name
      INTO neighborhood_org_id, suburb_id, matched_org_name
    FROM public.organizations o
    WHERE o.id = neighborhood_org_id
      AND o.type = 'nw_group'
      AND o.status = 'active';
    IF matched_org_name IS NOT NULL THEN
      neighborhood_note := matched_org_name;
    END IF;
  END IF;

  IF track = 'resident' THEN
    INSERT INTO public.resident_profiles (user_id, home_address, notes)
    VALUES (
      p_user_id,
      nullif(trim(coalesce(meta->>'address', '')), ''),
      CASE
        WHEN neighborhood_note IS NULL THEN NULL
        ELSE 'Requested neighborhood: ' || neighborhood_note
      END
    )
    ON CONFLICT (user_id) DO UPDATE
      SET
        home_address = COALESCE(EXCLUDED.home_address, public.resident_profiles.home_address),
        notes = COALESCE(EXCLUDED.notes, public.resident_profiles.notes),
        updated_at = now();
  END IF;

  IF track IN ('resident', 'patroller') AND neighborhood_org_id IS NOT NULL THEN
    INSERT INTO public.organization_members (
      organization_id,
      user_id,
      member_role,
      status
    )
    VALUES (neighborhood_org_id, p_user_id, member_role, 'active')
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    UPDATE public.users
    SET
      organization_id = COALESCE(organization_id, neighborhood_org_id),
      active_organization_id = COALESCE(active_organization_id, neighborhood_org_id),
      home_suburb_id = COALESCE(home_suburb_id, suburb_id)
    WHERE id = p_user_id;

    org_id := COALESCE(org_id, neighborhood_org_id);
  END IF;

  IF track = 'patroller' THEN
    INSERT INTO public.patroller_profiles (
      user_id,
      vehicle_registration,
      vehicle_description,
      joined_date
    )
    VALUES (
      p_user_id,
      nullif(trim(coalesce(meta->>'registration_number', '')), ''),
      nullif(trim(coalesce(meta->>'car_type', meta->>'vehicle_type', '')), ''),
      now()
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  IF track = 'security_company' THEN
    org_id := public.apply_security_company_signup(p_user_id, meta, member_role);
  END IF;

  IF track = 'neighborhood_watch' THEN
    watch_name := nullif(trim(coalesce(meta->>'watch_name', '')), '');
    IF watch_name IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.organizations o WHERE lower(o.name) = lower(watch_name)
      ) THEN
        watch_name := watch_name || ' — pending ' || substr(p_user_id::text, 1, 8);
      END IF;

      INSERT INTO public.organizations (
        name,
        type,
        status,
        subscription_tier,
        settings_json
      )
      VALUES (
        watch_name,
        'nw_group',
        'pending',
        'beta',
        jsonb_strip_nulls(jsonb_build_object(
          'source', 'neighborhood_watch_signup',
          'watch_area', nullif(trim(coalesce(meta->>'watch_area', '')), '')
        ))
      )
      RETURNING id INTO org_id;

      IF org_id IS NOT NULL THEN
        INSERT INTO public.organization_members (
          organization_id,
          user_id,
          member_role,
          status
        )
        VALUES (org_id, p_user_id, member_role, 'active')
        ON CONFLICT (organization_id, user_id) DO NOTHING;

        UPDATE public.users
        SET
          organization_id = COALESCE(organization_id, org_id),
          active_organization_id = COALESCE(active_organization_id, org_id)
        WHERE id = p_user_id;
      END IF;
    END IF;
  END IF;

  BEGIN
    security_company_id := nullif(trim(coalesce(meta->>'security_company_id', '')), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    security_company_id := NULL;
  END;

  IF track = 'resident'
     AND (
       security_company_id IS NOT NULL
       OR lower(trim(coalesce(meta->>'security_membership', ''))) = 'yes'
     ) THEN
    org_id := NULL;
    IF security_company_id IS NOT NULL THEN
      SELECT o.id INTO org_id
      FROM public.organizations o
      WHERE o.id = security_company_id
        AND o.type = 'security_company'
        AND o.status <> 'suspended';
    ELSE
      company_name := nullif(trim(coalesce(meta->>'security_company_name', '')), '');
      IF company_name IS NOT NULL THEN
        SELECT o.id INTO org_id
        FROM public.organizations o
        WHERE o.type = 'security_company'
          AND o.status <> 'suspended'
          AND lower(o.name) = lower(company_name)
        LIMIT 1;
      END IF;
    END IF;

    IF org_id IS NOT NULL THEN
      INSERT INTO public.resident_security_memberships (
        resident_user_id,
        security_company_id,
        membership_status,
        member_reference
      )
      VALUES (
        p_user_id,
        org_id,
        'self_reported',
        nullif(trim(coalesce(meta->>'security_membership_reference', '')), '')
      )
      ON CONFLICT (resident_user_id, security_company_id) DO NOTHING;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'applied', true,
    'signup_track', track,
    'role', allowed_role,
    'organization_id', org_id
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'apply_signup_profile_for_user failed: %', SQLERRM;
  RETURN jsonb_build_object('applied', false, 'reason', SQLERRM);
END;
$$;
