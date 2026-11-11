-- =============================================================================
-- 20261112010000_android_auto_car_dashboard_polish.sql
-- Polish pass for the Android Auto car dashboard. Additive and idempotent:
-- safe to re-run. Nothing is dropped. Function signatures stay the same.
--
--   1. CREATE OR REPLACE public.car_dashboard: add org_center (suburb
--      center), online_patrollers (every active patrol in the caller's
--      orgs, GPS optional), and recent_messages (patrol chat, last 30 min).
--      Existing me / patrollers / incidents / sos keys are unchanged.
--   2. CREATE OR REPLACE public.car_start_patrol: include vehicle_type on
--      each needs_vehicle choice (id, label, registration already there).
--   3. Verification DO block.
--
-- All car_* functions stay SECURITY DEFINER with a fixed search_path, and
-- stay scoped to public.current_org_ids() and auth.uid().
-- Apply in the Supabase SQL editor. Cursor must not run this.
-- =============================================================================

-- 1. car_dashboard: same signature, extra keys in the ok payload -------------

CREATE OR REPLACE FUNCTION public.car_dashboard(
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_orgs uuid[];
  v_org uuid;
  v_name text;
  v_patrol record;
  v_fix record;
  v_ref_lat double precision := p_lat;
  v_ref_lng double precision := p_lng;
  v_org_lat double precision;
  v_org_lng double precision;
  v_me jsonb;
  v_patrollers jsonb;
  v_online jsonb;
  v_incidents jsonb;
  v_sos jsonb;
  v_messages jsonb := '[]'::jsonb;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('status', 'signed_out');
  END IF;

  SELECT u.full_name INTO v_name FROM public.users u WHERE u.id = uid;

  IF NOT public.car_can_patrol(uid) THEN
    RETURN jsonb_build_object('status', 'not_patroller', 'user_name', v_name);
  END IF;

  SELECT coalesce(array_agg(x), ARRAY[]::uuid[]) INTO v_orgs FROM public.current_org_ids() x;
  v_org := public.car_working_org(uid);
  IF v_org IS NULL OR NOT (v_org = ANY (v_orgs)) THEN
    RETURN jsonb_build_object('status', 'no_org', 'user_name', v_name);
  END IF;

  IF v_ref_lat IS NULL OR v_ref_lng IS NULL
     OR v_ref_lat NOT BETWEEN -90 AND 90 OR v_ref_lng NOT BETWEEN -180 AND 180 THEN
    v_ref_lat := NULL;
    v_ref_lng := NULL;
  END IF;

  -- Neighbourhood anchor: primary suburb centre, else any linked suburb.
  SELECT s.center_lat, s.center_lng
  INTO v_org_lat, v_org_lng
  FROM public.organizations o
  JOIN public.suburbs s ON s.id = o.primary_suburb_id
  WHERE o.id = v_org
    AND s.center_lat BETWEEN -90 AND 90
    AND s.center_lng BETWEEN -180 AND 180;

  IF v_org_lat IS NULL THEN
    SELECT s.center_lat, s.center_lng
    INTO v_org_lat, v_org_lng
    FROM public.organization_suburbs os
    JOIN public.suburbs s ON s.id = os.suburb_id
    WHERE os.organization_id = v_org
      AND os.active IS DISTINCT FROM false
      AND s.center_lat BETWEEN -90 AND 90
      AND s.center_lng BETWEEN -180 AND 180
    ORDER BY CASE WHEN os.assignment_type = 'primary' THEN 0 ELSE 1 END, s.name
    LIMIT 1;
  END IF;

  SELECT pl.latitude, pl.longitude, coalesce(pl."timestamp", pl.created_at) AS at
  INTO v_fix
  FROM public.patrol_locations pl
  WHERE pl.user_id = uid
    AND pl.deleted_at IS NULL
    AND pl.created_at > now() - interval '8 hours'
  ORDER BY pl.created_at DESC
  LIMIT 1;

  IF v_ref_lat IS NULL AND v_fix.latitude IS NOT NULL THEN
    v_ref_lat := v_fix.latitude;
    v_ref_lng := v_fix.longitude;
  END IF;

  IF v_ref_lat IS NULL AND v_org_lat IS NOT NULL THEN
    v_ref_lat := v_org_lat;
    v_ref_lng := v_org_lng;
  END IF;

  SELECT ap.user_id, ap.user_name, ap.start_time::timestamptz AS start_time,
         ap.vehicle_make_model, ap.vehicle_reg
  INTO v_patrol
  FROM public.active_patrols ap
  WHERE ap.user_id::text = uid::text;

  v_me := jsonb_build_object(
    'user_id', uid,
    'user_name', coalesce(v_patrol.user_name, v_name),
    'on_patrol', v_patrol.user_id IS NOT NULL,
    'start_time', v_patrol.start_time,
    'vehicle_label', nullif(trim(concat_ws(' · ', v_patrol.vehicle_make_model, v_patrol.vehicle_reg)), ''),
    'distance_km', CASE WHEN v_patrol.user_id IS NOT NULL THEN public.car_patrol_distance_km(uid) END,
    'last_fix', CASE WHEN v_fix.latitude IS NOT NULL THEN jsonb_build_object(
      'lat', v_fix.latitude, 'lng', v_fix.longitude, 'at', v_fix.at) END
  );

  -- Other active patrollers with a fix in the last 8 hours. Live = under 5 minutes.
  -- Unchanged: map pins still require coordinates.
  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.distance_km NULLS LAST, p.at DESC), '[]'::jsonb)
  INTO v_patrollers
  FROM (
    SELECT ap.user_id, ap.user_name, f.latitude AS lat, f.longitude AS lng, f.at,
           (f.created_at > now() - interval '5 minutes') AS is_live,
           public.car_haversine_km(v_ref_lat, v_ref_lng, f.latitude, f.longitude) AS distance_km
    FROM public.active_patrols ap
    JOIN LATERAL (
      SELECT pl.latitude, pl.longitude, pl.created_at,
             coalesce(pl."timestamp", pl.created_at) AS at
      FROM public.patrol_locations pl
      WHERE pl.user_id::text = ap.user_id::text
        AND pl.deleted_at IS NULL
        AND pl.created_at > now() - interval '8 hours'
      ORDER BY pl.created_at DESC
      LIMIT 1
    ) f ON true
    WHERE ap.user_id::text <> uid::text
      AND ap.organization_id = ANY (v_orgs)
    ORDER BY public.car_haversine_km(v_ref_lat, v_ref_lng, f.latitude, f.longitude) NULLS LAST,
             f.created_at DESC
    LIMIT 12
  ) p;

  -- Every active patrol in the caller's orgs, whether or not they have GPS.
  -- Includes the caller when they are on patrol (is_me = true).
  SELECT coalesce(jsonb_agg(to_jsonb(op) ORDER BY op.is_me DESC, op.start_time DESC), '[]'::jsonb)
  INTO v_online
  FROM (
    SELECT
      ap.user_id::text AS user_id,
      coalesce(nullif(trim(ap.user_name), ''), 'Patroller') AS user_name,
      ap.start_time::timestamptz AS start_time,
      nullif(trim(concat_ws(' · ', ap.vehicle_make_model, ap.vehicle_reg)), '') AS vehicle_label,
      ap.vehicle_type,
      (ap.user_id::text = uid::text) AS is_me,
      f.latitude AS lat,
      f.longitude AS lng,
      f.at,
      (f.created_at IS NOT NULL AND f.created_at > now() - interval '5 minutes') AS is_live
    FROM public.active_patrols ap
    LEFT JOIN LATERAL (
      SELECT pl.latitude, pl.longitude, pl.created_at,
             coalesce(pl."timestamp", pl.created_at) AS at
      FROM public.patrol_locations pl
      WHERE pl.user_id::text = ap.user_id::text
        AND pl.deleted_at IS NULL
        AND pl.created_at > now() - interval '8 hours'
      ORDER BY pl.created_at DESC
      LIMIT 1
    ) f ON true
    WHERE ap.organization_id = ANY (v_orgs)
    ORDER BY (ap.user_id::text = uid::text) DESC, ap.start_time DESC
    LIMIT 30
  ) op;

  -- Approved incidents with coordinates from the last 72 hours, SOS excluded (listed below).
  SELECT coalesce(jsonb_agg(to_jsonb(i2) ORDER BY i2.distance_km NULLS LAST, i2.at DESC), '[]'::jsonb)
  INTO v_incidents
  FROM (
    SELECT i.id, i.type, i.title, i.location AS address,
           coalesce(i.submitted_at, i.incident_date::timestamptz) AS at,
           i.latitude AS lat, i.longitude AS lng,
           public.car_haversine_km(v_ref_lat, v_ref_lng, i.latitude, i.longitude) AS distance_km,
           EXISTS (SELECT 1 FROM public.incident_acks a WHERE a.incident_id = i.id AND a.user_id = uid) AS acked_by_me,
           (SELECT count(*) FROM public.incident_acks a WHERE a.incident_id = i.id) AS ack_count
    FROM public.incidents i
    WHERE i.organization_id = ANY (v_orgs)
      AND i.status = 'approved'
      AND i.latitude IS NOT NULL
      AND i.longitude IS NOT NULL
      AND upper(coalesce(i.type, '')) <> 'SOS'
      AND coalesce(i.submitted_at, i.incident_date::timestamptz) > now() - interval '72 hours'
    ORDER BY public.car_haversine_km(v_ref_lat, v_ref_lng, i.latitude, i.longitude) NULLS LAST,
             coalesce(i.submitted_at, i.incident_date::timestamptz) DESC
    LIMIT 12
  ) i2;

  -- Open SOS alerts from the last 12 hours.
  SELECT coalesce(jsonb_agg(to_jsonb(s2) ORDER BY s2.created_at DESC), '[]'::jsonb)
  INTO v_sos
  FROM (
    SELECT s.id, s.incident_id, s.created_at,
           s.acknowledged_at, s.acknowledged_by_user_id,
           (s.acknowledged_by_user_id = uid) AS acked_by_me,
           (s.resident_id = uid) AS is_mine,
           coalesce(nullif(trim(u.full_name), ''), 'Someone') AS sender_name,
           i.latitude AS lat, i.longitude AS lng, i.location AS address,
           public.car_haversine_km(v_ref_lat, v_ref_lng, i.latitude, i.longitude) AS distance_km
    FROM public.sos_alerts s
    JOIN public.incidents i ON i.id = s.incident_id
    LEFT JOIN public.users u ON u.id = s.resident_id
    WHERE s.resolved_at IS NULL
      AND s.created_at > now() - interval '12 hours'
      AND s.organization_id = ANY (v_orgs)
    ORDER BY s.created_at DESC
    LIMIT 5
  ) s2;

  -- Recent patrol-channel chat. Best effort: a schema surprise must not fail the dashboard.
  BEGIN
    SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.at DESC), '[]'::jsonb)
    INTO v_messages
    FROM (
      SELECT
        cm.id,
        coalesce(nullif(trim(cm.sender_name), ''), 'Someone') AS sender_name,
        cm.created_at AS at,
        left(trim(coalesce(cm.text, '')), 80) AS preview,
        coalesce(cm.is_critical, false) AS is_critical
      FROM public.chat_messages cm
      WHERE cm.organization_id = ANY (v_orgs)
        AND cm.visibility = 'patrol'
        AND (cm.expires_at IS NULL OR cm.expires_at > now())
        AND cm.created_at > now() - interval '30 minutes'
        AND cm.sender_id::text IS DISTINCT FROM uid::text
        AND coalesce(cm.text, '') NOT LIKE 'SOS -%'
      ORDER BY cm.created_at DESC
      LIMIT 3
    ) m;
  EXCEPTION WHEN others THEN
    v_messages := '[]'::jsonb;
  END;

  RETURN jsonb_build_object(
    'status', 'ok',
    'server_time', now(),
    'organization_id', v_org,
    'org_center', CASE WHEN v_org_lat IS NOT NULL THEN jsonb_build_object(
      'lat', v_org_lat, 'lng', v_org_lng) END,
    'me', v_me,
    'patrollers', v_patrollers,
    'online_patrollers', coalesce(v_online, '[]'::jsonb),
    'incidents', v_incidents,
    'sos', v_sos,
    'recent_messages', coalesce(v_messages, '[]'::jsonb)
  );
