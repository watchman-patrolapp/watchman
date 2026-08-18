-- In-app membership notices: resident (verified / rejected / transferred)
-- and the previous company (client left).

CREATE TABLE IF NOT EXISTS public.app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  href text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_notifications_user_unread_idx
  ON public.app_notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS app_notifications_user_idx
  ON public.app_notifications (user_id, created_at DESC);

ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_notifications_select_own ON public.app_notifications;
CREATE POLICY app_notifications_select_own ON public.app_notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS app_notifications_update_own ON public.app_notifications;
CREATE POLICY app_notifications_update_own ON public.app_notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, UPDATE ON public.app_notifications TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_app_user(
  p_user_id uuid,
  p_kind text,
  p_title text,
  p_body text DEFAULT NULL,
  p_href text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR nullif(trim(p_title), '') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.app_notifications (user_id, kind, title, body, href)
  VALUES (
    p_user_id,
    coalesce(nullif(trim(p_kind), ''), 'info'),
    trim(p_title),
    nullif(trim(p_body), ''),
    nullif(trim(p_href), '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.notify_app_user(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_app_user(uuid, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.security_company_staff_ids(p_company_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id
  FROM public.users u
  WHERE u.organization_id = p_company_id
  UNION
  SELECT om.user_id
  FROM public.organization_members om
  WHERE om.organization_id = p_company_id
    AND om.status = 'active';
$$;

REVOKE ALL ON FUNCTION public.security_company_staff_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_company_staff_ids(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.app_notifications_from_membership_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  from_name text;
  to_name text;
  resident_name text;
  reason text;
  staff_id uuid;
BEGIN
  SELECT name INTO from_name FROM public.organizations WHERE id = NEW.from_company_id;
  SELECT name INTO to_name FROM public.organizations WHERE id = NEW.to_company_id;
  SELECT full_name INTO resident_name FROM public.users WHERE id = NEW.resident_user_id;
  reason := nullif(trim(NEW.notes), '');

  IF NEW.event_type = 'verified' THEN
    PERFORM public.notify_app_user(
      NEW.resident_user_id,
      'membership_verified',
      coalesce(to_name, from_name, 'Your security company') || ' verified you',
      coalesce(to_name, from_name, 'The company') || ' confirmed you as their client.',
      '/profile'
    );
  ELSIF NEW.event_type = 'rejected' THEN
    PERFORM public.notify_app_user(
      NEW.resident_user_id,
      'membership_rejected',
      coalesce(from_name, 'Security company') || ' did not confirm your claim',
      CASE
        WHEN reason IS NOT NULL THEN 'Reason: ' || reason
        ELSE 'Open Profile to withdraw or transfer to another company.'
      END,
      '/profile'
    );
  ELSIF NEW.event_type = 'transferred' THEN
    PERFORM public.notify_app_user(
      NEW.resident_user_id,
      'membership_transferred',
      'Membership transferred',
      'Moved from ' || coalesce(from_name, 'your previous company') || ' to ' || coalesce(to_name, 'the new company') || '. The new company still needs to verify you.',
      '/profile'
    );
    FOR staff_id IN
      SELECT public.security_company_staff_ids(NEW.from_company_id)
    LOOP
      IF staff_id IS DISTINCT FROM NEW.resident_user_id THEN
        PERFORM public.notify_app_user(
          staff_id,
          'membership_lost',
          coalesce(resident_name, 'A client') || ' transferred away',
          coalesce(resident_name, 'A household') || ' moved to ' || coalesce(to_name, 'another company') || '.',
          '/security'
        );
      END IF;
    END LOOP;
    FOR staff_id IN
      SELECT public.security_company_staff_ids(NEW.to_company_id)
    LOOP
      IF staff_id IS DISTINCT FROM NEW.resident_user_id THEN
        PERFORM public.notify_app_user(
          staff_id,
          'membership_won',
          'New client claim from a transfer',
          coalesce(resident_name, 'A household') || ' transferred from ' || coalesce(from_name, 'another company') || '. Verify them under Client claims.',
          '/security'
        );
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_notifications_from_membership_event ON public.security_membership_events;
CREATE TRIGGER app_notifications_from_membership_event
  AFTER INSERT ON public.security_membership_events
  FOR EACH ROW
  EXECUTE FUNCTION public.app_notifications_from_membership_event();

CREATE OR REPLACE FUNCTION public.list_my_app_notifications(p_limit integer DEFAULT 30)
RETURNS SETOF public.app_notifications
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.app_notifications
  WHERE user_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 30), 1), 80);
$$;

REVOKE ALL ON FUNCTION public.list_my_app_notifications(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_app_notifications(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_app_notifications(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_app_notifications_read(p_ids uuid[] DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  UPDATE public.app_notifications
  SET read_at = now()
  WHERE user_id = auth.uid()
    AND read_at IS NULL
    AND (p_ids IS NULL OR id = ANY (p_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.mark_app_notifications_read(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_app_notifications_read(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_app_notifications_read(uuid[]) TO service_role;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.app_notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
