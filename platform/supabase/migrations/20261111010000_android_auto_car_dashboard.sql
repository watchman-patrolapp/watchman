-- =============================================================================
-- 20261111010000_android_auto_car_dashboard.sql
-- Android Auto (option 2) server support. Additive and idempotent: safe to
-- re-run. Nothing is dropped or deleted except this file's own policies,
-- which it recreates.
--
--   1. incidents.latitude / longitude / location_accuracy, plus a backfill
--      from "lat, lng" location text
--   2. incident_acks (per-user Acknowledge), org-scoped RLS
--   3. car_haversine_km, car_patrol_distance_km (uncapped server-side km)
--   4. car_dashboard(lat, lng): everything the car map needs in one call
--   5. car_start_patrol, car_end_patrol (returns the summary), car_send_sos,
--      car_ack_incident, car_ack_sos, car_quick_report
--   6. Verification DO block
--
-- All car_* functions are SECURITY DEFINER with a fixed search_path. They
-- scope every read and write to public.current_org_ids() and auth.uid().
-- Apply in the Supabase SQL editor. Cursor must not run this.
-- =============================================================================

-- 1. Incident coordinates ------------------------------------------------------

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS location_accuracy double precision;

-- Backfill before adding the range checks. Only rows whose whole location text
-- is "lat, lng" (old SOS rows) and that parse into range. Addresses are left alone.
WITH parsed AS (
  SELECT
    i.id,
    trim(split_part(trim(i.location), ',', 1))::double precision AS lat,
    trim(split_part(trim(i.location), ',', 2))::double precision AS lng
  FROM public.incidents i
  WHERE i.latitude IS NULL
    AND i.longitude IS NULL
    AND i.location IS NOT NULL
    AND trim(i.location) ~ '^-?[0-9]{1,3}(\.[0-9]+)?[[:space:]]*,[[:space:]]*-?[0-9]{1,3}(\.[0-9]+)?$'
)
UPDATE public.incidents i
SET latitude = p.lat, longitude = p.lng
FROM parsed p
WHERE i.id = p.id
  AND p.lat BETWEEN -90 AND 90
  AND p.lng BETWEEN -180 AND 180;

DO $coords_ck$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incidents_latitude_range') THEN
    ALTER TABLE public.incidents
      ADD CONSTRAINT incidents_latitude_range
      CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incidents_longitude_range') THEN
    ALTER TABLE public.incidents
      ADD CONSTRAINT incidents_longitude_range
      CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
  END IF;
END
$coords_ck$;

CREATE INDEX IF NOT EXISTS incidents_org_coords_idx
  ON public.incidents (organization_id)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Latest-fix lookups per patroller (car pins).
CREATE INDEX IF NOT EXISTS patrol_locations_user_created_idx
  ON public.patrol_locations (user_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- 2. incident_acks ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.incident_acks (
  incident_id uuid NOT NULL REFERENCES public.incidents (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL,
  PRIMARY KEY (incident_id, user_id)
);

CREATE INDEX IF NOT EXISTS incident_acks_user_id_idx
  ON public.incident_acks (user_id, acknowledged_at DESC);

ALTER TABLE public.incident_acks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS incident_acks_select_org ON public.incident_acks;
CREATE POLICY incident_acks_select_org ON public.incident_acks
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR organization_id IN (SELECT public.current_org_ids())
    OR public.is_global_app_staff()
    OR public.is_platform_staff()
  );

DROP POLICY IF EXISTS incident_acks_insert_self ON public.incident_acks;
CREATE POLICY incident_acks_insert_self ON public.incident_acks
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id IN (SELECT public.current_org_ids())
  );

DROP POLICY IF EXISTS incident_acks_delete_staff ON public.incident_acks;
CREATE POLICY incident_acks_delete_staff ON public.incident_acks
  FOR DELETE TO authenticated
  USING (public.is_global_app_staff() OR public.is_platform_staff());

REVOKE ALL ON public.incident_acks FROM anon;
GRANT SELECT, INSERT ON public.incident_acks TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.incident_acks TO service_role;

