-- Home map pin for every user. My sector uses pin-to-pin distance (closest 10),
-- not typed house numbers. Other households never receive exact coordinates.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS home_lat double precision,
  ADD COLUMN IF NOT EXISTS home_lng double precision,
  ADD COLUMN IF NOT EXISTS home_pin_set_at timestamptz;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_home_pin_lat_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_home_pin_lat_check
  CHECK (home_lat IS NULL OR (home_lat BETWEEN -90 AND 90));

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_home_pin_lng_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_home_pin_lng_check
  CHECK (home_lng IS NULL OR (home_lng BETWEEN -180 AND 180));

CREATE OR REPLACE FUNCTION public.home_distance_m(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_lat1 IS NULL OR p_lng1 IS NULL OR p_lat2 IS NULL OR p_lng2 IS NULL THEN NULL
    ELSE (
      ROUND(
        (
          6371000 * acos(
            least(
              1::double precision,
              greatest(
                -1::double precision,
                cos(radians(p_lat1)) * cos(radians(p_lat2))
                  * cos(radians(p_lng2) - radians(p_lng1))
                  + sin(radians(p_lat1)) * sin(radians(p_lat2))
              )
            )
          )
        ) / 50.0
      ) * 50
    )::integer
  END;
$$;

CREATE OR REPLACE FUNCTION public.set_my_home_pin(
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_clear boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_clear OR p_lat IS NULL OR p_lng IS NULL THEN
    UPDATE public.users
    SET home_lat = NULL, home_lng = NULL, home_pin_set_at = NULL
    WHERE id = auth.uid();
    RETURN;
  END IF;
  IF p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN
    RAISE EXCEPTION 'invalid coordinates';
  END IF;
  UPDATE public.users
  SET
    home_lat = p_lat,
    home_lng = p_lng,
    home_pin_set_at = now()
  WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_home_pin(double precision, double precision, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_home_pin(double precision, double precision, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_home_pin(double precision, double precision, boolean) TO service_role;

DROP FUNCTION IF EXISTS public.list_resident_sector(integer);
CREATE FUNCTION public.list_resident_sector(p_limit integer DEFAULT 10)
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
        ORDER BY public.home_distance_m(caller_lat, caller_lng, n.home_lat, n.home_lng) ASC NULLS LAST
        LIMIT lim
      )
    )
  ORDER BY (u.id = auth.uid()) DESC,
    public.home_distance_m(caller_lat, caller_lng, u.home_lat, u.home_lng) ASC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.list_resident_sector(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_resident_sector(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_resident_sector(integer) TO service_role;
