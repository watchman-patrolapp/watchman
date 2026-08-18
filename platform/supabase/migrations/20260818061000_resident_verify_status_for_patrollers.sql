-- Patrollers on Verify residents only read resident_profiles via RLS that joins
-- public.users. If that join is hidden by users RLS, the row looks Pending even
-- when users.verified is true (Profile / admin). Use a security-definer scope
-- check, treat users.verified as verified, and backfill missing profile dates.

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
  )
  OR EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = p_user_id
      AND coalesce(u.verified, false)
  );
$$;

DROP POLICY IF EXISTS resident_profiles_select_org ON public.resident_profiles;
CREATE POLICY resident_profiles_select_org ON public.resident_profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.resident_in_caller_scope(user_id)
  );

INSERT INTO public.resident_profiles (
  user_id,
  home_address,
  verification_date,
  verification_method,
  verification_admin_id
)
SELECT
  u.id,
  nullif(trim(u.address), ''),
  now(),
  CASE
    WHEN lower(trim(coalesce(u.verification_method, ''))) IN ('staff', 'vouch', 'watch_member')
      THEN lower(trim(u.verification_method))
    ELSE 'staff'
  END,
  u.verified_by_user_id
FROM public.users u
WHERE coalesce(u.verified, false)
  AND replace(lower(trim(u.role::text)), '-', '_') IN ('resident', 'user')
ON CONFLICT (user_id) DO UPDATE
SET
  verification_date = COALESCE(public.resident_profiles.verification_date, EXCLUDED.verification_date),
  verification_method = CASE
    WHEN public.resident_profiles.verification_date IS NULL
      THEN COALESCE(NULLIF(public.resident_profiles.verification_method, 'pending'), EXCLUDED.verification_method)
    ELSE public.resident_profiles.verification_method
  END,
  verification_admin_id = COALESCE(public.resident_profiles.verification_admin_id, EXCLUDED.verification_admin_id);
