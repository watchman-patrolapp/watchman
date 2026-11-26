-- Phase P6: no more Gqeberha by default
--
-- Until now every new watch, suburb and security company got Gqeberha as its city unless
-- the app said otherwise, and sign-up had no way to say otherwise. After this file:
--
-- * default_city_id()          the caller's city: the city of the organisation they are working
--                              in, else the city they live in (users.home_city_id), else
--                              Gqeberha (GeoNames 964420) for old app builds, sign-up triggers and
--                              scripts that run without a signed-in person. Same name and grants,
--                              so every older caller keeps working.
-- * set_default_city_id()      only fills an EMPTY city_id; a city the app passes is never
--                              replaced. A new organisation with a main suburb takes that
--                              suburb's city before falling back to default_city_id().
-- * apply_signup_profile_for_user(uuid)
--                              same as the sign-up admin gate version (20261123010000) plus one
--                              step: the city picked at sign-up (auth metadata home_city_id) is
--                              saved on the account, and a watch or security company this person
--                              has just asked for is moved to that city.
-- * list_community_contacts()  the staff contacts list with city, province and suburb
--                              (security companies now list their security admin too).
--                              list_community_admin_contacts() stays for older app builds.
--
-- Additive and idempotent; safe to run twice. Needs P1, P2, P3, P5 and P4, and the sign-up
-- admin gate (20261123010000). Ends with NOTICE 'SA places P6: OK'.
--
-- If 20261123030000 (P1) or 20261123010000 (sign-up gate) is run again later, run this file
-- again afterwards: those files re-create default_city_id() and the sign-up wrapper.

-- ---------------------------------------------------------------------------
-- Pre-check: list everything missing at once; change nothing if any is missing
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE
  missing text[] := ARRAY[]::text[];
  r record;
  v_places integer;
  v_body text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('users', 'id'), ('users', 'role'), ('users', 'full_name'), ('users', 'email'), ('users', 'phone'),
      ('users', 'organization_id'), ('users', 'active_organization_id'), ('users', 'home_city_id'),
      ('cities', 'id'), ('cities', 'name'), ('cities', 'province'), ('cities', 'status'), ('cities', 'geonames_id'),
      ('suburbs', 'id'), ('suburbs', 'city_id'), ('suburbs', 'name'), ('suburbs', 'active'),
      ('organizations', 'id'), ('organizations', 'name'), ('organizations', 'type'), ('organizations', 'status'),
      ('organizations', 'city_id'), ('organizations', 'primary_suburb_id'), ('organizations', 'settings_json'),
      ('organization_members', 'organization_id'), ('organization_members', 'user_id'),
      ('organization_members', 'member_role'), ('organization_members', 'status')
    ) AS t(tbl, col)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = r.tbl AND c.column_name = r.col
    ) THEN
      missing := missing || (r.tbl || '.' || r.col);
    END IF;
  END LOOP;

  FOR r IN
    SELECT * FROM (VALUES
      ('public.default_city_id()'),
      ('public.set_default_city_id()'),
      ('public.is_global_app_staff()'),
      ('public.is_platform_staff()'),
      ('public.signup_admin_role_key(text)'),
      ('public.apply_signup_profile_for_user_core(uuid)'),
      ('public.apply_signup_profile_for_user(uuid)'),
      -- P3
      ('public.list_city_watches(uuid)'),
      -- P5
      ('public.places_org_city(uuid)'),
      ('public.merge_suburb_request(uuid,uuid,text)'),
      -- P4
      ('public.places_signup_city(uuid)'),
      ('public.my_home_area()')
    ) AS t(sig)
  LOOP
    IF to_regprocedure(r.sig) IS NULL THEN
      missing := missing || (r.sig || ' function');
    END IF;
  END LOOP;

  -- The sign-up wrapper is re-created below with the gate's body; refuse an unknown version.
  IF to_regprocedure('public.apply_signup_profile_for_user(uuid)') IS NOT NULL THEN
    SELECT p.prosrc INTO v_body FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.apply_signup_profile_for_user(uuid)');
    IF position('Signup admin gate' IN coalesce(v_body, '')) = 0 THEN
      missing := missing || 'the sign-up admin gate version of apply_signup_profile_for_user(uuid) (run 20261123010000 first)'::text;
    END IF;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES ('organizations_set_default_city', 'public.organizations'),
                          ('suburbs_set_default_city', 'public.suburbs')) AS t(tg, tbl)
  LOOP
    IF to_regclass(r.tbl) IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_trigger t WHERE t.tgname = r.tg AND t.tgrelid = to_regclass(r.tbl)
    ) THEN
      missing := missing || (r.tg || ' trigger');
    END IF;
  END LOOP;

  IF to_regclass('public.cities') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'cities' AND column_name = 'geonames_id') THEN
    EXECUTE 'SELECT count(*) FROM public.cities WHERE geonames_id IS NOT NULL' INTO v_places;
    IF v_places < 10000 THEN
      missing := missing || format('the SA places seed (P2): %s places loaded, expected about 12 162', v_places);
    END IF;
  END IF;

  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'SA places P6: not applied, missing %. Nothing was changed.',
      array_to_string(missing, ', ');
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- Gqeberha, only as the last fallback
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.places_fallback_city()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.cities
  WHERE geonames_id = 964420
     OR lower(name) IN ('gqeberha', 'gqeberha (port elizabeth)')
  ORDER BY (geonames_id = 964420) DESC NULLS LAST, created_at
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.places_fallback_city() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.places_fallback_city() TO service_role;

