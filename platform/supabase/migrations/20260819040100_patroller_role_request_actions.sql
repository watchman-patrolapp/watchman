-- Resident request / withdraw, plus staff approve / reject.

CREATE OR REPLACE FUNCTION public.request_patroller_role()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  caller_role text;
  org_id uuid;
  actor_name text;
  already text;
  staff_id uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT
    replace(lower(trim(u.role::text)), '-', '_'),
    u.organization_id,
    nullif(trim(u.full_name), '')
  INTO caller_role, org_id, actor_name
  FROM public.users u
  WHERE u.id = caller;

  IF caller_role IS DISTINCT FROM 'resident' THEN
    RAISE EXCEPTION 'Only household accounts can request this';
  END IF;

  IF NOT (
    public.is_verified_household(caller)
    OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = caller AND coalesce(u.verified, false))
  ) THEN
    RAISE EXCEPTION 'Verify your household first';
  END IF;

  INSERT INTO public.resident_profiles (user_id, updated_at)
  VALUES (caller, now())
  ON CONFLICT (user_id) DO UPDATE
    SET updated_at = now();

  SELECT patroller_request_status INTO already
  FROM public.resident_profiles
  WHERE user_id = caller;

  IF already = 'pending' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'pending', 'already', true);
  END IF;

  UPDATE public.resident_profiles
  SET
    patroller_request_status = 'pending',
    patroller_request_at = now(),
    patroller_request_reviewed_at = NULL,
    patroller_request_reviewed_by = NULL,
    updated_at = now()
  WHERE user_id = caller;

  org_id := COALESCE(org_id, public.working_organization_id());

  FOR staff_id IN
    SELECT public.patroller_request_staff_ids(org_id)
  LOOP
    IF staff_id IS DISTINCT FROM caller THEN
      INSERT INTO public.app_notifications (user_id, kind, title, body, href)
      VALUES (
        staff_id,
        'patroller_request',
        'Patroller request',
        coalesce(actor_name, 'A resident') || ' asked to become a patroller.',
        '/admin/residents'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'status', 'pending');
END;
$$;

REVOKE ALL ON FUNCTION public.request_patroller_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_patroller_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_patroller_role() TO service_role;

CREATE OR REPLACE FUNCTION public.withdraw_patroller_role_request()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.resident_profiles
  SET
    patroller_request_status = NULL,
    patroller_request_at = NULL,
    patroller_request_reviewed_at = NULL,
    patroller_request_reviewed_by = NULL,
    updated_at = now()
  WHERE user_id = auth.uid()
    AND patroller_request_status = 'pending';

  RETURN jsonb_build_object('ok', true, 'status', NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_patroller_role_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.withdraw_patroller_role_request() TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_patroller_role_request() TO service_role;
