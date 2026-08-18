-- Resident verification: staff (admin / NW admin / patroller) can verify in one step.
-- Otherwise two already-verified neighbours must vouch.

ALTER TABLE public.resident_profiles
  ADD COLUMN IF NOT EXISTS verification_method text;

COMMENT ON COLUMN public.resident_profiles.verification_method IS
  'How the household was verified: staff (admin/nw_admin/patroller) or vouch (two verified neighbours).';

CREATE TABLE IF NOT EXISTS public.resident_verification_vouchers (
  resident_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  voucher_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (resident_user_id, voucher_user_id),
  CONSTRAINT resident_verification_vouchers_no_self CHECK (resident_user_id <> voucher_user_id)
);

CREATE INDEX IF NOT EXISTS resident_verification_vouchers_voucher_idx
  ON public.resident_verification_vouchers (voucher_user_id);

ALTER TABLE public.resident_verification_vouchers ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_resident_staff_verifier()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_global_app_staff()
    OR public.is_platform_staff()
    OR EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND replace(lower(trim(cu.role::text)), '-', '_') IN (
          'admin',
          'technical_support',
          'nw_admin',
          'patroller',
          'committee'
        )
    );
$$;

REVOKE ALL ON FUNCTION public.is_resident_staff_verifier() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_resident_staff_verifier() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_resident_staff_verifier() TO service_role;

