-- Part 1/3: helpers + household verify log
-- Run this whole file, then 20260819020100, then 20260819020200.

CREATE OR REPLACE FUNCTION public.is_watch_local_staff_role(p_role text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT replace(lower(trim(coalesce(p_role, ''))), '-', '_') IN ('nw_admin', 'committee');
$$;

REVOKE ALL ON FUNCTION public.is_watch_local_staff_role(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_watch_local_staff_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_watch_local_staff_role(text) TO service_role;

CREATE OR REPLACE FUNCTION public.write_staff_activity(
  p_action text,
  p_details jsonb DEFAULT '{}'::jsonb,
  p_actor_id uuid DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  org_id uuid;
  actor_role text;
  actor_name text;
  log_id uuid;
BEGIN
  actor := COALESCE(auth.uid(), p_actor_id);
  IF actor IS NULL OR nullif(trim(p_action), '') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    replace(lower(trim(u.role::text)), '-', '_'),
    nullif(trim(u.full_name), ''),
    u.organization_id
  INTO actor_role, actor_name, org_id
  FROM public.users u
  WHERE u.id = actor;

  org_id := COALESCE(p_organization_id, org_id, public.working_organization_id());

  INSERT INTO public.activity_logs (
    organization_id,
    user_id,
    action,
    details_json
  )
  VALUES (
    org_id,
    actor,
    left(trim(p_action), 80),
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object(
      'actor_role', actor_role,
      'actor_name', actor_name
    )
  )
  RETURNING id INTO log_id;

  RETURN log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.write_staff_activity(text, jsonb, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.write_staff_activity(text, jsonb, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.write_staff_activity(text, jsonb, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_log_watch_staff_profile_verify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role text;
  resident_name text;
BEGIN
  IF NEW.verification_date IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.verification_date IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT replace(lower(trim(role::text)), '-', '_')
    INTO actor_role
  FROM public.users
  WHERE id = auth.uid();

  IF NOT public.is_watch_local_staff_role(actor_role) THEN
    RETURN NEW;
  END IF;

  SELECT nullif(trim(full_name), '') INTO resident_name
  FROM public.users
  WHERE id = NEW.user_id;

  PERFORM public.write_staff_activity(
    'resident_verified',
    jsonb_build_object(
      'resident_user_id', NEW.user_id,
      'resident_name', resident_name,
      'method', NEW.verification_method
    ),
    auth.uid(),
    NULL
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzz_log_watch_staff_profile_verify ON public.resident_profiles;
CREATE TRIGGER zzz_log_watch_staff_profile_verify
  AFTER INSERT OR UPDATE OF verification_date ON public.resident_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_log_watch_staff_profile_verify();
