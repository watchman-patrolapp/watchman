-- Part 2/3: role / assign / notice / incident triggers

CREATE OR REPLACE FUNCTION public.trg_log_watch_staff_user_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role text;
  old_role text;
  new_role text;
BEGIN
  old_role := replace(lower(trim(OLD.role::text)), '-', '_');
  new_role := replace(lower(trim(NEW.role::text)), '-', '_');

  SELECT replace(lower(trim(role::text)), '-', '_')
    INTO actor_role
  FROM public.users
  WHERE id = auth.uid();

  IF old_role IS DISTINCT FROM new_role
     AND (public.is_watch_local_staff_role(old_role) OR public.is_watch_local_staff_role(new_role)) THEN
    PERFORM public.write_staff_activity(
      'role_changed',
      jsonb_build_object(
        'subject_user_id', NEW.id,
        'subject_name', nullif(trim(NEW.full_name), ''),
        'from_role', old_role,
        'to_role', new_role,
        'subject_role', new_role
      ),
      auth.uid(),
      COALESCE(NEW.organization_id, OLD.organization_id)
    );
  END IF;

  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     AND public.is_watch_local_staff_role(actor_role) THEN
    PERFORM public.write_staff_activity(
      'resident_assigned',
      jsonb_build_object(
        'subject_user_id', NEW.id,
        'subject_name', nullif(trim(NEW.full_name), ''),
        'from_organization_id', OLD.organization_id,
        'to_organization_id', NEW.organization_id
      ),
      auth.uid(),
      NEW.organization_id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzz_log_watch_staff_user_changes ON public.users;
CREATE TRIGGER zzz_log_watch_staff_user_changes
  AFTER UPDATE OF role, organization_id ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_log_watch_staff_user_changes();

CREATE OR REPLACE FUNCTION public.trg_log_watch_staff_broadcast()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role text;
BEGIN
  SELECT replace(lower(trim(role::text)), '-', '_')
    INTO actor_role
  FROM public.users
  WHERE id = NEW.author_id;

  IF NOT public.is_watch_local_staff_role(actor_role) THEN
    RETURN NEW;
  END IF;

  PERFORM public.write_staff_activity(
    'area_broadcast',
    jsonb_build_object(
      'broadcast_id', NEW.id,
      'headline', left(coalesce(NEW.headline, ''), 160),
      'body_preview', left(coalesce(NEW.body, ''), 200)
    ),
    NEW.author_id,
    NEW.organization_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzz_log_watch_staff_broadcast ON public.area_broadcasts;
CREATE TRIGGER zzz_log_watch_staff_broadcast
  AFTER INSERT ON public.area_broadcasts
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_log_watch_staff_broadcast();

CREATE OR REPLACE FUNCTION public.trg_log_watch_staff_incident()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT replace(lower(trim(role::text)), '-', '_')
    INTO actor_role
  FROM public.users
  WHERE id = auth.uid();

  IF NOT public.is_watch_local_staff_role(actor_role) THEN
    RETURN NEW;
  END IF;

  PERFORM public.write_staff_activity(
    'incident_moderated',
    jsonb_build_object(
      'incident_id', NEW.id,
      'from_status', OLD.status,
      'to_status', NEW.status,
      'title', left(coalesce(NEW.title, NEW.type, ''), 160)
    ),
    auth.uid(),
    NEW.organization_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzz_log_watch_staff_incident ON public.incidents;
CREATE TRIGGER zzz_log_watch_staff_incident
  AFTER UPDATE OF status ON public.incidents
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_log_watch_staff_incident();