-- The caller's city: working organisation's city, else where they live, else the fallback.
CREATE OR REPLACE FUNCTION public.default_city_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT coalesce(
              public.places_org_city(u.active_organization_id),
              public.places_org_city(u.organization_id),
              (SELECT c.id FROM public.cities c WHERE c.id = u.home_city_id))
       FROM public.users u
      WHERE u.id = auth.uid()),
    public.places_fallback_city()
  )
$$;
COMMENT ON FUNCTION public.default_city_id() IS
  'SA places P6: the caller''s city (working organisation, else home city), else Gqeberha (GeoNames 964420) when nobody is signed in or nothing is known.';
REVOKE ALL ON FUNCTION public.default_city_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.default_city_id() TO anon, authenticated, service_role;

-- Only ever fills an empty city.
CREATE OR REPLACE FUNCTION public.set_default_city_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.city_id IS NULL THEN
    IF TG_TABLE_NAME = 'organizations' THEN
      IF NEW.primary_suburb_id IS NOT NULL THEN
        NEW.city_id := (SELECT s.city_id FROM public.suburbs s WHERE s.id = NEW.primary_suburb_id);
      END IF;
    END IF;
    IF NEW.city_id IS NULL THEN
      NEW.city_id := public.default_city_id();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_default_city_id() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.set_default_city_id() IS
  'SA places P6: fills an empty city_id only (organisation: main suburb''s city first), never replaces one the app sent.';

