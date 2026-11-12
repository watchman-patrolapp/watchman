-- =============================================================================
-- 20261113010000_home_widgets.sql
-- Android home-screen widgets. Additive and idempotent: safe to re-run.
-- Nothing is dropped.
--
--   1. widget_resident_snapshot(): one lean read for the Watchman Neighbourhood
--      widget (org name, anonymous patrol flag, latest alert, latest notice).
--   2. widget_send_resident_sos(lat, lng, accuracy): SOS from the native hold
--      screen for any signed-in member of the working org (residents included).
--      car_send_sos stays the patroller / Android Auto path.
--   3. Grants, schema reload, verification DO block.
--
-- Both functions are SECURITY DEFINER with a fixed search_path. The organisation
-- comes from car_working_org(auth.uid()) checked against current_org_ids(); the
-- client never supplies an organisation or user id.
-- Apply in the Supabase SQL editor. Cursor must not run this.
-- =============================================================================

-- 1. widget_resident_snapshot ----------------------------------------------------

CREATE OR REPLACE FUNCTION public.widget_resident_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_org uuid;
  v_org_name text;
  v_first text;
  v_patrol boolean;
  v_alert jsonb;
  v_notice jsonb;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('status', 'signed_out');
  END IF;

  SELECT nullif(split_part(trim(coalesce(u.full_name, '')), ' ', 1), '')
  INTO v_first
  FROM public.users u WHERE u.id = uid;

  v_org := public.car_working_org(uid);
  IF v_org IS NULL OR v_org NOT IN (SELECT public.current_org_ids()) THEN
    RETURN jsonb_build_object(
      'status', 'no_org',
      'first_name', v_first,
      'can_patrol', public.car_can_patrol(uid)
    );
  END IF;

  SELECT o.name INTO v_org_name FROM public.organizations o WHERE o.id = v_org;

  -- A boolean only. Never who, never how many.
  SELECT EXISTS (
    SELECT 1 FROM public.active_patrols ap WHERE ap.organization_id = v_org
  ) INTO v_patrol;

  -- Same rules as list_resident_neighbourhood_activity, limit 1, working org only.
  SELECT jsonb_build_object(
    'id', a.id,
    'title', a.incident_type,
    'street', a.street,
    'at', a.at,
    'is_sos', a.is_sos
  )
  INTO v_alert
  FROM (
    SELECT
      i.id,
      coalesce(nullif(trim(i.type), ''), nullif(trim(i.title), ''), 'Alert') AS incident_type,
      CASE
        WHEN upper(coalesce(i.type, '')) = 'SOS' THEN NULL
        WHEN coalesce(i.location, '') ~ '^-?[0-9]+(\.[0-9]+)?,\s*-?[0-9]+(\.[0-9]+)?' THEN NULL
        ELSE nullif(trim(i.location), '')
      END AS street,
      coalesce(i.submitted_at, i.incident_date) AS at,
      upper(coalesce(i.type, '')) = 'SOS' AS is_sos
    FROM public.incidents i
    JOIN public.users u ON u.id = i.reporter_id
    LEFT JOIN LATERAL (
      SELECT s.resolved_at
      FROM public.sos_alerts s
      WHERE s.incident_id = i.id
      ORDER BY s.created_at DESC NULLS LAST
      LIMIT 1
    ) sos ON true
    WHERE i.organization_id = v_org
      AND replace(lower(trim(u.role::text)), '-', '_') IN ('resident', 'user')
      AND (
        CASE
          WHEN upper(coalesce(i.type, '')) = 'SOS' THEN
            sos.resolved_at IS NULL
            OR sos.resolved_at >= now() - interval '15 minutes'
          ELSE
            coalesce(i.submitted_at, i.incident_date) >= now() - interval '10 hours'
        END
      )
    ORDER BY coalesce(i.submitted_at, i.incident_date) DESC NULLS LAST
    LIMIT 1
  ) a;

  -- Same rules as list_area_broadcasts, limit 1.
  SELECT jsonb_build_object(
    'id', b.id,
    'headline', coalesce(nullif(trim(b.headline), ''), 'Neighbourhood notice'),
    'at', b.created_at
  )
  INTO v_notice
  FROM public.area_broadcasts b
  WHERE b.organization_id = v_org
    AND b.created_at >= now() - interval '24 hours'
    AND b.hidden_at IS NULL
  ORDER BY b.created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'status', 'ok',
    'org_name', v_org_name,
    'can_patrol', public.car_can_patrol(uid),
    'first_name', v_first,
    'patrol_active', v_patrol,
    'latest_alert', v_alert,
    'latest_notice', v_notice
  );
END;
$$;

-- 2. widget_send_resident_sos ----------------------------------------------------

