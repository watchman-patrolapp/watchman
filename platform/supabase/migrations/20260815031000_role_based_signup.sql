-- Role-based self-signup: whitelist app roles from auth metadata, create
-- resident/patroller/security/watch profiles, and never allow privileged
-- roles (admin, technical_support, city_admin) from the public form.
-- No trigger on auth.users (hosted Supabase is not owner of that relation).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS signup_track text;

COMMENT ON COLUMN public.users.signup_track IS
  'Public self-signup track (resident, patroller, security_company, neighborhood_watch). Set once; later admin role changes are not overwritten.';

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

  track := lower(trim(coalesce(meta->>'signup_track', meta->>'role', 'resident')));
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
      WHEN lower(trim(coalesce(meta->>'role', ''))) = 'volunteer' THEN 'volunteer'
      ELSE 'patroller'
    END;
    member_role := 'patroller';
  ELSE
    track := 'resident';
    allowed_role := 'resident';
    member_role := 'resident';
  END IF;

  UPDATE public.users
  SET
    phone = CASE
      WHEN phone IS NULL OR btrim(phone) = '' THEN nullif(trim(coalesce(meta->>'phone', '')), '')
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
      WHEN full_name IS NULL OR btrim(full_name) = '' THEN nullif(trim(coalesce(meta->>'full_name', '')), '')
      ELSE full_name
    END,
    emergency_contact_name = CASE
      WHEN emergency_contact_name IS NULL OR btrim(emergency_contact_name) = '' THEN nullif(trim(coalesce(meta->>'emergency_contact_name', '')), '')
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
    company_name := nullif(trim(coalesce(meta->>'company_name', '')), '');
    IF company_name IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.organizations o WHERE lower(o.name) = lower(company_name)
      ) THEN
        company_name := company_name || ' — pending ' || substr(p_user_id::text, 1, 8);
      END IF;

      INSERT INTO public.organizations (
        name,
        type,
        status,
        subscription_tier,
        settings_json
      )
      VALUES (
        company_name,
        'security_company',
        'pending',
        'beta',
        jsonb_strip_nulls(jsonb_build_object(
          'source', 'security_signup',
          'psira_or_registration', nullif(trim(coalesce(meta->>'company_registration', '')), ''),
          'coverage_area', nullif(trim(coalesce(meta->>'coverage_area', '')), ''),
          'contact_job_title', nullif(trim(coalesce(meta->>'job_title', '')), '')
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

  IF track = 'resident'
     AND lower(trim(coalesce(meta->>'security_membership', ''))) = 'yes' THEN
    company_name := nullif(trim(coalesce(meta->>'security_company_name', '')), '');
    IF company_name IS NOT NULL THEN
      org_id := NULL;
      SELECT o.id INTO org_id
      FROM public.organizations o
      WHERE o.type = 'security_company'
        AND lower(o.name) = lower(company_name)
      LIMIT 1;

      IF org_id IS NULL THEN
        INSERT INTO public.organizations (
          name,
          type,
          status,
          subscription_tier,
          settings_json
        )
        VALUES (
          company_name,
          'security_company',
          'pending',
          'beta',
          jsonb_build_object('source', 'resident_signup_metadata')
        )
        RETURNING id INTO org_id;
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

REVOKE ALL ON FUNCTION public.apply_signup_profile_for_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_signup_profile_for_user(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_my_signup_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_authenticated');
  END IF;
  RETURN public.apply_signup_profile_for_user(auth.uid());
END;
$$;

COMMENT ON FUNCTION public.apply_my_signup_profile() IS
  'Applies whitelisted signup metadata for the current user: role, contact fields, and role-specific org/profile rows.';

GRANT EXECUTE ON FUNCTION public.apply_my_signup_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_my_signup_profile() TO service_role;

CREATE OR REPLACE FUNCTION public.trg_apply_signup_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.apply_signup_profile_for_user(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_apply_signup_profile failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzz_apply_signup_profile ON public.users;
CREATE TRIGGER zzz_apply_signup_profile
  AFTER INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_apply_signup_profile();
