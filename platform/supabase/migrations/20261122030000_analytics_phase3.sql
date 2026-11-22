-- Analytics phase 3: patrol distance fix and the Patrols / Safety / People / Community sections.
-- Additive and idempotent: CREATE OR REPLACE functions, CREATE INDEX IF NOT EXISTS, no data changes.
-- Every public RPC is SECURITY DEFINER, gated by is_global_app_staff() (users.role admin or
-- technical_support) and returns aggregates only (counts, sums, medians; no rows, no raw GPS).
--
-- Distance fix: the dashboard summed patrol_routes.total_distance_km only. The app's own route
-- history (AdminPatrolRoutesSection / patrolHistoryRoute.js) uses the stored total, else the
-- route_geojson track, else the raw GPS points in patrol_locations for the patrol's time window,
-- and nothing in the current code writes patrol_routes any more. So patrols tracked only through
-- patrol_locations (and routes saved with a NULL/0 total) showed 0 km. analytics_patrol_distances()
-- now mirrors the app: per patrol log, the larger of the matched route (stored total, else
-- GeoJSON length) and the GPS track (live + archived points, de-duplicated, (0,0) fixes and
-- >250 km/h jumps ignored).
--
-- Requires: 20261122020000_analytics_foundation.sql.

-- 0. Pre-check: list everything missing at once ------------------------------------------
DO $precheck$
DECLARE
  missing text := '';
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('users','id'),('users','role'),('users','created_at'),('users','full_name'),
      ('users','verified'),('users','verification_method'),
      ('organizations','id'),('organizations','name'),('organizations','type'),
      ('organizations','primary_suburb_id'),
      ('organization_members','organization_id'),('organization_members','user_id'),('organization_members','status'),
      ('suburbs','id'),('suburbs','city_id'),('suburbs','name'),('cities','id'),('cities','name'),
      ('patrol_logs','organization_id'),('patrol_logs','user_id'),('patrol_logs','user_name'),
      ('patrol_logs','start_time'),('patrol_logs','end_time'),('patrol_logs','duration_minutes'),
      ('patrol_logs','suburb_id'),('patrol_logs','vehicle_type'),
      ('patrol_routes','user_id'),('patrol_routes','created_at'),('patrol_routes','total_distance_km'),
      ('patrol_routes','route_geojson'),
      ('patrol_locations','id'),('patrol_locations','user_id'),('patrol_locations','latitude'),
      ('patrol_locations','longitude'),('patrol_locations','timestamp'),
      ('patrol_locations_archive','id'),('patrol_locations_archive','user_id'),('patrol_locations_archive','latitude'),
      ('patrol_locations_archive','longitude'),('patrol_locations_archive','timestamp'),
      ('hotspot_camera_checks','created_by'),('hotspot_camera_checks','created_at'),
      ('hotspot_camera_checks','hotspot_event_id'),('hotspot_events','id'),('hotspot_events','organization_id'),
      ('incidents','id'),('incidents','organization_id'),('incidents','status'),('incidents','type'),
      ('incidents','suburb_id'),('incidents','submitted_at'),('incidents','incident_date'),
      ('incidents','approved_at'),('incidents','rejected_at'),
      ('sos_alerts','incident_id'),
      ('criminal_profiles','id'),('criminal_profiles','status'),('criminal_profiles','risk_level'),
      ('criminal_profiles','organization_id'),('criminal_profiles','created_at'),
      ('profile_match_queue','status'),('profile_match_queue','created_at'),('profile_match_queue','organization_id'),
      ('resident_profiles','user_id'),('resident_profiles','verification_date'),('resident_profiles','verification_method'),
      ('resident_profiles','patroller_request_status'),('resident_profiles','patroller_request_at'),
      ('resident_profiles','patroller_request_reviewed_at'),
      ('resident_verification_vouchers','resident_user_id'),('resident_verification_vouchers','voucher_user_id'),
      ('resident_verification_vouchers','created_at'),
      ('activity_logs','action'),('activity_logs','organization_id'),('activity_logs','created_at'),
      ('activity_logs','details_json'),
      ('equipment_wishlist_items','organization_id'),('equipment_wishlist_items','status'),
      ('equipment_wishlist_items','created_at'),('equipment_wishlist_items','acquired_at'),
      ('equipment_wishlist_offers','organization_id'),('equipment_wishlist_offers','status'),
      ('equipment_wishlist_offers','kind'),('equipment_wishlist_offers','created_at'),
      ('wishlist_ledger_entries','id'),('wishlist_ledger_entries','organization_id'),('wishlist_ledger_entries','kind'),
      ('wishlist_ledger_entries','amount_cents'),('wishlist_ledger_entries','entry_date'),
      ('wishlist_ledger_entries','corrects_entry_id'),
      ('city_hub_posts','author_organization_id'),('city_hub_posts','type'),('city_hub_posts','status'),
      ('city_hub_posts','created_at'),('city_hub_posts','hidden_at'),
      ('chat_messages','organization_id'),('chat_messages','created_at'),('chat_messages','deleted_at'),
      ('area_broadcasts','organization_id'),('area_broadcasts','created_at'),('area_broadcasts','hidden_at'),
      ('community_content_reports','organization_id'),('community_content_reports','content_type'),
      ('community_content_reports','reason'),('community_content_reports','status'),
      ('community_content_reports','created_at'),('community_content_reports','handled_at'),
      ('feedback','organization_id'),('feedback','created_at'),('feedback','reviewed_at')
    ) AS t(tbl, col)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = r.tbl AND c.column_name = r.col
    ) THEN
      missing := missing || r.tbl || '.' || r.col || ' ';
    END IF;
  END LOOP;
  IF to_regprocedure('public.is_global_app_staff()') IS NULL THEN
    missing := missing || 'function is_global_app_staff() ';
  END IF;
  IF to_regprocedure('public.analytics_scope(uuid[],uuid[],uuid[])') IS NULL
     OR to_regprocedure('public.analytics_bounds(timestamptz,timestamptz,text)') IS NULL THEN
    missing := missing || 'analytics foundation (run 20261122020000_analytics_foundation.sql first) ';
  END IF;
  IF missing <> '' THEN
    RAISE EXCEPTION 'Analytics phase 3: not applied, missing %', btrim(missing);
  END IF;
END
$precheck$;

-- 1. Indexes for per-patrol GPS lookups ----------------------------------------------------
-- Plain CREATE INDEX (the SQL editor runs in a transaction, so CONCURRENTLY is not possible).
CREATE INDEX IF NOT EXISTS patrol_locations_user_timestamp_idx ON public.patrol_locations (user_id, "timestamp");
CREATE INDEX IF NOT EXISTS patrol_locations_archive_user_timestamp_idx ON public.patrol_locations_archive (user_id, "timestamp");
CREATE INDEX IF NOT EXISTS patrol_routes_created_at_idx ON public.patrol_routes (created_at);
CREATE INDEX IF NOT EXISTS patrol_logs_start_time_idx ON public.patrol_logs (start_time);

-- 2. Private helpers ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_haversine_km(
  p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT 2 * 6371.0088 * asin(least(1.0, sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  )));
$$;

-- Length of a GeoJSON LineString / MultiLineString / Feature / FeatureCollection, in km.
-- Accepts text so it works whether route_geojson is jsonb, json or text; bad JSON counts as 0.
CREATE OR REPLACE FUNCTION public.analytics_geojson_km(p_geo text)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  g jsonb;
  t text;
  total double precision := 0;
  part jsonb;
