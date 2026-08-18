-- Directory of registered residents in the caller's neighborhood.
-- Street labels omit house numbers. Emails and phones stay off this list.

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
        AND replace(lower(trim(cu.role::text)), '-', '_') IN ('resident', 'user')
    );
$$;

REVOKE ALL ON FUNCTION public.can_list_resident_neighbours() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_list_resident_neighbours() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_list_resident_neighbours() TO service_role;

CREATE OR REPLACE FUNCTION public.list_resident_neighbours()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  street_label text,
  avatar_url text,
  created_at timestamptz,
  verified boolean,
  verification_date timestamptz,
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
    coalesce(v.vouch_count, 0)::integer,
    coalesce(v.vouched_by_me, false),
    (u.id = auth.uid())
  FROM public.users u
  LEFT JOIN public.resident_profiles rp ON rp.user_id = u.id
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS vouch_count,
      bool_or(vv.voucher_user_id = auth.uid()) AS vouched_by_me
    FROM public.resident_verification_vouchers vv
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
