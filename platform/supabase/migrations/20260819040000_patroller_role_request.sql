-- Households can ask to become patrollers. Main admin, technical support,
-- and NW admin approve or reject from Admin → Residents.

ALTER TABLE public.resident_profiles
  ADD COLUMN IF NOT EXISTS patroller_request_status text,
  ADD COLUMN IF NOT EXISTS patroller_request_at timestamptz,
  ADD COLUMN IF NOT EXISTS patroller_request_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS patroller_request_reviewed_by uuid REFERENCES public.users (id) ON DELETE SET NULL;

ALTER TABLE public.resident_profiles
  DROP CONSTRAINT IF EXISTS resident_profiles_patroller_request_status_check;

ALTER TABLE public.resident_profiles
  ADD CONSTRAINT resident_profiles_patroller_request_status_check
  CHECK (
    patroller_request_status IS NULL
    OR patroller_request_status IN ('pending', 'approved', 'rejected')
  );

CREATE INDEX IF NOT EXISTS resident_profiles_patroller_request_pending_idx
  ON public.resident_profiles (patroller_request_at DESC)
  WHERE patroller_request_status = 'pending';

CREATE OR REPLACE FUNCTION public.can_review_patroller_requests()
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
        AND replace(lower(trim(cu.role::text)), '-', '_') = 'nw_admin'
    );
$$;

REVOKE ALL ON FUNCTION public.can_review_patroller_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_review_patroller_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_review_patroller_requests() TO service_role;

CREATE OR REPLACE FUNCTION public.patroller_request_staff_ids(p_organization_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id
  FROM public.users u
  WHERE replace(lower(trim(u.role::text)), '-', '_') IN ('admin', 'technical_support')
  UNION
  SELECT u.id
  FROM public.users u
  WHERE p_organization_id IS NOT NULL
    AND replace(lower(trim(u.role::text)), '-', '_') = 'nw_admin'
    AND (
      u.organization_id = p_organization_id
      OR EXISTS (
        SELECT 1
        FROM public.organization_members om
        WHERE om.user_id = u.id
          AND om.organization_id = p_organization_id
          AND om.status = 'active'
      )
    );
$$;

REVOKE ALL ON FUNCTION public.patroller_request_staff_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.patroller_request_staff_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patroller_request_staff_ids(uuid) TO service_role;