BEGIN
  IF p_geo IS NULL OR btrim(p_geo) = '' THEN
    RETURN 0;
  END IF;
  BEGIN
    g := p_geo::jsonb;
    IF jsonb_typeof(g) = 'string' THEN
      g := (g #>> '{}')::jsonb;
    END IF;
  EXCEPTION WHEN others THEN
    RETURN 0;
  END;
  IF jsonb_typeof(g) <> 'object' THEN
    RETURN 0;
  END IF;
  t := g ->> 'type';
  IF t = 'FeatureCollection' AND jsonb_typeof(g -> 'features') = 'array' THEN
    FOR part IN SELECT value FROM jsonb_array_elements(g -> 'features') LOOP
      total := total + public.analytics_geojson_km(part::text);
    END LOOP;
    RETURN total;
  END IF;
  IF t = 'Feature' THEN
    RETURN public.analytics_geojson_km((g -> 'geometry')::text);
  END IF;
  IF t = 'LineString' AND jsonb_typeof(g -> 'coordinates') = 'array' THEN
    RETURN public.analytics_line_km(g -> 'coordinates');
  END IF;
  IF t = 'MultiLineString' AND jsonb_typeof(g -> 'coordinates') = 'array' THEN
    FOR part IN SELECT value FROM jsonb_array_elements(g -> 'coordinates') LOOP
      IF jsonb_typeof(part) = 'array' THEN
        total := total + public.analytics_line_km(part);
      END IF;
    END LOOP;
    RETURN total;
  END IF;
  RETURN 0;
END;
$$;

-- [[lng, lat], ...] -> km (consecutive haversine).
CREATE OR REPLACE FUNCTION public.analytics_line_km(p_coords jsonb)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(sum(public.analytics_haversine_km(plat, plng, lat, lng)), 0)
  FROM (
    SELECT lat, lng,
           lag(lat) OVER (ORDER BY ord) AS plat,
           lag(lng) OVER (ORDER BY ord) AS plng
    FROM (
      SELECT e.ord,
             CASE WHEN jsonb_typeof(e.value -> 1) = 'number' THEN (e.value ->> 1)::double precision END AS lat,
             CASE WHEN jsonb_typeof(e.value -> 0) = 'number' THEN (e.value ->> 0)::double precision END AS lng
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_coords) = 'array' THEN p_coords ELSE '[]'::jsonb END)
           WITH ORDINALITY AS e(value, ord)
      WHERE jsonb_typeof(e.value) = 'array'
    ) pts
    WHERE lat IS NOT NULL AND lng IS NOT NULL AND NOT (lat = 0 AND lng = 0)
  ) seg
  WHERE plat IS NOT NULL;
$$;

