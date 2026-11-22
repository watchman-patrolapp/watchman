-- Analytics names: Top patrollers show each patroller's full name and surname.
-- Additive and idempotent: one new private helper plus CREATE OR REPLACE of analytics_patrols()
-- (everything else in that function is unchanged from 20261122030000_analytics_phase3.sql).
--
-- Before: "Sven L." (first name + initial), or the raw patrol name (e.g. "JJBOTHA") when the
-- profile name was empty. Now, per account (accounts are never merged, so a person with a
-- patroller and an admin account appears once per account):
--   1. name + surname from the profile: users.full_name (what the Profile page saves), else
--      users.first_name + last_name if those columns exist, else the sign-up metadata
--      (auth.users.raw_user_meta_data full_name, or first_name + last_name)
--   2. if no two-part name is set anywhere: the single profile/sign-up name
--   3. then a display name (users.display_name, metadata display_name / name, the name on the patrol)
--   4. then a username (users.username, metadata username / user_name / preferred_username)
--   5. else "Volunteer". Email addresses are never shown.
-- Whitespace is trimmed and runs of spaces collapsed; capitalisation is left exactly as typed.
-- Only global admins and support can call analytics_patrols(), so full names are acceptable here.
--
-- Requires: 20261122030000_analytics_phase3.sql.

-- 0. Pre-check: list everything missing at once ------------------------------------------
DO $precheck$
DECLARE
  missing text := '';
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public','users','id'),('public','users','full_name'),
      ('auth','users','id'),('auth','users','raw_user_meta_data'),
      ('public','patrol_logs','user_id'),('public','patrol_logs','user_name')
    ) AS t(sch, tbl, col)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = r.sch AND c.table_name = r.tbl AND c.column_name = r.col
    ) THEN
      missing := missing || r.sch || '.' || r.tbl || '.' || r.col || ' ';
    END IF;
  END LOOP;
  IF to_regprocedure('public.analytics_patrols(timestamptz,timestamptz,uuid[],uuid[],uuid[],text)') IS NULL
     OR to_regprocedure('public.analytics_uuid_or_null(text)') IS NULL THEN
    missing := missing || 'analytics phase 3 (run 20261122030000_analytics_phase3.sql first) ';
  END IF;
  IF missing <> '' THEN
    RAISE EXCEPTION 'Analytics names: not applied, missing %', btrim(missing);
  END IF;
END
$precheck$;

-- 1. Private helper: one display name per account ------------------------------------------
-- p_user = to_jsonb(public.users row) so optional columns (first_name, last_name, display_name,
-- username) are used when they exist and ignored when they don't.
CREATE OR REPLACE FUNCTION public.analytics_person_name(p_user jsonb, p_meta jsonb, p_patrol_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH raw(ord, val) AS (
    VALUES
      (1, p_user->>'full_name'),
      (2, concat_ws(' ', p_user->>'first_name', p_user->>'last_name')),
      (3, p_meta->>'full_name'),
      (4, concat_ws(' ', p_meta->>'first_name', p_meta->>'last_name')),
      (5, p_user->>'display_name'),
      (6, p_meta->>'display_name'),
      (7, p_meta->>'name'),
      (8, p_patrol_name),
      (9, p_user->>'username'),
      (10, p_meta->>'username'),
      (11, p_meta->>'user_name'),
      (12, p_meta->>'preferred_username')
  ),
  c AS (
    SELECT ord, nullif(regexp_replace(regexp_replace(coalesce(val, ''), '\s+', ' ', 'g'), '^ | $', '', 'g'), '') AS name
    FROM raw
  ),
  ok AS (
    SELECT ord, name FROM c WHERE name IS NOT NULL AND position('@' IN name) = 0
  )
  SELECT coalesce(
    (SELECT name FROM ok WHERE ord <= 4 AND position(' ' IN name) > 0 ORDER BY ord LIMIT 1),
    (SELECT name FROM ok ORDER BY ord LIMIT 1),
    'Volunteer'
  );
$$;

REVOKE ALL ON FUNCTION public.analytics_person_name(jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.analytics_person_name(jsonb, jsonb, text) IS
  'Analytics (private): full name and surname for one account from the profile, else sign-up metadata, display name, username; never an email.';

-- 2. analytics_patrols(): top patrollers use the full name --------------------------------
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
    SELECT v.*, st.longest,
           public.analytics_person_name(to_jsonb(u), au.raw_user_meta_data, v.user_name) AS person_name
    FROM vols v
    LEFT JOIN streaks st ON st.uid_text = v.uid_text
    LEFT JOIN public.users u ON u.id = v.uid
    LEFT JOIN auth.users au ON au.id = v.uid
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
               'name', t.person_name,
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

REVOKE ALL ON FUNCTION public.analytics_patrols(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_patrols(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) TO authenticated;
COMMENT ON FUNCTION public.analytics_patrols(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) IS
  'Analytics: patrol timing heat grid, suburb coverage, top patrollers (full profile names), streaks, camera checks, distance sources. Global staff only; aggregates only.';

-- 3. Verify -------------------------------------------------------------------------------
DO $verify$
DECLARE
  problems text := '';
  got text;
BEGIN
  IF position('analytics_person_name' IN pg_get_functiondef('public.analytics_patrols(timestamptz,timestamptz,uuid[],uuid[],uuid[],text)'::regprocedure)) = 0 THEN
    problems := problems || 'analytics_patrols does not use analytics_person_name; ';
  END IF;
  IF has_function_privilege('authenticated', 'public.analytics_person_name(jsonb,jsonb,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.analytics_person_name(jsonb,jsonb,text)', 'EXECUTE') THEN
    problems := problems || 'analytics_person_name is callable by members; ';
  END IF;
  IF has_function_privilege('anon', 'public.analytics_patrols(timestamptz,timestamptz,uuid[],uuid[],uuid[],text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.analytics_patrols(timestamptz,timestamptz,uuid[],uuid[],uuid[],text)', 'EXECUTE') THEN
    problems := problems || 'analytics_patrols privileges are wrong; ';
  END IF;
  got := public.analytics_person_name('{"full_name": "  Sven   Lxxx "}'::jsonb, NULL, 'Sven');
  IF got IS DISTINCT FROM 'Sven Lxxx' THEN problems := problems || 'full name check got ' || coalesce(got, 'null') || '; '; END IF;
  got := public.analytics_person_name('{"full_name": "JJ"}'::jsonb, '{"first_name": "JJ", "last_name": "Botha"}'::jsonb, 'JJBOTHA');
  IF got IS DISTINCT FROM 'JJ Botha' THEN problems := problems || 'sign-up name check got ' || coalesce(got, 'null') || '; '; END IF;
  got := public.analytics_person_name('{"full_name": "a@b.co"}'::jsonb, NULL, 'x@y.co');
  IF got IS DISTINCT FROM 'Volunteer' THEN problems := problems || 'email check got ' || coalesce(got, 'null') || '; '; END IF;
  IF problems <> '' THEN
    RAISE EXCEPTION 'Analytics names: verification failed: %', problems;
  END IF;
  RAISE NOTICE 'Analytics names: OK';
END
$verify$;
