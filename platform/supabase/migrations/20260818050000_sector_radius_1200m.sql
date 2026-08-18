-- My sector: 10 closest pinned homes, only within 1.2 km of the caller's pin.

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
    (rp.verification_date IS NOT NULL),
    rp.verification_date,
    CASE
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
    AND replace(lower(trim(u.role::text)), '-', '_') IN ('resident', 'user')
    AND u.home_lat IS NOT NULL
    AND u.home_lng IS NOT NULL
    AND (
      u.id = auth.uid()
      OR u.id IN (
        SELECT n.id
        FROM public.users n
        WHERE n.id <> auth.uid()
          AND public.resident_in_caller_scope(n.id)
          AND replace(lower(trim(n.role::text)), '-', '_') IN ('resident', 'user')
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
