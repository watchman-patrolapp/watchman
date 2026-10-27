-- Make end_patrol idempotent: if the active row is already gone
-- (double check-out, auto-end race, admin force-end), succeed as a no-op
-- instead of raising P0001 'no active patrol'.

CREATE OR REPLACE FUNCTION public.end_patrol(p_user_id uuid, p_auto_closed boolean DEFAULT false)
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

  -- Already ended (or never started): treat as success.
  IF NOT FOUND THEN
    RETURN;
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

COMMENT ON FUNCTION public.end_patrol(uuid, boolean) IS
  'End the caller''s active patrol; no-op if already ended. p_auto_closed marks client/server time-limit ends.';