-- patrol_logs.user_id as uuid (NULL when it is not a uuid string).
CREATE OR REPLACE FUNCTION public.analytics_uuid_or_null(p text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p::uuid END;
$$;

-- GPS km for one volunteer between two instants: live + archived points (archive rows keep the
-- live id, so a point is counted once), (0,0) fixes and jumps faster than 250 km/h ignored.
CREATE OR REPLACE FUNCTION public.analytics_gps_km(p_user uuid, p_start timestamptz, p_end timestamptz)
RETURNS double precision
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pts AS (
    SELECT p.latitude AS lat, p.longitude AS lng, p."timestamp" AS ts
    FROM public.patrol_locations p
    WHERE p.user_id = p_user AND p."timestamp" >= p_start AND p."timestamp" <= p_end
    UNION ALL
    SELECT a.latitude, a.longitude, a."timestamp"
    FROM public.patrol_locations_archive a
    WHERE a.user_id = p_user AND a."timestamp" >= p_start AND a."timestamp" <= p_end
      AND NOT EXISTS (SELECT 1 FROM public.patrol_locations p2 WHERE p2.id = a.id)
  ),
  seg AS (
    SELECT public.analytics_haversine_km(lag(lat) OVER w, lag(lng) OVER w, lat, lng) AS km,
           extract(epoch FROM (ts - lag(ts) OVER w)) AS secs
    FROM pts
    WHERE lat IS NOT NULL AND lng IS NOT NULL AND NOT (lat = 0 AND lng = 0)
    WINDOW w AS (ORDER BY ts)
  )
  SELECT coalesce(sum(km), 0)
  FROM seg
  WHERE km IS NOT NULL
    AND (km < 0.05 OR (secs > 0 AND km / (secs / 3600.0) <= 250));
$$;

-- Distance per patrol log in scope, the way the app's route history measures it.
CREATE OR REPLACE FUNCTION public.analytics_patrol_distances(
  p_from timestamptz, p_to timestamptz, p_all boolean, p_orgs uuid[], p_unassigned boolean
)
RETURNS TABLE (organization_id uuid, user_key text, start_time timestamptz, route_km numeric, gps_km numeric, km numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pl AS (
    SELECT l.organization_id, l.user_id::text AS uid_text, public.analytics_uuid_or_null(l.user_id::text) AS uid,
           l.start_time,
           coalesce(
             nullif(l.end_time, l.start_time),
             l.start_time + make_interval(mins => greatest(coalesce(l.duration_minutes::integer, 0), 0))
           ) AS end_time
    FROM public.patrol_logs l
    WHERE l.start_time >= p_from AND l.start_time < p_to
      AND public.analytics_in_scope(l.organization_id, p_all, p_orgs, p_unassigned)
  ),
  measured AS (
    SELECT pl.organization_id, pl.uid_text, pl.start_time,
           coalesce((
             SELECT max(CASE WHEN r.total_distance_km > 0 THEN r.total_distance_km::double precision
                             ELSE public.analytics_geojson_km(r.route_geojson::text) END)
             FROM public.patrol_routes r
             WHERE r.user_id::text = pl.uid_text
               AND r.created_at >= pl.start_time - interval '15 minutes'
               AND r.created_at <= greatest(pl.end_time, pl.start_time) + interval '45 minutes'
           ), 0) AS route_km,
           CASE WHEN pl.uid IS NOT NULL AND pl.end_time > pl.start_time
                THEN public.analytics_gps_km(pl.uid, pl.start_time, pl.end_time) ELSE 0 END AS gps_km
    FROM pl
  )
  SELECT m.organization_id, m.uid_text, m.start_time,
         round(m.route_km::numeric, 3), round(m.gps_km::numeric, 3),
         round(CASE WHEN greatest(m.route_km, m.gps_km) >= 0.05 THEN greatest(m.route_km, m.gps_km) ELSE 0 END::numeric, 3)
  FROM measured m;
$$;

-- Time buckets (Africa/Johannesburg) for a window.
CREATE OR REPLACE FUNCTION public.analytics_buckets(p_from timestamptz, p_to timestamptz, p_grain text)
RETURNS TABLE (bucket timestamp)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT gs::timestamp
  FROM generate_series(
    date_trunc(p_grain, p_from AT TIME ZONE 'Africa/Johannesburg'),
    date_trunc(p_grain, (p_to - interval '1 microsecond') AT TIME ZONE 'Africa/Johannesburg'),
    ('1 ' || p_grain)::interval
  ) gs;
$$;

-- "Thandi M." from a full name; never an email address.
CREATE OR REPLACE FUNCTION public.analytics_short_name(p_full text, p_fallback text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH n AS (
    SELECT regexp_split_to_array(btrim(regexp_replace(
      CASE
        WHEN nullif(btrim(p_full), '') IS NOT NULL AND position('@' IN p_full) = 0 THEN p_full
        WHEN nullif(btrim(p_fallback), '') IS NOT NULL AND position('@' IN p_fallback) = 0 THEN p_fallback
        ELSE 'Volunteer'
      END, '\s+', ' ', 'g')), ' ') AS parts
  )
  SELECT CASE WHEN array_length(parts, 1) > 1
    THEN parts[1] || ' ' || upper(left(parts[array_length(parts, 1)], 1)) || '.'
    ELSE parts[1] END
  FROM n;
$$;

-- Median / p90 of a set of seconds (helper for jsonb output).
CREATE OR REPLACE FUNCTION public.analytics_secs(p_value double precision)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN p_value IS NULL THEN NULL ELSE round(p_value::numeric, 0) END;
$$;

-- 3. Distance fix: KPIs, chart buckets and the watch table use analytics_patrol_distances() ---
CREATE OR REPLACE FUNCTION public.analytics_period_kpis(
  p_from timestamptz, p_to timestamptz, p_all boolean, p_orgs uuid[], p_unassigned boolean
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH dist AS (
    SELECT * FROM public.analytics_patrol_distances(p_from, p_to, p_all, p_orgs, p_unassigned)
  ),
  pl AS (
    SELECT l.organization_id, l.user_id::text AS uid, l.start_shared_at, l.end_shared_at,
           public.analytics_patrol_minutes(l.duration_minutes::numeric, l.start_time, l.end_time) AS minutes
    FROM public.patrol_logs l
    WHERE l.start_time >= p_from AND l.start_time < p_to
      AND public.analytics_in_scope(l.organization_id, p_all, p_orgs, p_unassigned)
  ),
  inc AS (
    SELECT i.status
    FROM public.incidents i
    WHERE coalesce(i.submitted_at, i.incident_date::timestamptz) >= p_from AND coalesce(i.submitted_at, i.incident_date::timestamptz) < p_to
      AND public.analytics_in_scope(i.organization_id, p_all, p_orgs, p_unassigned)
      AND NOT EXISTS (SELECT 1 FROM public.sos_alerts sa WHERE sa.incident_id = i.id)
  ),
  sos AS (
    SELECT extract(epoch FROM (sa.acknowledged_at - sa.created_at)) AS ack_seconds
    FROM public.sos_alerts sa
    LEFT JOIN public.incidents i ON i.id = sa.incident_id
    WHERE sa.created_at >= p_from AND sa.created_at < p_to
      AND public.analytics_in_scope(coalesce(sa.organization_id, i.organization_id), p_all, p_orgs, p_unassigned)
  ),
  su AS (
    SELECT u.role::text AS role
    FROM public.users u
    WHERE u.created_at >= p_from AND u.created_at < p_to
      AND public.analytics_user_in_scope(u.id, p_all, p_orgs)
  )
  SELECT jsonb_build_object(
    'patrols', (SELECT count(*) FROM pl),
    'patrol_hours', (SELECT round(coalesce(sum(minutes), 0) / 60.0, 1) FROM pl),
    'patrol_volunteers', (SELECT count(DISTINCT uid) FROM pl),
    'avg_patrol_minutes', (SELECT round(coalesce(avg(nullif(minutes, 0)), 0), 0) FROM pl),
    'active_watches', (
      -- Watches only (nw_group): patrols logged under a security company do not count.
      SELECT count(DISTINCT w.org) FROM (
        SELECT coalesce(organization_id, public.analytics_legacy_org_id()) AS org FROM pl
      ) w WHERE w.org = ANY (coalesce(p_orgs, '{}'))
    ),
    'shared_start', (SELECT count(*) FILTER (WHERE start_shared_at IS NOT NULL) FROM pl),
    'shared_end', (SELECT count(*) FILTER (WHERE end_shared_at IS NOT NULL) FROM pl),
    'share_rate_start', (
      SELECT CASE WHEN count(*) = 0 THEN NULL
        ELSE round(100.0 * count(*) FILTER (WHERE start_shared_at IS NOT NULL) / count(*), 1) END FROM pl
    ),
    'share_rate_end', (
      SELECT CASE WHEN count(*) = 0 THEN NULL
        ELSE round(100.0 * count(*) FILTER (WHERE end_shared_at IS NOT NULL) / count(*), 1) END FROM pl
    ),
    'distance_km', (SELECT round(coalesce(sum(d.km), 0), 1) FROM dist d),
    'distance_tracked_patrols', (SELECT count(*) FILTER (WHERE d.km > 0) FROM dist d),
    'incidents', (SELECT count(*) FROM inc),
    'incidents_approved', (SELECT count(*) FILTER (WHERE status = 'approved') FROM inc),
    'incidents_pending', (SELECT count(*) FILTER (WHERE status = 'pending') FROM inc),
    'incidents_rejected', (SELECT count(*) FILTER (WHERE status = 'rejected') FROM inc),
    'sos_alerts', (SELECT count(*) FROM sos),
    'sos_acknowledged', (SELECT count(ack_seconds) FROM sos),
    'sos_ack_median_seconds', (
      SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ack_seconds)::numeric, 0)
      FROM sos WHERE ack_seconds IS NOT NULL AND ack_seconds >= 0
    ),
    'sos_ack_p90_seconds', (
      SELECT round(percentile_cont(0.9) WITHIN GROUP (ORDER BY ack_seconds)::numeric, 0)
      FROM sos WHERE ack_seconds IS NOT NULL AND ack_seconds >= 0
    ),
    'signups', (SELECT count(*) FROM su),
    'signups_by_role', (
      SELECT coalesce(jsonb_object_agg(role, n), '{}'::jsonb)
      FROM (SELECT coalesce(role, 'unknown') AS role, count(*) AS n FROM su GROUP BY 1) x
    ),
    'terms_accepted', (
      SELECT count(DISTINCT t.user_id)
      FROM public.terms_acceptances t
      WHERE t.accepted_at >= p_from AND t.accepted_at < p_to
        AND public.analytics_user_in_scope(t.user_id, p_all, p_orgs)
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.analytics_series(
  p_from timestamptz, p_to timestamptz, p_grain text, p_all boolean, p_orgs uuid[], p_unassigned boolean
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH b AS (
    SELECT gs::timestamp AS bucket
    FROM generate_series(
      date_trunc(p_grain, p_from AT TIME ZONE 'Africa/Johannesburg'),
      date_trunc(p_grain, (p_to - interval '1 microsecond') AT TIME ZONE 'Africa/Johannesburg'),
      ('1 ' || p_grain)::interval
    ) gs
  ),
  pl AS (
    SELECT date_trunc(p_grain, l.start_time AT TIME ZONE 'Africa/Johannesburg') AS bucket,
           count(*) AS patrols,
           sum(public.analytics_patrol_minutes(l.duration_minutes::numeric, l.start_time, l.end_time)) AS minutes
    FROM public.patrol_logs l
    WHERE l.start_time >= p_from AND l.start_time < p_to
      AND public.analytics_in_scope(l.organization_id, p_all, p_orgs, p_unassigned)
    GROUP BY 1
  ),
  rt AS (
    SELECT date_trunc(p_grain, d.start_time AT TIME ZONE 'Africa/Johannesburg') AS bucket, sum(d.km) AS km
    FROM public.analytics_patrol_distances(p_from, p_to, p_all, p_orgs, p_unassigned) d
    GROUP BY 1
  ),
  inc AS (
    SELECT date_trunc(p_grain, coalesce(i.submitted_at, i.incident_date::timestamptz) AT TIME ZONE 'Africa/Johannesburg') AS bucket, count(*) AS n
    FROM public.incidents i
    WHERE coalesce(i.submitted_at, i.incident_date::timestamptz) >= p_from AND coalesce(i.submitted_at, i.incident_date::timestamptz) < p_to
      AND public.analytics_in_scope(i.organization_id, p_all, p_orgs, p_unassigned)
      AND NOT EXISTS (SELECT 1 FROM public.sos_alerts sa WHERE sa.incident_id = i.id)
    GROUP BY 1
  ),
  sos AS (
    SELECT date_trunc(p_grain, sa.created_at AT TIME ZONE 'Africa/Johannesburg') AS bucket, count(*) AS n
    FROM public.sos_alerts sa
    LEFT JOIN public.incidents i ON i.id = sa.incident_id
    WHERE sa.created_at >= p_from AND sa.created_at < p_to
      AND public.analytics_in_scope(coalesce(sa.organization_id, i.organization_id), p_all, p_orgs, p_unassigned)
    GROUP BY 1
  ),
  su AS (
    SELECT date_trunc(p_grain, u.created_at AT TIME ZONE 'Africa/Johannesburg') AS bucket, count(*) AS n
    FROM public.users u
    WHERE u.created_at >= p_from AND u.created_at < p_to
      AND public.analytics_user_in_scope(u.id, p_all, p_orgs)
    GROUP BY 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'bucket', to_char(b.bucket, 'YYYY-MM-DD'),
    'patrols', coalesce(pl.patrols, 0),
    'patrol_hours', round(coalesce(pl.minutes, 0) / 60.0, 1),
    'distance_km', round(coalesce(rt.km, 0)::numeric, 1),
    'incidents', coalesce(inc.n, 0),
    'sos_alerts', coalesce(sos.n, 0),
    'signups', coalesce(su.n, 0)
  ) ORDER BY b.bucket), '[]'::jsonb)
  FROM b
  LEFT JOIN pl ON pl.bucket = b.bucket
  LEFT JOIN rt ON rt.bucket = b.bucket
  LEFT JOIN inc ON inc.bucket = b.bucket
  LEFT JOIN sos ON sos.bucket = b.bucket
  LEFT JOIN su ON su.bucket = b.bucket;
$$;

CREATE OR REPLACE FUNCTION public.analytics_watch_table(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_city_ids uuid[] DEFAULT NULL,
  p_suburb_ids uuid[] DEFAULT NULL,
  p_org_ids uuid[] DEFAULT NULL,
  p_grain text DEFAULT 'week'
)
RETURNS TABLE (
  organization_id uuid,
  watch_name text,
  watch_status text,
  city_name text,
  suburb_name text,
  members integer,
  patrollers integer,
  patrols integer,
  patrol_hours numeric,
  previous_patrol_hours numeric,
  distance_km numeric,
  incidents integer,
  sos_alerts integer,
  last_activity_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b record;
  s record;
  v_legacy uuid := public.analytics_legacy_org_id();
BEGIN
  IF NOT coalesce(public.is_global_app_staff(), false) THEN
    RAISE EXCEPTION 'Only global admins and support can view analytics.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO b FROM public.analytics_bounds(p_from, p_to, p_grain);
  SELECT * INTO s FROM public.analytics_scope(p_city_ids, p_suburb_ids, p_org_ids);

  RETURN QUERY
  WITH orgs AS (
    SELECT o.id, o.name, o.status, o.city_id, o.primary_suburb_id
    FROM public.organizations o
    WHERE o.id = ANY (s.org_ids)
  ),
  mem AS (
    SELECT m.organization_id AS org,
           count(DISTINCT m.user_id) AS members,
           count(DISTINCT m.user_id) FILTER (WHERE m.member_role = 'patroller') AS patrollers
    FROM public.organization_members m
    WHERE m.status = 'active' AND m.organization_id = ANY (s.org_ids)
    GROUP BY 1
  ),
  pl AS (
    SELECT coalesce(l.organization_id, v_legacy) AS org,
           count(*) FILTER (WHERE l.start_time >= b.from_ts) AS patrols,
           sum(public.analytics_patrol_minutes(l.duration_minutes::numeric, l.start_time, l.end_time))
             FILTER (WHERE l.start_time >= b.from_ts) AS minutes,
           sum(public.analytics_patrol_minutes(l.duration_minutes::numeric, l.start_time, l.end_time))
             FILTER (WHERE l.start_time < b.from_ts) AS prev_minutes
    FROM public.patrol_logs l
    WHERE l.start_time >= b.prev_from_ts AND l.start_time < b.to_ts
    GROUP BY 1
  ),
  last_pl AS (
    SELECT coalesce(l.organization_id, v_legacy) AS org, max(coalesce(l.end_time, l.start_time)) AS at
    FROM public.patrol_logs l
    WHERE l.start_time < b.to_ts
    GROUP BY 1
  ),
  rt AS (
    SELECT coalesce(d.organization_id, v_legacy) AS org, sum(d.km) AS km
    FROM public.analytics_patrol_distances(b.from_ts, b.to_ts, s.all_orgs, s.org_ids, s.include_unassigned) d
    GROUP BY 1
  ),
  inc AS (
    SELECT coalesce(i.organization_id, v_legacy) AS org, count(*) AS n
    FROM public.incidents i
    WHERE coalesce(i.submitted_at, i.incident_date::timestamptz) >= b.from_ts AND coalesce(i.submitted_at, i.incident_date::timestamptz) < b.to_ts
      AND NOT EXISTS (SELECT 1 FROM public.sos_alerts sa WHERE sa.incident_id = i.id)
    GROUP BY 1
  ),
  last_inc AS (
    SELECT coalesce(i.organization_id, v_legacy) AS org, max(coalesce(i.submitted_at, i.incident_date::timestamptz)) AS at
    FROM public.incidents i
    WHERE coalesce(i.submitted_at, i.incident_date::timestamptz) < b.to_ts
    GROUP BY 1
  ),
  sos AS (
    SELECT coalesce(sa.organization_id, i.organization_id, v_legacy) AS org, count(*) AS n
    FROM public.sos_alerts sa
    LEFT JOIN public.incidents i ON i.id = sa.incident_id
    WHERE sa.created_at >= b.from_ts AND sa.created_at < b.to_ts
    GROUP BY 1
  )
  SELECT
    o.id,
    o.name,
    o.status,
    coalesce(c.name, pc.name),
    ps.name,
    coalesce(mem.members, 0)::integer,
    coalesce(mem.patrollers, 0)::integer,
    coalesce(pl.patrols, 0)::integer,
    round(coalesce(pl.minutes, 0) / 60.0, 1),
    round(coalesce(pl.prev_minutes, 0) / 60.0, 1),
    round(coalesce(rt.km, 0)::numeric, 1),
    coalesce(inc.n, 0)::integer,
    coalesce(sos.n, 0)::integer,
    nullif(greatest(coalesce(last_pl.at, '-infinity'), coalesce(last_inc.at, '-infinity')), '-infinity'::timestamptz)
  FROM orgs o
  LEFT JOIN public.cities c ON c.id = o.city_id
  LEFT JOIN public.suburbs ps ON ps.id = o.primary_suburb_id
  LEFT JOIN public.cities pc ON pc.id = ps.city_id
  LEFT JOIN mem ON mem.org = o.id
  LEFT JOIN pl ON pl.org = o.id
  LEFT JOIN last_pl ON last_pl.org = o.id
  LEFT JOIN rt ON rt.org = o.id
  LEFT JOIN inc ON inc.org = o.id
  LEFT JOIN last_inc ON last_inc.org = o.id
  LEFT JOIN sos ON sos.org = o.id
  ORDER BY round(coalesce(pl.minutes, 0) / 60.0, 1) DESC, o.name;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_period_kpis(timestamptz, timestamptz, boolean, uuid[], boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_series(timestamptz, timestamptz, text, boolean, uuid[], boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_watch_table(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_watch_table(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) TO authenticated;

-- 4. Patrols ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_patrols(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_city_ids uuid[] DEFAULT NULL,
  p_suburb_ids uuid[] DEFAULT NULL,
  p_org_ids uuid[] DEFAULT NULL,
  p_grain text DEFAULT 'week'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b record;
  s record;
  v_legacy uuid := public.analytics_legacy_org_id();
  v_result jsonb;
BEGIN
  IF NOT coalesce(public.is_global_app_staff(), false) THEN
    RAISE EXCEPTION 'Only global admins and support can view analytics.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public.analytics_bounds(p_from, p_to, p_grain);
  SELECT * INTO s FROM public.analytics_scope(p_city_ids, p_suburb_ids, p_org_ids);

  WITH pl AS (
    SELECT l.organization_id, l.user_id::text AS uid_text, public.analytics_uuid_or_null(l.user_id::text) AS uid,
           l.user_name, l.suburb_id, lower(nullif(btrim(l.vehicle_type), '')) AS vehicle,
           l.start_time,
           coalesce(nullif(l.end_time, l.start_time),
                    l.start_time + make_interval(mins => greatest(coalesce(l.duration_minutes::integer, 0), 0))) AS end_time,
           public.analytics_patrol_minutes(l.duration_minutes::numeric, l.start_time, l.end_time) AS minutes,
           (l.start_time AT TIME ZONE 'Africa/Johannesburg') AS local_start
    FROM public.patrol_logs l
    WHERE l.start_time >= b.from_ts AND l.start_time < b.to_ts
      AND public.analytics_in_scope(l.organization_id, s.all_orgs, s.org_ids, s.include_unassigned)
  ),
  heat AS (
    SELECT (extract(isodow FROM local_start)::int - 1) AS dow, extract(hour FROM local_start)::int AS hour,
           count(*) AS patrols, round(sum(minutes) / 60.0, 1) AS hours
    FROM pl GROUP BY 1, 2
  ),
  area AS (
    SELECT coalesce(pl.suburb_id, o.primary_suburb_id) AS suburb_id, count(*) AS patrols,
           round(sum(pl.minutes) / 60.0, 1) AS hours, count(DISTINCT pl.uid_text) AS volunteers
    FROM pl
    LEFT JOIN public.organizations o ON o.id = coalesce(pl.organization_id, v_legacy)
    GROUP BY 1
  ),
  vol_days AS (
    SELECT DISTINCT uid_text, (local_start)::date AS d FROM pl
  ),
  streaks AS (
    SELECT uid_text, max(len) AS longest
    FROM (
      SELECT uid_text, count(*) AS len
      FROM (SELECT uid_text, d, d - (row_number() OVER (PARTITION BY uid_text ORDER BY d))::int AS grp FROM vol_days) x
      GROUP BY uid_text, grp
    ) y
    GROUP BY uid_text
  ),
  vols AS (
    SELECT pl.uid_text, count(*) AS patrols, round(sum(pl.minutes) / 60.0, 1) AS hours,
           max(pl.user_name) AS user_name, max(pl.uid::text)::uuid AS uid,
           count(DISTINCT pl.local_start::date) AS days
    FROM pl GROUP BY 1
  ),
  top_vols AS (
    SELECT v.*, st.longest, u.full_name
    FROM vols v
    LEFT JOIN streaks st ON st.uid_text = v.uid_text
    LEFT JOIN public.users u ON u.id = v.uid
    ORDER BY v.hours DESC, v.patrols DESC
    LIMIT 10
  ),
  checks AS (
    SELECT count(c.*) AS n, count(DISTINCT pl.uid_text || pl.start_time::text) AS patrols_with
    FROM pl
    JOIN public.hotspot_camera_checks c
      ON c.created_by = pl.uid AND c.created_at >= pl.start_time AND c.created_at <= pl.end_time
  ),
  all_checks AS (
    SELECT count(*) AS n
    FROM public.hotspot_camera_checks c
    LEFT JOIN public.hotspot_events e ON e.id = c.hotspot_event_id
    WHERE c.created_at >= b.from_ts AND c.created_at < b.to_ts
      AND public.analytics_in_scope(e.organization_id, s.all_orgs, s.org_ids, s.include_unassigned)
  ),
  dist AS (
    SELECT * FROM public.analytics_patrol_distances(b.from_ts, b.to_ts, s.all_orgs, s.org_ids, s.include_unassigned)
  )
  SELECT jsonb_build_object(
    'patrols', (SELECT count(*) FROM pl),
    'volunteers', (SELECT count(*) FROM vols),
    'heat', (SELECT coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'hour', hour, 'patrols', patrols, 'hours', hours)
                     ORDER BY dow, hour), '[]'::jsonb) FROM heat),
    'by_weekday', (SELECT coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'patrols', n, 'hours', h) ORDER BY dow), '[]'::jsonb)
                   FROM (SELECT dow, sum(patrols) AS n, sum(hours) AS h FROM heat GROUP BY dow) w),
    'by_hour', (SELECT coalesce(jsonb_agg(jsonb_build_object('hour', hour, 'patrols', n, 'hours', h) ORDER BY hour), '[]'::jsonb)
                FROM (SELECT hour, sum(patrols) AS n, sum(hours) AS h FROM heat GROUP BY hour) hh),
    'coverage_by_suburb', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'suburb_id', a.suburb_id, 'suburb', coalesce(sb.name, 'Area not set'), 'city', c.name,
               'patrols', a.patrols, 'hours', a.hours, 'volunteers', a.volunteers)
             ORDER BY a.hours DESC, a.patrols DESC), '[]'::jsonb)
      FROM (SELECT * FROM area ORDER BY hours DESC, patrols DESC LIMIT 25) a
      LEFT JOIN public.suburbs sb ON sb.id = a.suburb_id
      LEFT JOIN public.cities c ON c.id = sb.city_id
    ),
    'top_patrollers', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'name', public.analytics_short_name(t.full_name, t.user_name),
               'hours', t.hours, 'patrols', t.patrols, 'days', t.days, 'longest_streak_days', coalesce(t.longest, 0))
             ORDER BY t.hours DESC, t.patrols DESC), '[]'::jsonb)
      FROM top_vols t
    ),
    'streaks', jsonb_build_object(
      'longest_days', (SELECT coalesce(max(longest), 0) FROM streaks),
      'volunteers_3plus', (SELECT count(*) FROM streaks WHERE longest >= 3)
    ),
    'checks', jsonb_build_object(
      'during_patrols', (SELECT n FROM checks),
      'patrols_with_checks', (SELECT patrols_with FROM checks),
      'per_patrol', (SELECT CASE WHEN (SELECT count(*) FROM pl) = 0 THEN NULL
                     ELSE round((SELECT n FROM checks)::numeric / (SELECT count(*) FROM pl), 2) END),
      'total', (SELECT n FROM all_checks)
    ),
    'vehicles', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('vehicle', vehicle, 'patrols', n) ORDER BY n DESC, vehicle), '[]'::jsonb)
      FROM (SELECT coalesce(vehicle, 'unknown') AS vehicle, count(*) AS n FROM pl GROUP BY 1) v
    ),
    'distance', jsonb_build_object(
      'km', (SELECT round(coalesce(sum(km), 0), 1) FROM dist),
      'tracked_patrols', (SELECT count(*) FILTER (WHERE km > 0) FROM dist),
      'from_routes', (SELECT count(*) FILTER (WHERE km > 0 AND route_km >= gps_km) FROM dist),
      'from_gps', (SELECT count(*) FILTER (WHERE km > 0 AND gps_km > route_km) FROM dist),
      'avg_km_per_tracked_patrol', (SELECT round(avg(km) FILTER (WHERE km > 0), 2) FROM dist)
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- Route coverage: GPS points of in-scope patrols snapped to ~550 m cells (0.005 degrees).
-- Privacy: the first and last 5 minutes of every patrol are dropped (that is where homes are),
-- and a cell is only returned when at least 3 patrols by at least 2 different volunteers passed
-- through it. Only cell centres and counts leave the database; never points or homes.
CREATE OR REPLACE FUNCTION public.analytics_patrol_coverage(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_city_ids uuid[] DEFAULT NULL,
  p_suburb_ids uuid[] DEFAULT NULL,
  p_org_ids uuid[] DEFAULT NULL,
  p_grain text DEFAULT 'week'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b record;
  s record;
  v_cell constant double precision := 0.005;
  v_result jsonb;
BEGIN
  IF NOT coalesce(public.is_global_app_staff(), false) THEN
    RAISE EXCEPTION 'Only global admins and support can view analytics.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public.analytics_bounds(p_from, p_to, p_grain);
  SELECT * INTO s FROM public.analytics_scope(p_city_ids, p_suburb_ids, p_org_ids);

  WITH pl AS (
    SELECT row_number() OVER () AS pid, public.analytics_uuid_or_null(l.user_id::text) AS uid,
           l.start_time + interval '5 minutes' AS t0,
           coalesce(nullif(l.end_time, l.start_time),
                    l.start_time + make_interval(mins => greatest(coalesce(l.duration_minutes::integer, 0), 0)))
             - interval '5 minutes' AS t1
    FROM public.patrol_logs l
    WHERE l.start_time >= b.from_ts AND l.start_time < b.to_ts
      AND public.analytics_in_scope(l.organization_id, s.all_orgs, s.org_ids, s.include_unassigned)
  ),
  hits AS (
    SELECT DISTINCT pl.pid, pl.uid, floor(p.latitude / v_cell)::int AS cy, floor(p.longitude / v_cell)::int AS cx
    FROM pl
    JOIN public.patrol_locations p ON p.user_id = pl.uid AND p."timestamp" >= pl.t0 AND p."timestamp" <= pl.t1
    WHERE pl.uid IS NOT NULL AND pl.t1 > pl.t0 AND NOT (p.latitude = 0 AND p.longitude = 0)
    UNION
    SELECT DISTINCT pl.pid, pl.uid, floor(a.latitude / v_cell)::int, floor(a.longitude / v_cell)::int
    FROM pl
    JOIN public.patrol_locations_archive a ON a.user_id = pl.uid AND a."timestamp" >= pl.t0 AND a."timestamp" <= pl.t1
    WHERE pl.uid IS NOT NULL AND pl.t1 > pl.t0 AND NOT (a.latitude = 0 AND a.longitude = 0)
  ),
  cells AS (
    SELECT cy, cx, count(DISTINCT pid) AS patrols, count(DISTINCT uid) AS volunteers
    FROM hits GROUP BY cy, cx
  ),
  shown AS (
    SELECT * FROM cells WHERE patrols >= 3 AND volunteers >= 2 ORDER BY patrols DESC LIMIT 600
  )
  SELECT jsonb_build_object(
    'cell_degrees', v_cell,
    'min_patrols', 3,
    'min_volunteers', 2,
    'trim_minutes', 5,
    'cells_total', (SELECT count(*) FROM cells),
    'cells_hidden', (SELECT count(*) FROM cells) - (SELECT count(*) FROM shown),
    'cells', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'lat', round(((cy + 0.5) * v_cell)::numeric, 4), 'lng', round(((cx + 0.5) * v_cell)::numeric, 4),
                'patrols', patrols) ORDER BY patrols DESC), '[]'::jsonb) FROM shown)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- 5. Safety -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_safety(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_city_ids uuid[] DEFAULT NULL,
  p_suburb_ids uuid[] DEFAULT NULL,
  p_org_ids uuid[] DEFAULT NULL,
  p_grain text DEFAULT 'week'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b record;
  s record;
  v_result jsonb;
BEGIN
  IF NOT coalesce(public.is_global_app_staff(), false) THEN
    RAISE EXCEPTION 'Only global admins and support can view analytics.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public.analytics_bounds(p_from, p_to, p_grain);
  SELECT * INTO s FROM public.analytics_scope(p_city_ids, p_suburb_ids, p_org_ids);

  WITH scoped AS (
    -- Every non-SOS incident in scope (any date); "inc" narrows to the window.
    SELECT i.id, i.status, i.type, i.suburb_id, i.approved_at, i.rejected_at,
           coalesce(i.submitted_at, i.incident_date::timestamptz) AS reported_at
    FROM public.incidents i
    WHERE public.analytics_in_scope(i.organization_id, s.all_orgs, s.org_ids, s.include_unassigned)
      AND NOT EXISTS (SELECT 1 FROM public.sos_alerts sa WHERE sa.incident_id = i.id)
  ),
  inc AS (
    SELECT * FROM scoped WHERE reported_at >= b.from_ts AND reported_at < b.to_ts
  ),
  types AS (
    SELECT coalesce(nullif(btrim(type), ''), 'Unspecified') AS label, count(*) AS n FROM inc GROUP BY 1
  ),
  types_ranked AS (
    SELECT label, n, row_number() OVER (ORDER BY n DESC, label) AS rk FROM types
  ),
  areas AS (
    SELECT coalesce(sb.name, 'Area not set') AS suburb, c.name AS city, count(*) AS n
    FROM inc
    LEFT JOIN public.suburbs sb ON sb.id = inc.suburb_id
    LEFT JOIN public.cities c ON c.id = sb.city_id
    GROUP BY 1, 2
  ),
  approve AS (
    SELECT extract(epoch FROM (approved_at - reported_at)) AS secs
    FROM inc WHERE approved_at IS NOT NULL AND approved_at >= reported_at
  ),
  reject AS (
    SELECT extract(epoch FROM (rejected_at - reported_at)) AS secs
    FROM inc WHERE rejected_at IS NOT NULL AND rejected_at >= reported_at
  ),
  pending_now AS (
    SELECT reported_at FROM scoped WHERE status = 'pending'
  ),
  profiles AS (
    SELECT lower(coalesce(nullif(btrim(cp.status::text), ''), 'unknown')) AS status,
           lower(coalesce(nullif(btrim(cp.risk_level::text), ''), 'unknown')) AS risk,
           cp.created_at
    FROM public.criminal_profiles cp
    WHERE public.analytics_in_scope(cp.organization_id, s.all_orgs, s.org_ids, s.include_unassigned)
  ),
  queue AS (
    SELECT lower(coalesce(q.status::text, 'unknown')) AS status, q.created_at
    FROM public.profile_match_queue q
    WHERE public.analytics_in_scope(q.organization_id, s.all_orgs, s.org_ids, s.include_unassigned)
  )
  SELECT jsonb_build_object(
    'incidents', (SELECT count(*) FROM inc),
    'by_type', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('type', label, 'incidents', n) ORDER BY n DESC, label), '[]'::jsonb)
      FROM (
        SELECT label, n FROM types_ranked WHERE rk <= 10
        UNION ALL
        SELECT 'Other types', sum(n)::bigint FROM types_ranked WHERE rk > 10 HAVING count(*) > 0
      ) t
    ),
    'by_area', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('suburb', suburb, 'city', city, 'incidents', n) ORDER BY n DESC, suburb), '[]'::jsonb)
      FROM (SELECT * FROM areas ORDER BY n DESC, suburb LIMIT 15) a
    ),
    'by_city', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('city', city, 'incidents', n) ORDER BY n DESC, city), '[]'::jsonb)
      FROM (SELECT coalesce(city, 'City not set') AS city, sum(n)::bigint AS n FROM areas GROUP BY 1) c
    ),
    'moderation', jsonb_build_object(
      'approved', (SELECT count(*) FROM approve),
      'approve_median_seconds', (SELECT public.analytics_secs(percentile_cont(0.5) WITHIN GROUP (ORDER BY secs)) FROM approve),
      'approve_p90_seconds', (SELECT public.analytics_secs(percentile_cont(0.9) WITHIN GROUP (ORDER BY secs)) FROM approve),
      'rejected', (SELECT count(*) FROM reject),
      'reject_median_seconds', (SELECT public.analytics_secs(percentile_cont(0.5) WITHIN GROUP (ORDER BY secs)) FROM reject),
      'pending_now', (SELECT count(*) FROM pending_now),
      'oldest_pending_seconds', (SELECT public.analytics_secs(extract(epoch FROM (now() - min(reported_at)))) FROM pending_now)
    ),
    'profiles', jsonb_build_object(
      'total', (SELECT count(*) FROM profiles),
      'new_in_period', (SELECT count(*) FROM profiles WHERE created_at >= b.from_ts AND created_at < b.to_ts),
      'by_status', (SELECT coalesce(jsonb_agg(jsonb_build_object('status', status, 'profiles', n) ORDER BY n DESC, status), '[]'::jsonb)
                    FROM (SELECT status, count(*) AS n FROM profiles GROUP BY 1) x),
      'by_risk', (SELECT coalesce(jsonb_agg(jsonb_build_object('risk', risk, 'profiles', n) ORDER BY n DESC, risk), '[]'::jsonb)
                  FROM (SELECT risk, count(*) AS n FROM profiles GROUP BY 1) x)
    ),
    'match_queue', jsonb_build_object(
      'pending', (SELECT count(*) FROM queue WHERE status = 'pending'),
      'pending_by_age', jsonb_build_object(
        'under_1_day', (SELECT count(*) FROM queue WHERE status = 'pending' AND created_at >= now() - interval '1 day'),
        'days_1_7', (SELECT count(*) FROM queue WHERE status = 'pending' AND created_at < now() - interval '1 day' AND created_at >= now() - interval '7 days'),
        'days_7_30', (SELECT count(*) FROM queue WHERE status = 'pending' AND created_at < now() - interval '7 days' AND created_at >= now() - interval '30 days'),
        'over_30_days', (SELECT count(*) FROM queue WHERE status = 'pending' AND created_at < now() - interval '30 days')
      ),
      'oldest_pending_seconds', (SELECT public.analytics_secs(extract(epoch FROM (now() - min(created_at)))) FROM queue WHERE status = 'pending'),
      'created_in_period', (SELECT count(*) FROM queue WHERE created_at >= b.from_ts AND created_at < b.to_ts),
      'created_by_status', (SELECT coalesce(jsonb_agg(jsonb_build_object('status', status, 'matches', n) ORDER BY n DESC, status), '[]'::jsonb)
                            FROM (SELECT status, count(*) AS n FROM queue WHERE created_at >= b.from_ts AND created_at < b.to_ts GROUP BY 1) x)
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- 6. People -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_people(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_city_ids uuid[] DEFAULT NULL,
  p_suburb_ids uuid[] DEFAULT NULL,
  p_org_ids uuid[] DEFAULT NULL,
  p_grain text DEFAULT 'week'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b record;
  s record;
  v_result jsonb;
BEGIN
  IF NOT coalesce(public.is_global_app_staff(), false) THEN
    RAISE EXCEPTION 'Only global admins and support can view analytics.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public.analytics_bounds(p_from, p_to, p_grain);
  SELECT * INTO s FROM public.analytics_scope(p_city_ids, p_suburb_ids, p_org_ids);

  WITH new_users AS (
    SELECT u.id FROM public.users u
    WHERE u.created_at >= b.from_ts AND u.created_at < b.to_ts
      AND public.analytics_user_in_scope(u.id, s.all_orgs, s.org_ids)
  ),
  per_watch AS (
    SELECT o.id, o.name, count(DISTINCT m.user_id) AS n
    FROM new_users nu
    JOIN public.organization_members m ON m.user_id = nu.id AND m.status = 'active'
    JOIN public.organizations o ON o.id = m.organization_id AND o.id = ANY (s.org_ids)
    GROUP BY o.id, o.name
  ),
  residents AS (
    SELECT (rp.verification_date IS NOT NULL OR coalesce(u.verified, false)) AS verified,
           lower(coalesce(nullif(btrim(coalesce(rp.verification_method, u.verification_method)), ''), 'pending')) AS method
    FROM public.users u
    LEFT JOIN public.resident_profiles rp ON rp.user_id = u.id
    WHERE lower(btrim(coalesce(u.role::text, ''))) IN ('resident', 'user')
      AND public.analytics_user_in_scope(u.id, s.all_orgs, s.org_ids)
  ),
  vouches AS (
    SELECT v.resident_user_id, v.voucher_user_id
    FROM public.resident_verification_vouchers v
    WHERE v.created_at >= b.from_ts AND v.created_at < b.to_ts
      AND public.analytics_user_in_scope(v.resident_user_id, s.all_orgs, s.org_ids)
  ),
  requests AS (
    SELECT lower(coalesce(rp.patroller_request_status, 'unknown')) AS status,
           rp.patroller_request_at AS at, rp.patroller_request_reviewed_at AS reviewed_at
    FROM public.resident_profiles rp
    WHERE rp.patroller_request_at IS NOT NULL
      AND public.analytics_user_in_scope(rp.user_id, s.all_orgs, s.org_ids)
  ),
  deletions AS (
    SELECT a.action, lower(coalesce(a.details_json ->> 'subject_role', 'unknown')) AS role, a.created_at
    FROM public.activity_logs a
    WHERE a.action IN ('account_self_deleted', 'user_deleted')
      AND a.created_at >= b.from_ts AND a.created_at < b.to_ts
      AND public.analytics_in_scope(a.organization_id, s.all_orgs, s.org_ids, s.include_unassigned)
  )
  SELECT jsonb_build_object(
    'signups', (SELECT count(*) FROM new_users),
    'signups_by_watch', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('organization_id', id, 'watch', name, 'signups', n) ORDER BY n DESC, name), '[]'::jsonb)
      FROM (SELECT * FROM per_watch ORDER BY n DESC, name LIMIT 15) w
    ),
    'signups_without_watch', (
      SELECT count(*) FROM new_users nu
      WHERE NOT EXISTS (SELECT 1 FROM public.organization_members m WHERE m.user_id = nu.id AND m.status = 'active')
    ),
    'residents', jsonb_build_object(
      'total', (SELECT count(*) FROM residents),
      'verified', (SELECT count(*) FROM residents WHERE verified),
      'pending', (SELECT count(*) FROM residents WHERE NOT verified),
      'by_method', (SELECT coalesce(jsonb_agg(jsonb_build_object('method', method, 'residents', n) ORDER BY n DESC, method), '[]'::jsonb)
                    FROM (SELECT method, count(*) AS n FROM residents WHERE verified GROUP BY 1) x)
    ),
    'vouches', jsonb_build_object(
      'total', (SELECT count(*) FROM vouches),
      'residents_vouched', (SELECT count(DISTINCT resident_user_id) FROM vouches),
      'vouchers', (SELECT count(DISTINCT voucher_user_id) FROM vouches)
    ),
    'patroller_requests', jsonb_build_object(
      'in_period', (SELECT count(*) FROM requests WHERE at >= b.from_ts AND at < b.to_ts),
      'by_status', (SELECT coalesce(jsonb_agg(jsonb_build_object('status', status, 'requests', n) ORDER BY n DESC, status), '[]'::jsonb)
                    FROM (SELECT status, count(*) AS n FROM requests WHERE at >= b.from_ts AND at < b.to_ts GROUP BY 1) x),
      'pending_now', (SELECT count(*) FROM requests WHERE status = 'pending'),
      'review_median_seconds', (
        SELECT public.analytics_secs(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (reviewed_at - at))))
        FROM requests WHERE reviewed_at IS NOT NULL AND reviewed_at >= at AND at >= b.from_ts AND at < b.to_ts
      )
    ),
    'deletions', jsonb_build_object(
      'total', (SELECT count(*) FROM deletions),
      'self', (SELECT count(*) FROM deletions WHERE action = 'account_self_deleted'),
      'by_admin', (SELECT count(*) FROM deletions WHERE action = 'user_deleted'),
      'by_role', (SELECT coalesce(jsonb_agg(jsonb_build_object('role', role, 'deletions', n) ORDER BY n DESC, role), '[]'::jsonb)
                  FROM (SELECT role, count(*) AS n FROM deletions GROUP BY 1) x)
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- 7. Community ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_community(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_city_ids uuid[] DEFAULT NULL,
  p_suburb_ids uuid[] DEFAULT NULL,
  p_org_ids uuid[] DEFAULT NULL,
  p_grain text DEFAULT 'week'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b record;
  s record;
  v_from_date date;
  v_to_date date;
  v_result jsonb;
BEGIN
  IF NOT coalesce(public.is_global_app_staff(), false) THEN
    RAISE EXCEPTION 'Only global admins and support can view analytics.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public.analytics_bounds(p_from, p_to, p_grain);
  SELECT * INTO s FROM public.analytics_scope(p_city_ids, p_suburb_ids, p_org_ids);
  v_from_date := (b.from_ts AT TIME ZONE 'Africa/Johannesburg')::date;
  v_to_date := ((b.to_ts - interval '1 microsecond') AT TIME ZONE 'Africa/Johannesburg')::date;

  WITH bk AS (
    SELECT bucket FROM public.analytics_buckets(b.from_ts, b.to_ts, b.grain)
  ),
  items AS (
    SELECT w.status, w.created_at, w.acquired_at
    FROM public.equipment_wishlist_items w
    WHERE public.analytics_in_scope(w.organization_id, s.all_orgs, s.org_ids, s.include_unassigned)
  ),
  offers AS (
    SELECT f.status, f.kind, f.created_at
    FROM public.equipment_wishlist_offers f
    WHERE f.created_at >= b.from_ts AND f.created_at < b.to_ts
      AND public.analytics_in_scope(f.organization_id, s.all_orgs, s.org_ids, s.include_unassigned)
  ),
  ledger_all AS (
    SELECT e.id, e.kind, e.amount_cents, e.entry_date, e.corrects_entry_id, e.organization_id
    FROM public.wishlist_ledger_entries e
    WHERE public.analytics_in_scope(e.organization_id, s.all_orgs, s.org_ids, s.include_unassigned)
  ),
  ledger AS (
    -- A correction reverses part of the entry it points at, so it counts against that entry's kind.
    SELECT coalesce(orig.kind, l.kind) AS kind,
           CASE WHEN l.kind = 'correction' THEN -l.amount_cents ELSE l.amount_cents END AS cents,
           l.entry_date
    FROM ledger_all l
    LEFT JOIN public.wishlist_ledger_entries orig ON l.kind = 'correction' AND orig.id = l.corrects_entry_id
    WHERE l.entry_date >= v_from_date AND l.entry_date <= v_to_date
  ),
  posts AS (
    SELECT p.type, p.status, p.hidden_at
    FROM public.city_hub_posts p
    WHERE p.created_at >= b.from_ts AND p.created_at < b.to_ts
      AND public.analytics_in_scope(p.author_organization_id, s.all_orgs, s.org_ids, s.include_unassigned)
  ),
  chat AS (
    SELECT date_trunc(b.grain, m.created_at AT TIME ZONE 'Africa/Johannesburg') AS bucket,
           (m.created_at AT TIME ZONE 'Africa/Johannesburg')::date AS d
    FROM public.chat_messages m
    WHERE m.created_at >= b.from_ts AND m.created_at < b.to_ts AND m.deleted_at IS NULL
      AND public.analytics_in_scope(m.organization_id, s.all_orgs, s.org_ids, s.include_unassigned)
  ),
  casts AS (
    SELECT a.hidden_at, a.created_at
    FROM public.area_broadcasts a
    WHERE a.created_at >= b.from_ts AND a.created_at < b.to_ts
      AND public.analytics_in_scope(a.organization_id, s.all_orgs, s.org_ids, s.include_unassigned)
  ),
  reports_all AS (
    SELECT r.status, r.reason, r.content_type, r.created_at, r.handled_at
    FROM public.community_content_reports r
    WHERE public.analytics_in_scope(r.organization_id, s.all_orgs, s.org_ids, s.include_unassigned)
  ),
  reports AS (
    SELECT * FROM reports_all WHERE created_at >= b.from_ts AND created_at < b.to_ts
  ),
  fb_all AS (
    SELECT f.created_at, f.reviewed_at
    FROM public.feedback f
    WHERE public.analytics_in_scope(f.organization_id, s.all_orgs, s.org_ids, s.include_unassigned)
  )
  SELECT jsonb_build_object(
    'needs', jsonb_build_object(
      'items_created', (SELECT count(*) FROM items WHERE created_at >= b.from_ts AND created_at < b.to_ts),
      'items_acquired', (SELECT count(*) FROM items WHERE acquired_at >= b.from_ts AND acquired_at < b.to_ts),
      'items_open', (SELECT count(*) FROM items WHERE status = 'needed'),
      'offers', (SELECT count(*) FROM offers),
      'offers_converted', (SELECT count(*) FROM offers WHERE status IN ('accepted', 'fulfilled')),
      'conversion_rate', (
        SELECT CASE WHEN count(*) FILTER (WHERE status <> 'withdrawn') = 0 THEN NULL
          ELSE round(100.0 * count(*) FILTER (WHERE status IN ('accepted', 'fulfilled'))
                     / count(*) FILTER (WHERE status <> 'withdrawn'), 1) END
        FROM offers
      ),
      'offers_by_status', (SELECT coalesce(jsonb_agg(jsonb_build_object('status', status, 'offers', n) ORDER BY n DESC, status), '[]'::jsonb)
                           FROM (SELECT status, count(*) AS n FROM offers GROUP BY 1) x),
      'offers_by_kind', (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'offers', n) ORDER BY n DESC, kind), '[]'::jsonb)
                         FROM (SELECT kind, count(*) AS n FROM offers GROUP BY 1) x)
    ),
    'ledger', jsonb_build_object(
      'raised_cents', (SELECT coalesce(sum(cents), 0) FROM ledger WHERE kind = 'contribution_received'),
      'spent_cents', (SELECT coalesce(sum(cents), 0) FROM ledger WHERE kind = 'purchase'),
      'entries', (SELECT count(*) FROM ledger)
    ),
    'series', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'bucket', to_char(bk.bucket, 'YYYY-MM-DD'),
        'offers', (SELECT count(*) FROM offers o WHERE date_trunc(b.grain, o.created_at AT TIME ZONE 'Africa/Johannesburg') = bk.bucket),
        'offers_converted', (SELECT count(*) FROM offers o WHERE o.status IN ('accepted', 'fulfilled')
                               AND date_trunc(b.grain, o.created_at AT TIME ZONE 'Africa/Johannesburg') = bk.bucket),
        'raised_rand', (SELECT round(coalesce(sum(cents), 0) / 100.0, 2) FROM ledger l
                        WHERE l.kind = 'contribution_received' AND date_trunc(b.grain, l.entry_date::timestamp) = bk.bucket),
        'spent_rand', (SELECT round(coalesce(sum(cents), 0) / 100.0, 2) FROM ledger l
                       WHERE l.kind = 'purchase' AND date_trunc(b.grain, l.entry_date::timestamp) = bk.bucket),
        'chat_messages', (SELECT count(*) FROM chat c WHERE c.bucket = bk.bucket)
      ) ORDER BY bk.bucket), '[]'::jsonb)
      FROM bk
    ),
    'hub_posts', jsonb_build_object(
      'total', (SELECT count(*) FROM posts WHERE status <> 'draft'),
      'hidden', (SELECT count(*) FROM posts WHERE hidden_at IS NOT NULL),
      'by_type', (SELECT coalesce(jsonb_agg(jsonb_build_object('type', type, 'posts', n) ORDER BY n DESC, type), '[]'::jsonb)
                  FROM (SELECT type, count(*) AS n FROM posts WHERE status <> 'draft' GROUP BY 1) x)
    ),
    'chat', jsonb_build_object(
      'messages', (SELECT count(*) FROM chat),
      'active_days', (SELECT count(DISTINCT d) FROM chat),
      'per_active_day', (SELECT CASE WHEN count(DISTINCT d) = 0 THEN NULL ELSE round(count(*)::numeric / count(DISTINCT d), 1) END FROM chat)
    ),
    'broadcasts', jsonb_build_object(
      'total', (SELECT count(*) FROM casts),
      'hidden', (SELECT count(*) FROM casts WHERE hidden_at IS NOT NULL)
    ),
    'reports', jsonb_build_object(
      'total', (SELECT count(*) FROM reports),
      'open_now', (SELECT count(*) FROM reports_all WHERE status = 'open'),
      'by_status', (SELECT coalesce(jsonb_agg(jsonb_build_object('status', status, 'reports', n) ORDER BY n DESC, status), '[]'::jsonb)
                    FROM (SELECT status, count(*) AS n FROM reports GROUP BY 1) x),
      'by_reason', (SELECT coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'reports', n) ORDER BY n DESC, reason), '[]'::jsonb)
                    FROM (SELECT reason, count(*) AS n FROM reports GROUP BY 1) x),
      'by_content', (SELECT coalesce(jsonb_agg(jsonb_build_object('content_type', content_type, 'reports', n) ORDER BY n DESC, content_type), '[]'::jsonb)
                     FROM (SELECT content_type, count(*) AS n FROM reports GROUP BY 1) x),
      'handle_median_seconds', (
        SELECT public.analytics_secs(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (handled_at - created_at))))
        FROM reports WHERE handled_at IS NOT NULL AND handled_at >= created_at
      )
    ),
    'feedback', jsonb_build_object(
      'total', (SELECT count(*) FROM fb_all WHERE created_at >= b.from_ts AND created_at < b.to_ts),
      'reviewed', (SELECT count(*) FROM fb_all WHERE created_at >= b.from_ts AND created_at < b.to_ts AND reviewed_at IS NOT NULL),
      'unreviewed_now', (SELECT count(*) FROM fb_all WHERE reviewed_at IS NULL)
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- 8. Grants -------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.analytics_haversine_km(double precision, double precision, double precision, double precision) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_geojson_km(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_line_km(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_uuid_or_null(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_gps_km(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_patrol_distances(timestamptz, timestamptz, boolean, uuid[], boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_buckets(timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_short_name(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_secs(double precision) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.analytics_patrols(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.analytics_patrol_coverage(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.analytics_safety(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.analytics_people(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.analytics_community(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_patrols(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_patrol_coverage(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_safety(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_people(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_community(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) TO authenticated;

COMMENT ON FUNCTION public.analytics_patrols(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) IS
  'Analytics: patrol timing heat grid, suburb coverage, top patrollers (short names), streaks, camera checks, distance sources. Global staff only; aggregates only.';
COMMENT ON FUNCTION public.analytics_patrol_coverage(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) IS
  'Analytics: patrol coverage as ~550 m cells (>= 3 patrols by >= 2 volunteers, first/last 5 minutes trimmed). Global staff only; never raw points.';
COMMENT ON FUNCTION public.analytics_safety(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) IS
  'Analytics: incidents by type and area, moderation turnaround, suspect profile mix, match queue backlog. Global staff only; aggregates only.';
COMMENT ON FUNCTION public.analytics_people(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) IS
  'Analytics: sign-ups per watch, resident verification, vouches, patroller requests, deletions. Global staff only; aggregates only.';
COMMENT ON FUNCTION public.analytics_community(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) IS
  'Analytics: Needs offers and ledger totals, City Hub posts, chat counts, broadcasts, reports, feedback. Global staff only; aggregates only.';

-- 9. Verification -------------------------------------------------------------------------
DO $verify$
DECLARE
  problems text := '';
  fn text;
  ix text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.analytics_patrols(timestamptz,timestamptz,uuid[],uuid[],uuid[],text)',
    'public.analytics_patrol_coverage(timestamptz,timestamptz,uuid[],uuid[],uuid[],text)',
    'public.analytics_safety(timestamptz,timestamptz,uuid[],uuid[],uuid[],text)',
    'public.analytics_people(timestamptz,timestamptz,uuid[],uuid[],uuid[],text)',
    'public.analytics_community(timestamptz,timestamptz,uuid[],uuid[],uuid[],text)'
  ] LOOP
    IF to_regprocedure(fn) IS NULL THEN
      problems := problems || fn || ' missing; ';
    ELSIF has_function_privilege('anon', fn, 'EXECUTE') THEN
      problems := problems || 'anon can execute ' || fn || '; ';
    ELSIF NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      problems := problems || 'authenticated cannot execute ' || fn || '; ';
    END IF;
  END LOOP;

  FOREACH fn IN ARRAY ARRAY[
    'public.analytics_patrol_distances(timestamptz,timestamptz,boolean,uuid[],boolean)',
    'public.analytics_gps_km(uuid,timestamptz,timestamptz)',
    'public.analytics_geojson_km(text)'
  ] LOOP
    IF to_regprocedure(fn) IS NULL THEN
      problems := problems || fn || ' missing; ';
    ELSIF has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      problems := problems || 'private helper ' || fn || ' is callable by members; ';
    END IF;
  END LOOP;

  IF position('analytics_patrol_distances' IN pg_get_functiondef('public.analytics_period_kpis(timestamptz,timestamptz,boolean,uuid[],boolean)'::regprocedure)) = 0
     OR position('analytics_patrol_distances' IN pg_get_functiondef('public.analytics_series(timestamptz,timestamptz,text,boolean,uuid[],boolean)'::regprocedure)) = 0
     OR position('analytics_patrol_distances' IN pg_get_functiondef('public.analytics_watch_table(timestamptz,timestamptz,uuid[],uuid[],uuid[],text)'::regprocedure)) = 0 THEN
    problems := problems || 'distance fix not in place; ';
  END IF;

  FOREACH ix IN ARRAY ARRAY[
    'patrol_locations_user_timestamp_idx', 'patrol_locations_archive_user_timestamp_idx',
    'patrol_routes_created_at_idx', 'patrol_logs_start_time_idx'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = ix) THEN
      problems := problems || 'index ' || ix || ' missing; ';
    END IF;
  END LOOP;

  IF problems <> '' THEN
    RAISE EXCEPTION 'Analytics phase 3: FAILED - %', problems;
  END IF;

  RAISE NOTICE 'Analytics phase 3: OK';
END
$verify$;