CREATE OR REPLACE FUNCTION public.widget_send_resident_sos(
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_accuracy double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_org uuid;
  v_name text;
  v_has_fix boolean;
  v_incident_id uuid;
  v_sos_id uuid;
  v_recent record;
  v_chat boolean := false;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('status', 'signed_out');
  END IF;
  v_org := public.car_working_org(uid);
  IF v_org IS NULL OR v_org NOT IN (SELECT public.current_org_ids()) THEN
    RETURN jsonb_build_object('status', 'no_org');
  END IF;

  SELECT s.id, s.incident_id INTO v_recent
  FROM public.sos_alerts s
  WHERE s.resident_id = uid AND s.resolved_at IS NULL
    AND s.created_at > now() - interval '2 minutes'
  ORDER BY s.created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'already_sent', 'sos_id', v_recent.id, 'incident_id', v_recent.incident_id);
  END IF;

  v_has_fix := p_lat IS NOT NULL AND p_lng IS NOT NULL
    AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180;

  SELECT coalesce(nullif(trim(u.full_name), ''), 'A resident') INTO v_name
  FROM public.users u WHERE u.id = uid;

  INSERT INTO public.incidents (
    type, status, title, description, submitted_by, submitted_by_name, reporter_id,
    location, incident_date, submitted_at, organization_id,
    latitude, longitude, location_accuracy
  ) VALUES (
    'SOS', 'approved', 'Resident SOS', 'Resident triggered SOS.',
    uid, v_name, uid,
    CASE WHEN v_has_fix THEN concat(p_lat, ', ', p_lng) ELSE 'Location unavailable' END,
    now(), now(), v_org,
    CASE WHEN v_has_fix THEN p_lat END,
    CASE WHEN v_has_fix THEN p_lng END,
    CASE WHEN v_has_fix THEN p_accuracy END
  )
  RETURNING id INTO v_incident_id;

  INSERT INTO public.sos_alerts (
    incident_id, resident_id, trigger_type, auto_location_accuracy, escalation_level, organization_id
  ) VALUES (
    v_incident_id, uid, 'hold',
    CASE WHEN v_has_fix AND p_accuracy IS NOT NULL THEN round(p_accuracy)::integer END,
    0, v_org
  )
  RETURNING id INTO v_sos_id;

  BEGIN
    INSERT INTO public.chat_messages (
      sender_id, sender_name, text, type, is_critical, visibility, expires_at, organization_id,
      location_lat, location_lng, location_address
    ) VALUES (
      uid, v_name,
      concat('SOS — ', v_name, ' needs help now.'),
      CASE WHEN v_has_fix THEN 'location' ELSE 'text' END,
      true, 'patrol', now() + interval '24 hours', v_org,
      CASE WHEN v_has_fix THEN p_lat END,
      CASE WHEN v_has_fix THEN p_lng END,
      CASE WHEN v_has_fix THEN 'Current GPS location' END
    );
    v_chat := true;
  EXCEPTION WHEN others THEN
    v_chat := false; -- The SOS row is what matters; chat is best effort.
  END;

  RETURN jsonb_build_object('status', 'sent', 'sos_id', v_sos_id, 'incident_id', v_incident_id, 'chat', v_chat);
END;
$$;

-- 3. Grants ----------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.widget_resident_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.widget_resident_snapshot() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.widget_send_resident_sos(double precision, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.widget_send_resident_sos(double precision, double precision, double precision) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- 4. Verification ----------------------------------------------------------------

DO $verify$
DECLARE
  missing text := '';
  f text;
  src text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.widget_resident_snapshot()',
    'public.widget_send_resident_sos(double precision, double precision, double precision)'
  ] LOOP
    IF to_regprocedure(f) IS NULL THEN
      missing := missing || f || ' ';
    ELSE
      IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(f)) THEN
        missing := missing || f || ':security_definer ';
      END IF;
      IF NOT has_function_privilege('authenticated', to_regprocedure(f), 'EXECUTE') THEN
        missing := missing || f || ':grant_authenticated ';
      END IF;
      IF has_function_privilege('anon', to_regprocedure(f), 'EXECUTE') THEN
        missing := missing || f || ':anon_can_execute ';
      END IF;
      src := pg_get_functiondef(to_regprocedure(f));
      IF src NOT LIKE '%auth.uid()%' OR src NOT LIKE '%signed_out%' THEN
        missing := missing || f || ':auth_check ';
      END IF;
      IF src NOT LIKE '%current_org_ids()%' OR src NOT LIKE '%car_working_org%' THEN
        missing := missing || f || ':org_check ';
      END IF;
    END IF;
  END LOOP;

  IF to_regprocedure('public.widget_resident_snapshot()') IS NOT NULL THEN
    src := pg_get_functiondef(to_regprocedure('public.widget_resident_snapshot()'));
    IF src NOT LIKE '%patrol_active%' OR src NOT LIKE '%latest_alert%' OR src NOT LIKE '%latest_notice%' OR src NOT LIKE '%org_name%' THEN
      missing := missing || 'widget_resident_snapshot:keys ';
    END IF;
    IF src LIKE '%phone%' THEN
      missing := missing || 'widget_resident_snapshot:phone ';
    END IF;
  END IF;

  IF to_regprocedure('public.widget_send_resident_sos(double precision, double precision, double precision)') IS NOT NULL THEN
    src := pg_get_functiondef(to_regprocedure('public.widget_send_resident_sos(double precision, double precision, double precision)'));
    IF src NOT LIKE '%already_sent%' OR src NOT LIKE '%''hold''%' OR src LIKE '%car_can_patrol%' THEN
      missing := missing || 'widget_send_resident_sos:contract ';
    END IF;
  END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION 'verification failed: %', trim(missing);
  END IF;
  RAISE NOTICE 'verification ok: widget_resident_snapshot, widget_send_resident_sos';
END
$verify$;