CREATE OR REPLACE FUNCTION public.is_verified_household(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.resident_profiles rp
    WHERE rp.user_id = p_user_id
      AND rp.verification_date IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.is_verified_household(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_verified_household(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_verified_household(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.resident_in_caller_scope(p_resident_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_global_app_staff()
    OR public.is_platform_staff()
    OR EXISTS (
      SELECT 1
      FROM public.users ru
      WHERE ru.id = p_resident_user_id
        AND (
          ru.organization_id IN (SELECT public.current_org_ids())
          OR EXISTS (
            SELECT 1
            FROM public.organization_members om
            WHERE om.user_id = ru.id
              AND om.status = 'active'
              AND om.organization_id IN (SELECT public.current_org_ids())
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.resident_in_caller_scope(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resident_in_caller_scope(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resident_in_caller_scope(uuid) TO service_role;

DROP POLICY IF EXISTS resident_verification_vouchers_select ON public.resident_verification_vouchers;
CREATE POLICY resident_verification_vouchers_select ON public.resident_verification_vouchers
  FOR SELECT TO authenticated
  USING (
    voucher_user_id = auth.uid()
    OR public.is_resident_staff_verifier()
    OR public.resident_in_caller_scope(resident_user_id)
  );

CREATE OR REPLACE FUNCTION public.mark_resident_verified(
  p_resident_user_id uuid,
  p_method text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.resident_profiles (
    user_id,
    verification_date,
    verification_admin_id,
    verification_method,
    updated_at
  )
  VALUES (
    p_resident_user_id,
    now(),
    CASE WHEN p_method = 'staff' THEN auth.uid() ELSE NULL END,
    p_method,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    verification_date = COALESCE(public.resident_profiles.verification_date, EXCLUDED.verification_date),
    verification_admin_id = COALESCE(
      public.resident_profiles.verification_admin_id,
      EXCLUDED.verification_admin_id
    ),
    verification_method = COALESCE(
      public.resident_profiles.verification_method,
      EXCLUDED.verification_method
    ),
    updated_at = now()
  WHERE public.resident_profiles.verification_date IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_resident_verified(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_resident_verified(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.verify_resident_as_staff(p_resident_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_resident_staff_verifier() THEN
    RAISE EXCEPTION 'forbidden: admin, NW admin, or patroller can verify';
  END IF;

  IF NOT public.resident_in_caller_scope(p_resident_user_id) THEN
    RAISE EXCEPTION 'forbidden: resident is outside your neighborhood';
  END IF;

  SELECT replace(lower(trim(role::text)), '-', '_')
    INTO target_role
  FROM public.users
  WHERE id = p_resident_user_id;

  IF target_role IS NULL THEN
    RAISE EXCEPTION 'resident not found';
  END IF;

  IF target_role NOT IN ('resident', 'user') THEN
    RAISE EXCEPTION 'only household resident accounts can be verified here';
  END IF;

  IF public.is_verified_household(p_resident_user_id) THEN
    RETURN jsonb_build_object('ok', true, 'already_verified', true, 'method', 'existing');
  END IF;

  PERFORM public.mark_resident_verified(p_resident_user_id, 'staff');

  RETURN jsonb_build_object('ok', true, 'already_verified', false, 'method', 'staff');
END;
$$;

REVOKE ALL ON FUNCTION public.verify_resident_as_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_resident_as_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_resident_as_staff(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.vouch_for_resident(p_resident_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_role text;
  vouch_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_resident_user_id = auth.uid() THEN
    RAISE EXCEPTION 'you cannot vouch for yourself';
  END IF;

  IF NOT public.is_verified_household(auth.uid()) THEN
    RAISE EXCEPTION 'only verified residents can vouch';
  END IF;

  IF NOT public.resident_in_caller_scope(p_resident_user_id) THEN
    RAISE EXCEPTION 'forbidden: resident is outside your neighborhood';
  END IF;

  SELECT replace(lower(trim(role::text)), '-', '_')
    INTO target_role
  FROM public.users
  WHERE id = p_resident_user_id;

  IF target_role IS NULL THEN
    RAISE EXCEPTION 'resident not found';
  END IF;

  IF target_role NOT IN ('resident', 'user') THEN
    RAISE EXCEPTION 'only household resident accounts can receive vouches';
  END IF;

  IF public.is_verified_household(p_resident_user_id) THEN
    RETURN jsonb_build_object('ok', true, 'already_verified', true, 'vouch_count', 2, 'method', 'existing');
  END IF;

  INSERT INTO public.resident_verification_vouchers (resident_user_id, voucher_user_id)
  VALUES (p_resident_user_id, auth.uid())
  ON CONFLICT (resident_user_id, voucher_user_id) DO NOTHING;

  SELECT count(*)::integer
    INTO vouch_count
  FROM public.resident_verification_vouchers
  WHERE resident_user_id = p_resident_user_id;

  IF vouch_count >= 2 THEN
    PERFORM public.mark_resident_verified(p_resident_user_id, 'vouch');
    RETURN jsonb_build_object('ok', true, 'already_verified', false, 'vouch_count', vouch_count, 'method', 'vouch');
  END IF;

  RETURN jsonb_build_object('ok', true, 'already_verified', false, 'vouch_count', vouch_count, 'method', null);
END;
$$;

REVOKE ALL ON FUNCTION public.vouch_for_resident(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vouch_for_resident(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vouch_for_resident(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.list_pending_residents_for_vouch()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  address text,
  home_address text,
  created_at timestamptz,
  vouch_count integer,
  vouched_by_me boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    u.full_name,
    u.address,
    rp.home_address,
    u.created_at,
    coalesce(v.vouch_count, 0)::integer,
    coalesce(v.vouched_by_me, false)
  FROM public.users u
  LEFT JOIN public.resident_profiles rp ON rp.user_id = u.id
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS vouch_count,
      bool_or(vv.voucher_user_id = auth.uid()) AS vouched_by_me
    FROM public.resident_verification_vouchers vv
    WHERE vv.resident_user_id = u.id
  ) v ON true
  WHERE public.is_verified_household(auth.uid())
    AND public.resident_in_caller_scope(u.id)
    AND u.id <> auth.uid()
    AND replace(lower(trim(u.role::text)), '-', '_') IN ('resident', 'user')
    AND rp.verification_date IS NULL;
$$;

REVOKE ALL ON FUNCTION public.list_pending_residents_for_vouch() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_pending_residents_for_vouch() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_residents_for_vouch() TO service_role;
