-- Staff approve (promote to patroller) or reject.

CREATE OR REPLACE FUNCTION public.review_patroller_role_request(
  p_resident_user_id uuid,
  p_approve boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id uuid;
  target_role text;
  resident_name text;
  assigned jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.can_review_patroller_requests() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_resident_user_id IS NULL THEN
    RAISE EXCEPTION 'Resident is required';
  END IF;

  SELECT
    replace(lower(trim(u.role::text)), '-', '_'),
    u.organization_id,
    nullif(trim(u.full_name), '')
  INTO target_role, org_id, resident_name
  FROM public.users u
  WHERE u.id = p_resident_user_id;

  IF target_role IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF NOT public.is_global_app_staff() AND NOT public.is_platform_staff() THEN
    IF org_id IS NULL OR org_id NOT IN (SELECT public.current_org_ids()) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;

  IF NOT coalesce(p_approve, false) THEN
    UPDATE public.resident_profiles
    SET
      patroller_request_status = 'rejected',
      patroller_request_reviewed_at = now(),
      patroller_request_reviewed_by = auth.uid(),
      updated_at = now()
    WHERE user_id = p_resident_user_id;

    INSERT INTO public.app_notifications (user_id, kind, title, body, href)
    VALUES (
      p_resident_user_id,
      'patroller_request',
      'Patroller request declined',
      'Your neighbourhood watch did not approve a patroller role this time. You can ask again from Profile.',
      '/profile'
    );

    RETURN jsonb_build_object('ok', true, 'status', 'rejected');
  END IF;

  IF target_role IS DISTINCT FROM 'resident' AND target_role IS DISTINCT FROM 'user' THEN
    RAISE EXCEPTION 'Only household accounts can be approved here';
  END IF;

  org_id := COALESCE(org_id, public.working_organization_id());
  IF org_id IS NOT NULL THEN
    SELECT public.assign_resident_to_neighborhood(p_resident_user_id, org_id)
      INTO assigned;
  END IF;

  UPDATE public.users
  SET role = 'patroller'
  WHERE id = p_resident_user_id;

  IF org_id IS NOT NULL THEN
    SELECT public.assign_resident_to_neighborhood(p_resident_user_id, org_id)
      INTO assigned;
  END IF;

  UPDATE public.resident_profiles
  SET
    patroller_request_status = 'approved',
    patroller_request_reviewed_at = now(),
    patroller_request_reviewed_by = auth.uid(),
    updated_at = now()
  WHERE user_id = p_resident_user_id;

  INSERT INTO public.app_notifications (user_id, kind, title, body, href)
  VALUES (
    p_resident_user_id,
    'patroller_request',
    'You are a patroller',
    'Your neighbourhood watch approved your request. Open the patrol dashboard to start.',
    '/dashboard'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'approved',
    'organization_id', coalesce(assigned->>'organization_id', org_id::text)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_patroller_role_request(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_patroller_role_request(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_patroller_role_request(uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.count_pending_patroller_requests()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR NOT public.can_review_patroller_requests() THEN 0
    ELSE (
      SELECT count(*)::integer
      FROM public.resident_profiles rp
      JOIN public.users u ON u.id = rp.user_id
      WHERE rp.patroller_request_status = 'pending'
        AND replace(lower(trim(u.role::text)), '-', '_') IN ('resident', 'user')
        AND (
          u.organization_id IN (SELECT public.current_org_ids())
          OR EXISTS (
            SELECT 1
            FROM public.organization_members om
            WHERE om.user_id = u.id
              AND om.status = 'active'
              AND om.organization_id IN (SELECT public.current_org_ids())
          )
          OR (
            (public.is_global_app_staff() OR public.is_platform_staff())
            AND u.organization_id IS NULL
          )
        )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.count_pending_patroller_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_pending_patroller_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_pending_patroller_requests() TO service_role;

NOTIFY pgrst, 'reload schema';