END;
$$;

-- 2. car_start_patrol: add vehicle_type on needs_vehicle choices --------------

CREATE OR REPLACE FUNCTION public.car_start_patrol(p_vehicle_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_org uuid;
  v_user record;
  v_email text;
  v_vehicle record;
  v_count integer;
  v_zone text;
  v_existing timestamptz;
  v_start timestamptz := now();
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('status', 'signed_out');
  END IF;
  IF NOT public.car_can_patrol(uid) THEN
    RETURN jsonb_build_object('status', 'not_allowed');
  END IF;

  v_org := public.car_working_org(uid);
  IF v_org IS NULL OR v_org NOT IN (SELECT public.current_org_ids()) THEN
    RETURN jsonb_build_object('status', 'no_org');
  END IF;

  SELECT ap.start_time::timestamptz INTO v_existing
  FROM public.active_patrols ap WHERE ap.user_id::text = uid::text;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'already_active', 'start_time', v_existing);
  END IF;

  SELECT u.full_name, u.car_type, u.registration_number, u.vehicle_color
  INTO v_user FROM public.users u WHERE u.id = uid;
  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = uid;
  SELECT o.name INTO v_zone FROM public.organizations o WHERE o.id = v_org;

  -- Give the record a shape so the legacy (no vehicle) path can read v_vehicle.id.
  SELECT NULL::uuid AS id, NULL::text AS make_model, NULL::text AS registration,
         NULL::text AS color, NULL::text AS vehicle_type
  INTO v_vehicle;

  SELECT count(*) INTO v_count FROM public.user_vehicles uv WHERE uv.user_id = uid;

  IF p_vehicle_id IS NOT NULL THEN
    SELECT uv.id, uv.make_model, uv.registration, uv.color, uv.vehicle_type
    INTO v_vehicle FROM public.user_vehicles uv
    WHERE uv.id = p_vehicle_id AND uv.user_id = uid;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'invalid_vehicle');
    END IF;
  ELSIF v_count > 1 THEN
    RETURN jsonb_build_object(
      'status', 'needs_vehicle',
      'vehicles', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', x.id,
          'label', coalesce(nullif(trim(x.make_model), ''), 'Vehicle'),
          'registration', x.registration,
          'vehicle_type', x.vehicle_type
        )), '[]'::jsonb)
        FROM (
          SELECT uv.id, uv.make_model, uv.registration, uv.vehicle_type
          FROM public.user_vehicles uv
          WHERE uv.user_id = uid
          ORDER BY uv.is_primary DESC NULLS LAST, uv.make_model
          LIMIT 6
        ) x
      )
    );
  ELSIF v_count = 1 THEN
    SELECT uv.id, uv.make_model, uv.registration, uv.color, uv.vehicle_type
    INTO v_vehicle FROM public.user_vehicles uv WHERE uv.user_id = uid LIMIT 1;
  END IF;

  BEGIN
    IF v_vehicle.id IS NOT NULL THEN
      INSERT INTO public.active_patrols (
        user_id, user_name, vehicle_id, vehicle_type, vehicle_make_model,
        vehicle_reg, vehicle_color, start_time, zone, organization_id
      ) VALUES (
        uid,
        coalesce(nullif(trim(v_user.full_name), ''), v_email, 'Patroller'),
        v_vehicle.id,
        coalesce(nullif(lower(trim(v_vehicle.vehicle_type)), ''), 'car'),
        v_vehicle.make_model,
        v_vehicle.registration,
        v_vehicle.color,
        v_start,
        coalesce(v_zone, 'Theescombe'),
        v_org
      );
    ELSE
      INSERT INTO public.active_patrols (
        user_id, user_name, vehicle_type, car_type, reg_number,
        vehicle_color, start_time, zone, organization_id
      ) VALUES (
        uid,
        coalesce(nullif(trim(v_user.full_name), ''), v_email, 'Patroller'),
        'car',
        coalesce(nullif(trim(v_user.car_type), ''), '-'),
        coalesce(nullif(trim(v_user.registration_number), ''), '-'),
        coalesce(nullif(trim(v_user.vehicle_color), ''), 'gray'),
        v_start,
        coalesce(v_zone, 'Theescombe'),
        v_org
      );
    END IF;
  EXCEPTION WHEN unique_violation THEN
    SELECT ap.start_time::timestamptz INTO v_existing
    FROM public.active_patrols ap WHERE ap.user_id::text = uid::text;
    RETURN jsonb_build_object('status', 'already_active', 'start_time', v_existing);
  END;

  RETURN jsonb_build_object(
    'status', 'started',
    'start_time', v_start,
    'vehicle_label', nullif(trim(concat_ws(' · ', v_vehicle.make_model, v_vehicle.registration)), '')
  );