-- 3. Distance helpers ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.car_haversine_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE
    WHEN lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN NULL
    ELSE 6371.0088 * 2 * asin(least(1.0, sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2)
      + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
    )))
  END
$$;

-- Uncapped km for the caller's active patrol: sums every uploaded fix since
-- start_time. Unlike the phone dashboard, it is not limited to the last 50 points.
-- Ignores fixes worse than 75 m, jitter under 5 m, and jumps faster than 200 km/h.
CREATE OR REPLACE FUNCTION public.car_patrol_distance_km(p_user_id uuid)
RETURNS double precision
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz;
  v_km double precision;
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN NULL;
  END IF;

  SELECT ap.start_time::timestamptz INTO v_start
  FROM public.active_patrols ap
  WHERE ap.user_id::text = p_user_id::text;
  IF NOT FOUND OR v_start IS NULL THEN
    RETURN 0;
  END IF;

  WITH pts AS (
    SELECT pl.id, pl.latitude, pl.longitude,
           coalesce(pl."timestamp", pl.created_at) AS at
    FROM public.patrol_locations pl
    WHERE pl.patrol_id = p_user_id
      AND pl.deleted_at IS NULL
      AND coalesce(pl."timestamp", pl.created_at) >= v_start - interval '1 minute'
      AND (pl.accuracy IS NULL OR pl.accuracy <= 75)
      AND pl.latitude BETWEEN -90 AND 90
      AND pl.longitude BETWEEN -180 AND 180
  ),
  seg AS (
    SELECT
      public.car_haversine_km(
        lag(latitude) OVER w, lag(longitude) OVER w, latitude, longitude
      ) AS km,
      extract(epoch FROM (at - lag(at) OVER w)) AS secs
    FROM pts
    WINDOW w AS (ORDER BY at, id)
  )
  SELECT coalesce(sum(km), 0) INTO v_km
  FROM seg
  WHERE km IS NOT NULL
    AND km >= 0.005
    AND (secs IS NULL OR (secs > 0 AND km * 3600.0 / secs <= 200));

  RETURN round(v_km::numeric, 2)::double precision;
END;
$$;

-- Internal: can this user start/stop patrols? Mirrors patrolStartStop in
-- platform/web/src/auth/roleMatrix.js.
CREATE OR REPLACE FUNCTION public.car_can_patrol(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user_id
      AND replace(lower(trim(u.role::text)), '-', '_') IN (
        'volunteer', 'patroller', 'investigator', 'committee',
        'nw_admin', 'admin', 'technical_support'
      )
  );
$$;

-- Internal: the caller's working organisation (same order as the web app).
CREATE OR REPLACE FUNCTION public.car_working_org(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    public.working_organization_id(),
    (SELECT u.organization_id FROM public.users u WHERE u.id = p_user_id)
  );
$$;

-- 4. car_dashboard ---------------------------------------------------------------

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
  v_me jsonb;
  v_patrollers jsonb;
  v_incidents jsonb;
  v_sos jsonb;
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

  RETURN jsonb_build_object(
    'status', 'ok',
    'server_time', now(),
    'organization_id', v_org,
    'me', v_me,
    'patrollers', v_patrollers,
    'incidents', v_incidents,
    'sos', v_sos
  );
END;
$$;

-- 5. Car actions -----------------------------------------------------------------

