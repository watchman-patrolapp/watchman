-- G6 - Notification preferences (blueprint section 4.6, D24).
--
-- Purely additive: new table + new functions; notify_app_user is re-created
-- from its latest body (20260818020000_app_notifications_membership.sql) with
-- one early-return added. No existing rows are touched.
--
-- Defaults: everything on. A missing prefs row = notify.
-- Mandatory kinds (never muted, server ignores prefs) are listed in
-- is_mandatory_notification_kind; keep in sync with
-- platform/web/src/utils/notificationKinds.js (MANDATORY_NOTIFICATION_KINDS).
-- Quiet hours (SAST) suppress push only; in-app still lands.

-- ---------------------------------------------------------------------------
-- 1) Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_notification_prefs (
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  push_enabled boolean NOT NULL DEFAULT true,
  in_app_enabled boolean NOT NULL DEFAULT true,
  quiet_hours_start time,
  quiet_hours_end time,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind),
  CONSTRAINT user_notification_prefs_kind_chk CHECK (kind ~ '^[a-z_]{2,40}$')
);

ALTER TABLE public.user_notification_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS unp_own ON public.user_notification_prefs;
CREATE POLICY unp_own ON public.user_notification_prefs
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.user_notification_prefs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_notification_prefs TO authenticated;
GRANT ALL ON public.user_notification_prefs TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Kind helpers
-- ---------------------------------------------------------------------------
-- Detailed in-app kinds roll up to one preference row (membership_* -> membership).
CREATE OR REPLACE FUNCTION public.notification_pref_kind(p_kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN k LIKE 'membership\_%' THEN 'membership'
    ELSE k
  END
  FROM (SELECT coalesce(nullif(lower(trim(p_kind)), ''), 'info') AS k) s;
$$;

REVOKE ALL ON FUNCTION public.notification_pref_kind(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notification_pref_kind(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_mandatory_notification_kind(p_kind text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT public.notification_pref_kind(p_kind) IN (
    'sos', 'panic', 'emergency', 'security', 'account', 'equipment_overdue_escalation'
  );
$$;

REVOKE ALL ON FUNCTION public.is_mandatory_notification_kind(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_mandatory_notification_kind(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) should_notify (service_role only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.should_notify(
  p_user_id uuid,
  p_kind text,
  p_channel text DEFAULT 'push'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_mandatory_notification_kind(p_kind) OR NOT EXISTS (
    SELECT 1
    FROM public.user_notification_prefs p
    WHERE p.user_id = p_user_id
      AND p.kind = public.notification_pref_kind(p_kind)
      AND (
        (p_channel = 'push' AND (
          NOT p.push_enabled
          OR (
            p.quiet_hours_start IS NOT NULL
            AND p.quiet_hours_end IS NOT NULL
            AND p.quiet_hours_start <> p.quiet_hours_end
            AND CASE
              WHEN p.quiet_hours_start < p.quiet_hours_end
                THEN (timezone('Africa/Johannesburg', now()))::time >= p.quiet_hours_start
                 AND (timezone('Africa/Johannesburg', now()))::time < p.quiet_hours_end
              ELSE (timezone('Africa/Johannesburg', now()))::time >= p.quiet_hours_start
                OR (timezone('Africa/Johannesburg', now()))::time < p.quiet_hours_end
            END
          )
        ))
        OR (p_channel = 'in_app' AND NOT p.in_app_enabled)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.should_notify(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.should_notify(uuid, text, text) TO service_role;

-- Batch helper for edge functions: returns the subset of p_user_ids to notify.
CREATE OR REPLACE FUNCTION public.filter_notify_recipients(
  p_user_ids uuid[],
  p_kind text,
  p_channel text DEFAULT 'push'
)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT u.id
  FROM unnest(coalesce(p_user_ids, ARRAY[]::uuid[])) AS u(id)
  WHERE u.id IS NOT NULL
    AND public.should_notify(u.id, p_kind, p_channel);
$$;

REVOKE ALL ON FUNCTION public.filter_notify_recipients(uuid[], text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.filter_notify_recipients(uuid[], text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) notify_app_user: latest body (20260818020000) + in-app preference check
-- ---------------------------------------------------------------------------
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
  IF NOT public.should_notify(p_user_id, coalesce(nullif(trim(p_kind), ''), 'info'), 'in_app') THEN
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

-- Same grants as before (internal helper, see 20260820080000_advisor_rpc_harden.sql).
REVOKE ALL ON FUNCTION public.notify_app_user(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_app_user(uuid, text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Verification (run manually in the SQL editor; staging first)
-- ---------------------------------------------------------------------------
-- PRE-CHECK (before applying): expect table absent, notify_app_user present.
--   SELECT to_regclass('public.user_notification_prefs');               -- NULL
--   SELECT count(*) FROM public.app_notifications;                       -- note this number
--   SELECT p.oid::regprocedure FROM pg_proc p
--    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'notify_app_user';
--
-- POST-CHECK (after applying):
--   SELECT to_regclass('public.user_notification_prefs');               -- not NULL
--   SELECT count(*) FROM public.app_notifications;                       -- same as pre-check
--   SELECT count(*) FROM public.user_notification_prefs;                 -- 0
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_notification_prefs'::regclass; -- true
--   SELECT public.is_mandatory_notification_kind('sos'),                -- true
--          public.is_mandatory_notification_kind('broadcast'),          -- false
--          public.notification_pref_kind('membership_verified');        -- membership
--   SELECT p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed,
--          has_function_privilege('service_role', p.oid, 'EXECUTE')  AS svc
--     FROM pg_proc p
--    WHERE p.pronamespace = 'public'::regnamespace
--      AND p.proname IN ('should_notify', 'filter_notify_recipients', 'notify_app_user',
--                        'is_mandatory_notification_kind', 'notification_pref_kind');
--   -- expect should_notify / filter_notify_recipients / notify_app_user: anon=f, authed=f, svc=t
--   -- Behaviour (rolls back):
--   BEGIN;
--     INSERT INTO public.user_notification_prefs (user_id, kind, push_enabled, in_app_enabled)
--     VALUES ('<test-user-uuid>', 'broadcast', false, true),
--            ('<test-user-uuid>', 'sos', false, false);
--     SELECT public.should_notify('<test-user-uuid>', 'broadcast', 'push');   -- false
--     SELECT public.should_notify('<test-user-uuid>', 'broadcast', 'in_app'); -- true
--     SELECT public.should_notify('<test-user-uuid>', 'sos', 'push');         -- true (mandatory)
--     SELECT * FROM public.filter_notify_recipients(ARRAY['<test-user-uuid>']::uuid[], 'broadcast'); -- 0 rows
--   ROLLBACK;
