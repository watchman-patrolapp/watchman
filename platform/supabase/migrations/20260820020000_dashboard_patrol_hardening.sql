-- Dashboard audit hardening:
-- 1) end_patrol accepts auto_closed flag (client 2.5h auto-end)
-- 2) get_active_patroller_avatars scoped to caller's orgs (no global phone leak)

-- ---------------------------------------------------------------------------
-- end_patrol(p_user_id, p_auto_closed)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.end_patrol(uuid);
DROP FUNCTION IF EXISTS public.end_patrol(uuid, boolean);

CREATE FUNCTION public.end_patrol(p_user_id uuid, p_auto_closed boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  patrol public.active_patrols%ROWTYPE;
  end_at timestamptz := now();
  duration_mins integer;
  org_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'you can only end your own patrol';
  END IF;

  SELECT * INTO patrol
  FROM public.active_patrols
  WHERE user_id::text = p_user_id::text
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active patrol';
  END IF;

  duration_mins := GREATEST(
    1,
    floor(extract(epoch FROM (end_at - patrol.start_time)) / 60.0)::integer
  );

  org_id := public.resolve_patrol_organization_id(
    patrol.organization_id,
    patrol.user_id::text,
    patrol.zone::text
  );

  INSERT INTO public.patrol_logs (
    user_id,
    user_name,
    start_time,
    end_time,
    duration_minutes,
    zone,
    organization_id,
    auto_closed,
    admin_ended,
    vehicle_make_model,
    vehicle_reg,
    vehicle_color
  )
  VALUES (
    patrol.user_id,
    patrol.user_name,
    patrol.start_time,
    end_at,
    duration_mins,
    coalesce(nullif(trim(patrol.zone), ''), 'Theescombe'),
    org_id,
    coalesce(p_auto_closed, false),
    false,
    patrol.vehicle_make_model,
    patrol.vehicle_reg,
    coalesce(nullif(trim(patrol.vehicle_color), ''), 'gray')
  );

  DELETE FROM public.active_patrols
  WHERE user_id::text = p_user_id::text;
END;
$$;

REVOKE ALL ON FUNCTION public.end_patrol(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.end_patrol(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_patrol(uuid, boolean) TO service_role;

COMMENT ON FUNCTION public.end_patrol(uuid, boolean) IS
  'End the caller''s active patrol; p_auto_closed marks client/server time-limit ends.';

-- ---------------------------------------------------------------------------
-- get_active_patroller_avatars — org-scoped
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_active_patroller_avatars();

CREATE FUNCTION public.get_active_patroller_avatars()
RETURNS TABLE (user_id uuid, avatar_url text, phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT u.id AS user_id, u.avatar_url, u.phone
  FROM public.active_patrols ap
  INNER JOIN public.users u ON u.id = ap.user_id
  WHERE
    ap.organization_id IN (SELECT public.current_org_ids())
    OR ap.organization_id IS NOT DISTINCT FROM public.working_organization_id()
    OR (
      ap.organization_id IS NULL
      AND public.working_organization_id() IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organizations o
        WHERE o.id = public.working_organization_id()
          AND o.name ILIKE '%theescombe%'
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_active_patroller_avatars() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_patroller_avatars() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_patroller_avatars() TO service_role;

COMMENT ON FUNCTION public.get_active_patroller_avatars() IS
  'Avatar/phone for active patrollers visible to the caller''s org(s); not global.';