-- Check in = start patrol, same row shape as usePatrolLifecycle.js.
-- 0 vehicles: legacy users.* columns. 1 vehicle: that one. More than 1 with no
-- p_vehicle_id: returns needs_vehicle plus up to 6 choices for the car picker.
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
          'registration', x.registration
        )), '[]'::jsonb)
        FROM (
          SELECT uv.id, uv.make_model, uv.registration
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
        coalesce(nullif(trim(v_user.car_type), ''), '—'),
        coalesce(nullif(trim(v_user.registration_number), ''), '—'),
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

-- End patrol and return the summary. The km is computed BEFORE end_patrol,
-- because deleting active_patrols cascades to patrol_locations (patrol_id FK).
CREATE OR REPLACE FUNCTION public.car_end_patrol()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_start timestamptz;
  v_km double precision;
  v_end timestamptz;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('status', 'signed_out');
  END IF;

  SELECT ap.start_time::timestamptz INTO v_start
  FROM public.active_patrols ap WHERE ap.user_id::text = uid::text;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_active');
  END IF;

  v_km := public.car_patrol_distance_km(uid);
  v_end := now();
  PERFORM public.end_patrol(uid, false);

  RETURN jsonb_build_object(
    'status', 'ended',
    'start_time', v_start,
    'end_time', v_end,
    'duration_minutes', GREATEST(1, floor(extract(epoch FROM (v_end - v_start)) / 60.0)::integer),
    'distance_km', coalesce(v_km, 0)
  );
END;
$$;

-- Patroller SOS from the car: approved SOS incident + sos_alerts row (resident_id =
-- sender, as for residents) + a critical patrol-chat message. The chat insert fires
-- the existing push webhook. Within 2 minutes, a repeat send returns the open alert.
CREATE OR REPLACE FUNCTION public.car_send_sos(
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
  IF NOT public.car_can_patrol(uid) THEN
    RETURN jsonb_build_object('status', 'not_allowed');
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

  SELECT coalesce(nullif(trim(u.full_name), ''), 'A patroller') INTO v_name
  FROM public.users u WHERE u.id = uid;

  INSERT INTO public.incidents (
    type, status, title, description, submitted_by, submitted_by_name, reporter_id,
    location, incident_date, submitted_at, organization_id,
    latitude, longitude, location_accuracy
  ) VALUES (
    'SOS', 'approved', 'Patrol SOS', 'Patroller sent an SOS from Android Auto.',
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
    v_incident_id, uid, 'button',
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
      concat('SOS — ', v_name, ' needs help now. Sent from the car.'),
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

CREATE OR REPLACE FUNCTION public.car_ack_incident(p_incident_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_org uuid;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('status', 'signed_out');
  END IF;
  IF NOT public.car_can_patrol(uid) THEN
    RETURN jsonb_build_object('status', 'not_allowed');
  END IF;

  SELECT i.organization_id INTO v_org
  FROM public.incidents i
  WHERE i.id = p_incident_id
    AND i.status = 'approved'
    AND i.organization_id IN (SELECT public.current_org_ids());
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  INSERT INTO public.incident_acks (incident_id, user_id, organization_id)
  VALUES (p_incident_id, uid, v_org)
  ON CONFLICT (incident_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('status', 'acknowledged');
END;
$$;

CREATE OR REPLACE FUNCTION public.car_ack_sos(p_sos_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_row record;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('status', 'signed_out');
  END IF;
  IF NOT public.is_sos_responder() THEN
    RETURN jsonb_build_object('status', 'not_allowed');
  END IF;

  SELECT s.id, s.acknowledged_at, s.resolved_at INTO v_row
  FROM public.sos_alerts s
  WHERE s.id = p_sos_id
    AND s.organization_id IN (SELECT public.current_org_ids());
  IF NOT FOUND OR v_row.resolved_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_row.acknowledged_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_acknowledged');
  END IF;

  UPDATE public.sos_alerts
  SET acknowledged_by_user_id = uid, acknowledged_at = now()
  WHERE id = p_sos_id AND acknowledged_at IS NULL;

  RETURN jsonb_build_object('status', 'acknowledged');
END;
$$;

-- Preset quick report from the car. Pending, like a phone report, so moderation
-- still applies. One report every 30 seconds per user.
CREATE OR REPLACE FUNCTION public.car_quick_report(
  p_kind text,
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
  v_type text;
  v_title text;
  v_has_fix boolean;
  v_id uuid;
  v_tag constant text := 'Quick report from Android Auto.';
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

  CASE p_kind
    WHEN 'suspicious_vehicle' THEN v_type := 'Suspicious Vehicle';  v_title := 'Suspicious vehicle';
    WHEN 'suspicious_person'  THEN v_type := 'Suspicious Activity'; v_title := 'Suspicious person';
    WHEN 'theft'              THEN v_type := 'Theft';               v_title := 'Possible theft or break-in';
    WHEN 'vandalism'          THEN v_type := 'Vandalism';           v_title := 'Vandalism';
    ELSE RETURN jsonb_build_object('status', 'invalid_kind');
  END CASE;

  IF EXISTS (
    SELECT 1 FROM public.incidents i
    WHERE i.submitted_by::text = uid::text
      AND i.description LIKE v_tag || '%'
      AND i.submitted_at > now() - interval '30 seconds'
  ) THEN
    RETURN jsonb_build_object('status', 'too_soon');
  END IF;

  v_has_fix := p_lat IS NOT NULL AND p_lng IS NOT NULL
    AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180;
  SELECT coalesce(nullif(trim(u.full_name), ''), 'Patroller') INTO v_name
  FROM public.users u WHERE u.id = uid;

  INSERT INTO public.incidents (
    type, status, title, description, submitted_by, submitted_by_name, reporter_id,
    location, incident_date, submitted_at, organization_id,
    latitude, longitude, location_accuracy
  ) VALUES (
    v_type, 'pending', v_title,
    v_tag || ' Add details on the phone when it is safe.',
    uid, v_name, uid,
    CASE WHEN v_has_fix THEN concat(p_lat, ', ', p_lng) ELSE 'Location unavailable' END,
    now(), now(), v_org,
    CASE WHEN v_has_fix THEN p_lat END,
    CASE WHEN v_has_fix THEN p_lng END,
    CASE WHEN v_has_fix THEN p_accuracy END
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('status', 'reported', 'incident_id', v_id);
END;
$$;

-- Grants: signed-in users only. The helpers are internal.
DO $grants$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.car_haversine_km(double precision, double precision, double precision, double precision)',
    'public.car_patrol_distance_km(uuid)',
    'public.car_can_patrol(uuid)',
    'public.car_working_org(uuid)',
    'public.car_dashboard(double precision, double precision)',
    'public.car_start_patrol(uuid)',
    'public.car_end_patrol()',
    'public.car_send_sos(double precision, double precision, double precision)',
    'public.car_ack_incident(uuid)',
    'public.car_ack_sos(uuid)',
    'public.car_quick_report(text, double precision, double precision, double precision)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END
$grants$;

-- Make PostgREST see the new functions straight away.
NOTIFY pgrst, 'reload schema';

-- 6. Verification ---------------------------------------------------------------

DO $verify$
DECLARE
  missing text := '';
  f text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'incidents' AND column_name = 'latitude') THEN
    missing := missing || 'incidents.latitude ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'incidents' AND column_name = 'longitude') THEN
    missing := missing || 'incidents.longitude ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'incidents' AND column_name = 'location_accuracy') THEN
    missing := missing || 'incidents.location_accuracy ';
  END IF;
  IF to_regclass('public.incident_acks') IS NULL THEN
    missing := missing || 'incident_acks ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'incident_acks' AND c.relrowsecurity) THEN
    missing := missing || 'incident_acks.rls ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'incident_acks' AND policyname = 'incident_acks_insert_self') THEN
    missing := missing || 'policy.incident_acks_insert_self ';
  END IF;

  FOREACH f IN ARRAY ARRAY[
    'public.car_haversine_km(double precision, double precision, double precision, double precision)',
    'public.car_patrol_distance_km(uuid)',
    'public.car_dashboard(double precision, double precision)',
    'public.car_start_patrol(uuid)',
    'public.car_end_patrol()',
    'public.car_send_sos(double precision, double precision, double precision)',
    'public.car_ack_incident(uuid)',
    'public.car_ack_sos(uuid)',
    'public.car_quick_report(text, double precision, double precision, double precision)',
    'public.end_patrol(uuid, boolean)'
  ] LOOP
    IF to_regprocedure(f) IS NULL THEN
      missing := missing || f || ' ';
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'car\_%' AND p.proname <> 'car_haversine_km'
      AND NOT p.prosecdef) THEN
    missing := missing || 'car_*:security_definer ';
  END IF;

  IF abs(public.car_haversine_km(-30.0, 30.0, -30.0, 30.01) - 0.963) > 0.01 THEN
    missing := missing || 'car_haversine_km:math ';
  END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION 'verification failed: %', trim(missing);
  END IF;
  RAISE NOTICE 'verification ok: incident coords, incident_acks, car_* RPCs';
END
$verify$;