END;
$$;

-- Grants stay the same (replace keeps them, but re-assert for safety).
DO $grants$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.car_dashboard(double precision, double precision)',
    'public.car_start_patrol(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END
$grants$;

NOTIFY pgrst, 'reload schema';

-- 3. Verification ---------------------------------------------------------------

DO $verify$
DECLARE
  missing text := '';
  def_dash text;
  def_start text;
BEGIN
  IF to_regprocedure('public.car_dashboard(double precision, double precision)') IS NULL THEN
    missing := missing || 'car_dashboard ';
  END IF;
  IF to_regprocedure('public.car_start_patrol(uuid)') IS NULL THEN
    missing := missing || 'car_start_patrol ';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('car_dashboard', 'car_start_patrol')
      AND NOT p.prosecdef
  ) THEN
    missing := missing || 'car_dashboard/car_start_patrol:security_definer ';
  END IF;

  def_dash := pg_get_functiondef('public.car_dashboard(double precision, double precision)'::regprocedure);
  IF position('online_patrollers' in def_dash) = 0 THEN
    missing := missing || 'car_dashboard:online_patrollers ';
  END IF;
  IF position('org_center' in def_dash) = 0 THEN
    missing := missing || 'car_dashboard:org_center ';
  END IF;
  IF position('recent_messages' in def_dash) = 0 THEN
    missing := missing || 'car_dashboard:recent_messages ';
  END IF;

  def_start := pg_get_functiondef('public.car_start_patrol(uuid)'::regprocedure);
  IF position('vehicle_type' in def_start) = 0 THEN
    missing := missing || 'car_start_patrol:vehicle_type ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'suburbs' AND column_name = 'center_lat'
  ) THEN
    missing := missing || 'suburbs.center_lat ';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'suburbs' AND column_name = 'center_lng'
  ) THEN
    missing := missing || 'suburbs.center_lng ';
  END IF;

  IF abs(public.car_haversine_km(-30.0, 30.0, -30.0, 30.01) - 0.963) > 0.01 THEN
    missing := missing || 'car_haversine_km:math ';
  END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION 'verification failed: %', trim(missing);
  END IF;
  RAISE NOTICE 'verification ok: car_dashboard polish keys, car_start_patrol vehicle_type';
END
$verify$;