-- ---------------------------------------------------------------------------
-- Sign-up: the city picked on the form
-- ---------------------------------------------------------------------------
-- Saves the sign-up city on the account (if none yet) and moves an organisation this person
-- has just asked for (pending, requested by them, no suburb yet) to that city. A new security
-- company with whole-city cover gets that city's suburbs instead of the fallback city's.
CREATE OR REPLACE FUNCTION public.places_apply_signup_city(p_user_id uuid, p_org_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_city uuid;
  v_moved_id uuid;
  v_moved_type text;
  v_scope text;
BEGIN
  v_city := public.places_signup_city(p_user_id);
  IF v_city IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_org_id IS NOT NULL THEN
    UPDATE public.organizations o
    SET city_id = v_city
    WHERE o.id = p_org_id
      AND o.status = 'pending'
      AND o.primary_suburb_id IS NULL
      AND o.city_id IS DISTINCT FROM v_city
      AND coalesce(o.settings_json->>'requested_by', '') = p_user_id::text
    RETURNING o.id, o.type, coalesce(o.settings_json->>'latest_signup_coverage_scope', '') AS scope
    INTO v_moved_id, v_moved_type, v_scope;

    -- A new security company covering "the whole city" was given the fallback city's suburbs
    -- at sign-up; give it its own city's suburbs instead.
    IF v_moved_id IS NOT NULL AND v_moved_type = 'security_company' AND v_scope = 'city'
       AND to_regclass('public.security_assignments') IS NOT NULL THEN
      EXECUTE $q$
        DELETE FROM public.security_assignments sa
        USING public.suburbs s
        WHERE sa.security_company_id = $1
          AND s.id = sa.suburb_id
          AND s.city_id IS DISTINCT FROM $2
      $q$ USING v_moved_id, v_city;
      EXECUTE $q$
        INSERT INTO public.security_assignments (security_company_id, suburb_id, assignment_type, active)
        SELECT $1, s.id, 'primary', true
        FROM public.suburbs s
        WHERE s.city_id = $2 AND coalesce(s.active, true)
        ON CONFLICT (security_company_id, suburb_id) DO UPDATE SET active = true
      $q$ USING v_moved_id, v_city;
    END IF;
  END IF;

  -- Saved when empty, or when it was just filled from the request's old (fallback) city.
  UPDATE public.users
  SET home_city_id = v_city
  WHERE id = p_user_id
    AND (home_city_id IS NULL OR (v_moved_id IS NOT NULL AND home_city_id IS DISTINCT FROM v_city));
  RETURN v_city;
END;
$$;
REVOKE ALL ON FUNCTION public.places_apply_signup_city(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.places_apply_signup_city(uuid, uuid) TO service_role;

-- Same as 20261123010000 (sign-up admin gate) plus the P6 city step just before RETURN.
CREATE OR REPLACE FUNCTION public.apply_signup_profile_for_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  v_track text;
  v_role text;
  v_org uuid;
  v_city uuid;
BEGIN
  result := public.apply_signup_profile_for_user_core(p_user_id);

  -- Next-of-kin relationship (20260818063000), only where that feature exists.
  IF to_regprocedure('public.normalize_emergency_contact_relationship(text)') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'users'
         AND column_name = 'emergency_contact_relationship'
     ) THEN
    EXECUTE $q$
      UPDATE public.users u
      SET emergency_contact_relationship = CASE
        WHEN u.emergency_contact_relationship IS NULL
          OR btrim(u.emergency_contact_relationship) = '' THEN x.rel
        ELSE u.emergency_contact_relationship
      END
      FROM (
        SELECT public.normalize_emergency_contact_relationship(
          au.raw_user_meta_data->>'emergency_contact_relationship'
        ) AS rel
        FROM auth.users au
        WHERE au.id = $1
      ) x
      WHERE u.id = $1 AND x.rel IS NOT NULL
    $q$ USING p_user_id;
  END IF;

  -- Signup admin gate
  v_track := coalesce(result->>'signup_track', '');
  IF coalesce(result->>'applied', '') = 'true'
     AND v_track IN ('neighborhood_watch', 'security_company') THEN
    v_role := CASE WHEN v_track = 'security_company' THEN 'security_admin' ELSE 'nw_admin' END;
    BEGIN
      v_org := nullif(result->>'organization_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_org := NULL;
    END;

    IF v_org IS NOT NULL THEN
      UPDATE public.organization_members
      SET status = 'pending'
      WHERE organization_id = v_org
        AND user_id = p_user_id
        AND member_role = v_role
        AND status = 'active';

      -- A brand-new org (nobody else active in it) waits for review.
      UPDATE public.organizations o
      SET settings_json = coalesce(o.settings_json, '{}'::jsonb) || jsonb_build_object(
        'review_state', 'requested',
        'requested_by', p_user_id,
        'requested_at', now(),
        'requested_role', v_role
      )
      WHERE o.id = v_org
        AND o.status = 'pending'
        AND coalesce(o.settings_json->>'review_state', '') = ''
        AND NOT EXISTS (
          SELECT 1 FROM public.organization_members om
          WHERE om.organization_id = o.id
            AND om.status = 'active'
            AND om.user_id <> p_user_id
        );
    END IF;

    UPDATE public.users
    SET
      role = 'resident',
      organization_id = CASE WHEN organization_id = v_org THEN NULL ELSE organization_id END,
      active_organization_id = CASE WHEN active_organization_id = v_org THEN NULL ELSE active_organization_id END
    WHERE id = p_user_id
      AND public.signup_admin_role_key(role::text) = v_role;

    result := result || jsonb_build_object(
      'role', 'resident',
      'admin_request', CASE WHEN v_org IS NULL THEN 'none' ELSE 'pending' END,
      'requested_role', v_role
    );
  END IF;

  -- SA places P6: the city picked at sign-up (saved on the account; a brand-new request moves there).
  v_city := public.places_apply_signup_city(p_user_id, v_org);
  IF v_city IS NOT NULL THEN
    result := result || jsonb_build_object('home_city_id', v_city);
  END IF;

  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_signup_profile_for_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_signup_profile_for_user(uuid) TO service_role;
COMMENT ON FUNCTION public.apply_signup_profile_for_user(uuid) IS
  'Applies sign-up details. Watch and security-company sign-ups become admin requests (resident until approved). SA places P6: the city picked at sign-up is saved and used for the request.';

-- ---------------------------------------------------------------------------
-- Staff contacts list with city and suburb
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_community_contacts()
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  organization_type text,
  status text,
  member_count bigint,
  admin_name text,
  admin_email text,
  admin_phone text,
  admin_role text,
  city_id uuid,
  city text,
  province text,
  suburb_id uuid,
  suburb text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    o.id,
    o.name,
    o.type,
    o.status,
    (
      SELECT count(*)
      FROM public.organization_members om
      WHERE om.organization_id = o.id
        AND om.status = 'active'
    ),
    u.full_name,
    u.email::text,
    u.phone,
    u.role::text,
    c.id,
    c.name,
    c.province,
    s.id,
    s.name
  FROM public.organizations o
  LEFT JOIN public.suburbs s ON s.id = o.primary_suburb_id
  LEFT JOIN public.cities c ON c.id = coalesce(o.city_id, s.city_id)
  LEFT JOIN LATERAL (
    SELECT cu.full_name, cu.email, cu.phone, cu.role
    FROM public.organization_members om
    JOIN public.users cu ON cu.id = om.user_id
    WHERE om.organization_id = o.id
      AND om.status = 'active'
      AND lower(trim(om.member_role)) IN ('nw_admin', 'admin', 'security_admin', 'committee')
    ORDER BY
      CASE lower(trim(om.member_role))
        WHEN 'nw_admin' THEN 0
        WHEN 'security_admin' THEN 0
        WHEN 'admin' THEN 1
        ELSE 3
      END,
      cu.full_name
    LIMIT 1
  ) u ON true
  WHERE o.type IN ('nw_group', 'security_company')
    AND (public.is_global_app_staff() OR public.is_platform_staff())
  ORDER BY o.type, lower(c.name) NULLS LAST, lower(o.name);
$$;
REVOKE ALL ON FUNCTION public.list_community_contacts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_community_contacts() TO authenticated, service_role;
COMMENT ON FUNCTION public.list_community_contacts() IS
  'SA places P6: admin contact per watch and security company, with city, province and suburb. Platform and global staff only; everyone else gets no rows.';

-- ---------------------------------------------------------------------------
-- Final check
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  problems text[] := ARRAY[]::text[];
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.places_fallback_city()', true),
      ('public.default_city_id()', true),
      ('public.set_default_city_id()', true),
      ('public.places_apply_signup_city(uuid,uuid)', true),
      ('public.apply_signup_profile_for_user(uuid)', true),
      ('public.list_community_contacts()', true)
    ) AS t(sig, definer)
  LOOP
    IF to_regprocedure(r.sig) IS NULL THEN
      problems := problems || (r.sig || ' is missing');
    ELSIF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(r.sig)) THEN
      problems := problems || (r.sig || ' is not SECURITY DEFINER');
    END IF;
  END LOOP;

  IF position('places_apply_signup_city' IN
       (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public.apply_signup_profile_for_user(uuid)'))) = 0 THEN
    problems := problems || 'the sign-up wrapper does not save the sign-up city'::text;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('public.places_fallback_city()', 'anon'), ('public.places_fallback_city()', 'authenticated'),
      ('public.places_apply_signup_city(uuid,uuid)', 'anon'), ('public.places_apply_signup_city(uuid,uuid)', 'authenticated'),
      ('public.apply_signup_profile_for_user(uuid)', 'anon'), ('public.apply_signup_profile_for_user(uuid)', 'authenticated'),
      ('public.list_community_contacts()', 'anon')
    ) AS t(sig, who)
  LOOP
    IF has_function_privilege(r.who, r.sig, 'EXECUTE') THEN
      problems := problems || (r.who || ' can run ' || r.sig);
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', 'public.list_community_contacts()', 'EXECUTE') THEN
    problems := problems || 'signed-in staff cannot run list_community_contacts()'::text;
  END IF;
  IF NOT has_function_privilege('anon', 'public.default_city_id()', 'EXECUTE') THEN
    problems := problems || 'old app builds cannot run default_city_id()'::text;
  END IF;

  -- Without a signed-in person the fallback is still Gqeberha (old clients, sign-up trigger).
  IF current_setting('request.jwt.claim.sub', true) IS NULL OR current_setting('request.jwt.claim.sub', true) = '' THEN
    IF public.default_city_id() IS DISTINCT FROM public.places_fallback_city() THEN
      problems := problems || 'default_city_id() has no fallback city'::text;
    END IF;
  END IF;
  IF public.places_fallback_city() IS NULL THEN
    problems := problems || 'Gqeberha (GeoNames 964420) is missing from cities'::text;
  END IF;

  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION 'SA places P6: check failed: %', array_to_string(problems, '; ');
  END IF;
  RAISE NOTICE 'SA places P6: OK';
END
$verify$;
