-- Household mode for local watch members (patroller, volunteer, investigator,
-- committee, nw_admin). Same account; they keep their watch role. Sector map
-- includes their home pin. Neighbour vouch lists stay household-only.

CREATE OR REPLACE FUNCTION public.is_household_directory_role(p_role text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT replace(lower(trim(coalesce(p_role, ''))), '-', '_') IN (
    'resident',
    'user',
    'volunteer',
    'patroller',
    'investigator',
    'committee',
    'nw_admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_household_directory_role(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_household_directory_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_household_directory_role(text) TO service_role;

CREATE OR REPLACE FUNCTION public.can_list_resident_neighbours()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_global_app_staff()
    OR public.is_platform_staff()
    OR public.is_resident_staff_verifier()
    OR public.is_verified_household(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND public.is_household_directory_role(cu.role::text)
    );
$$;

CREATE OR REPLACE FUNCTION public.ensure_my_household_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  role_norm text;
  addr text;
  watch_member boolean := false;
  result public.resident_profiles;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT
    replace(lower(trim(u.role::text)), '-', '_'),
    nullif(trim(u.address), '')
  INTO role_norm, addr
  FROM public.users u
  WHERE u.id = uid;

  IF role_norm IS NULL OR NOT public.is_household_directory_role(role_norm) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_household_role');
  END IF;

  watch_member := role_norm NOT IN ('resident', 'user');

  INSERT INTO public.resident_profiles (
    user_id,
    home_address,
    verification_date,
    verification_method,
    verification_admin_id
  )
  VALUES (
    uid,
    addr,
    CASE WHEN watch_member THEN now() ELSE NULL END,
    CASE WHEN watch_member THEN 'watch_member' ELSE NULL END,
    CASE WHEN watch_member THEN uid ELSE NULL END
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    home_address = COALESCE(public.resident_profiles.home_address, EXCLUDED.home_address),
    verification_date = CASE
      WHEN watch_member THEN COALESCE(public.resident_profiles.verification_date, EXCLUDED.verification_date)
      ELSE public.resident_profiles.verification_date
    END,
    verification_method = CASE
      WHEN watch_member AND coalesce(public.resident_profiles.verification_method, 'pending') IN ('', 'pending')
        THEN 'watch_member'
      ELSE public.resident_profiles.verification_method
    END,
    verification_admin_id = CASE
      WHEN watch_member THEN COALESCE(public.resident_profiles.verification_admin_id, EXCLUDED.verification_admin_id)
      ELSE public.resident_profiles.verification_admin_id
    END
  RETURNING * INTO result;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', result.user_id,
    'home_address', result.home_address,
    'verified', result.verification_date IS NOT NULL,
    'verification_method', result.verification_method
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_my_household_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_my_household_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_my_household_profile() TO service_role;

CREATE OR REPLACE FUNCTION public.list_resident_sector(p_limit integer DEFAULT 10)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  street_label text,
  avatar_url text,
  created_at timestamptz,
  verified boolean,
  verification_date timestamptz,
  verification_method text,
  verified_by_name text,
  verified_by_role text,
  voucher_names text[],
  vouch_count integer,
  vouched_by_me boolean,
  is_self boolean,
  distance_m integer,
  caller_has_pin boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_lat double precision;
  caller_lng double precision;
  lim integer;
  radius_m integer := 1200;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT u.home_lat, u.home_lng
  INTO caller_lat, caller_lng
  FROM public.users u
  WHERE u.id = auth.uid();

  lim := GREATEST(1, LEAST(coalesce(p_limit, 10), 20));

  IF caller_lat IS NULL OR caller_lng IS NULL THEN
    RETURN QUERY
    SELECT
      NULL::uuid,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::timestamptz,
      NULL::boolean,
      NULL::timestamptz,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text[],
      NULL::integer,
      NULL::boolean,
      NULL::boolean,
      NULL::integer,
      false;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.full_name,
    public.resident_street_label(coalesce(nullif(trim(rp.home_address), ''), u.address)),
    u.avatar_url,
    u.created_at,
    (
      rp.verification_date IS NOT NULL
      OR (
        public.is_household_directory_role(u.role::text)
        AND replace(lower(trim(u.role::text)), '-', '_') NOT IN ('resident', 'user')
      )
    ),
    rp.verification_date,
    CASE
      WHEN replace(lower(trim(u.role::text)), '-', '_') NOT IN ('resident', 'user')
        AND public.is_household_directory_role(u.role::text)
        THEN coalesce(nullif(rp.verification_method, 'pending'), 'watch_member')
      WHEN rp.verification_date IS NULL THEN NULL
      WHEN lower(coalesce(rp.verification_method, u.verification_method, '')) = 'vouch' THEN 'vouch'
      WHEN coalesce(rp.verification_admin_id, u.verified_by_user_id) IS NOT NULL THEN 'staff'
      WHEN coalesce(v.vouch_count, 0) >= 2 THEN 'vouch'
      ELSE nullif(rp.verification_method, 'pending')
    END,
    CASE
      WHEN rp.verification_date IS NULL THEN NULL
      WHEN lower(coalesce(rp.verification_method, u.verification_method, '')) = 'vouch' THEN NULL
      ELSE nullif(trim(su.full_name), '')
    END,
    CASE
      WHEN rp.verification_date IS NULL THEN NULL
      WHEN lower(coalesce(rp.verification_method, u.verification_method, '')) = 'vouch' THEN NULL
      ELSE su.role::text
    END,
    coalesce(v.voucher_names, ARRAY[]::text[]),
    coalesce(v.vouch_count, 0)::integer,
    coalesce(v.vouched_by_me, false),
    (u.id = auth.uid()),
    public.home_distance_m(caller_lat, caller_lng, u.home_lat, u.home_lng),
    true
  FROM public.users u
  LEFT JOIN public.resident_profiles rp ON rp.user_id = u.id
  LEFT JOIN public.users su ON su.id = coalesce(rp.verification_admin_id, u.verified_by_user_id)
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS vouch_count,
      coalesce(bool_or(vv.voucher_user_id = auth.uid()), false) AS vouched_by_me,
      coalesce(
        array_agg(
          coalesce(nullif(trim(vu.full_name), ''), 'Neighbour')
          ORDER BY vv.created_at
        ) FILTER (WHERE vv.voucher_user_id IS NOT NULL),
        ARRAY[]::text[]
      ) AS voucher_names
    FROM public.resident_verification_vouchers vv
    LEFT JOIN public.users vu ON vu.id = vv.voucher_user_id
    WHERE vv.resident_user_id = u.id
  ) v ON true
  WHERE public.can_list_resident_neighbours()
    AND public.resident_in_caller_scope(u.id)
    AND public.is_household_directory_role(u.role::text)
    AND u.home_lat IS NOT NULL
    AND u.home_lng IS NOT NULL
    AND (
      u.id = auth.uid()
      OR u.id IN (
        SELECT n.id
        FROM public.users n
        WHERE n.id <> auth.uid()
          AND public.resident_in_caller_scope(n.id)
          AND public.is_household_directory_role(n.role::text)
          AND n.home_lat IS NOT NULL
          AND n.home_lng IS NOT NULL
          AND public.home_distance_m(caller_lat, caller_lng, n.home_lat, n.home_lng) <= radius_m
        ORDER BY public.home_distance_m(caller_lat, caller_lng, n.home_lat, n.home_lng) ASC NULLS LAST
        LIMIT lim
      )
    )
  ORDER BY (u.id = auth.uid()) DESC,
    public.home_distance_m(caller_lat, caller_lng, u.home_lat, u.home_lng) ASC NULLS LAST;
END;
$$;
