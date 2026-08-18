-- Neighbour directory includes who verified each household (staff name or neighbour vouches).

DROP FUNCTION IF EXISTS public.list_resident_neighbours();

CREATE FUNCTION public.list_resident_neighbours()
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
  is_self boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    (u.id = auth.uid())
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
  ORDER BY (u.id = auth.uid()) DESC, u.full_name NULLS LAST, u.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_resident_neighbours() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_resident_neighbours() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_resident_neighbours() TO service_role;

-- Neighbours in the same area can see who verified a household (names only).
CREATE OR REPLACE FUNCTION public.get_resident_verification_log(p_resident_user_id uuid DEFAULT NULL)
RETURNS TABLE (
  kind text,
  actor_name text,
  actor_role text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  target := coalesce(p_resident_user_id, auth.uid());

  IF target <> auth.uid()
     AND NOT public.is_resident_staff_verifier()
     AND NOT public.can_list_resident_neighbours() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT public.resident_in_caller_scope(target) AND target <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden: resident is outside your neighborhood';
  END IF;

  RETURN QUERY
  SELECT
    'staff'::text,
    coalesce(nullif(trim(su.full_name), ''), 'Staff'),
    su.role::text,
    rp.verification_date
  FROM public.resident_profiles rp
  JOIN public.users su ON su.id = rp.verification_admin_id
  WHERE rp.user_id = target
    AND rp.verification_method = 'staff'
    AND rp.verification_admin_id IS NOT NULL
    AND rp.verification_date IS NOT NULL

  UNION ALL

  SELECT
    'vouch'::text,
    coalesce(nullif(trim(vu.full_name), ''), 'Neighbour'),
    vu.role::text,
    vv.created_at
  FROM public.resident_verification_vouchers vv
  JOIN public.users vu ON vu.id = vv.voucher_user_id
  WHERE vv.resident_user_id = target

  ORDER BY 4 ASC NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_resident_verification_logs()
RETURNS TABLE (
  resident_user_id uuid,
  kind text,
  actor_name text,
  actor_role text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_resident_staff_verifier()
     AND NOT public.can_list_resident_neighbours() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    rp.user_id,
    'staff'::text,
    coalesce(nullif(trim(su.full_name), ''), 'Staff'),
    su.role::text,
    rp.verification_date
  FROM public.resident_profiles rp
  JOIN public.users su ON su.id = rp.verification_admin_id
  WHERE rp.verification_method = 'staff'
    AND rp.verification_admin_id IS NOT NULL
    AND rp.verification_date IS NOT NULL
    AND public.resident_in_caller_scope(rp.user_id)

  UNION ALL

  SELECT
    vv.resident_user_id,
    'vouch'::text,
    coalesce(nullif(trim(vu.full_name), ''), 'Neighbour'),
    vu.role::text,
    vv.created_at
  FROM public.resident_verification_vouchers vv
  JOIN public.users vu ON vu.id = vv.voucher_user_id
  WHERE public.resident_in_caller_scope(vv.resident_user_id)

  ORDER BY 5 ASC NULLS LAST;
END;
$$;
