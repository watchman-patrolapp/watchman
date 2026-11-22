-- Analytics foundation (phase 1 of the platform analytics dashboard).
--
-- Adds, for global admins and technical support only (public.is_global_app_staff()):
--   public.analytics_overview(...)     KPIs for a period, the previous period and time buckets
--   public.analytics_watch_table(...)  one aggregated row per neighbourhood watch
-- and, for every signed-in member:
--   public.report_app_version(...)     the app records its own installed version
--   public.user_app_versions           one row per member and platform (own row readable)
--
-- Output is aggregates only: no names of people, emails, phones, coordinates or message text.
-- Watch names, city and suburb names are returned because they are organisations and places.
-- Times are bucketed in Africa/Johannesburg. Ranges are capped at 24 months.
-- Patrol rows with no organization_id belong to the original (legacy) watch, matching
-- leaderboard_patrol_stats.
--
-- Additive and idempotent: safe to run more than once. Nothing is dropped or rewritten.

-- 0. Pre-check: stop with a clear message (before changing anything) if a column this
--    migration relies on is missing from the live schema.
DO $precheck$
DECLARE
  missing text := '';
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('users','id'),('users','role'),('users','created_at'),('users','terms_version'),
      ('organizations','id'),('organizations','name'),('organizations','type'),('organizations','status'),
      ('organizations','city_id'),('organizations','primary_suburb_id'),
      ('organization_members','organization_id'),('organization_members','user_id'),
      ('organization_members','member_role'),('organization_members','status'),
      ('organization_suburbs','organization_id'),('organization_suburbs','suburb_id'),('organization_suburbs','active'),
      ('suburbs','id'),('suburbs','city_id'),('suburbs','name'),('cities','id'),('cities','name'),
      ('patrol_logs','organization_id'),('patrol_logs','user_id'),('patrol_logs','start_time'),
      ('patrol_logs','end_time'),('patrol_logs','duration_minutes'),
      ('patrol_logs','start_shared_at'),('patrol_logs','end_shared_at'),
      ('patrol_routes','organization_id'),('patrol_routes','created_at'),('patrol_routes','total_distance_km'),
      ('incidents','id'),('incidents','organization_id'),('incidents','status'),
      ('incidents','created_at'),('incidents','incident_date'),
      ('sos_alerts','incident_id'),('sos_alerts','organization_id'),('sos_alerts','created_at'),
      ('sos_alerts','acknowledged_at'),
      ('city_hub_posts','author_organization_id'),('city_hub_posts','created_at'),
      ('terms_acceptances','user_id'),('terms_acceptances','terms_version'),('terms_acceptances','accepted_at'),
      ('app_config','platform'),('app_config','min_supported_version_code')
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
  IF missing <> '' THEN
    RAISE EXCEPTION 'Analytics foundation: not applied, missing %', btrim(missing);
  END IF;
END
$precheck$;

-- 1. App version tracking ------------------------------------------------------------
-- A small table rather than columns on user_push_tokens: push tokens only exist when
-- notifications are allowed, and they are deleted on sign-out.
CREATE TABLE IF NOT EXISTS public.user_app_versions (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  platform text NOT NULL,
  app_version_code integer,
  app_version_name text,
  app_version_updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, platform),
  CONSTRAINT user_app_versions_platform_ok CHECK (platform IN ('android', 'ios', 'web')),
  CONSTRAINT user_app_versions_code_ok CHECK (app_version_code IS NULL OR app_version_code > 0),
  CONSTRAINT user_app_versions_name_len CHECK (app_version_name IS NULL OR char_length(app_version_name) <= 40)
);

CREATE INDEX IF NOT EXISTS user_app_versions_platform_updated_idx
  ON public.user_app_versions (platform, app_version_updated_at DESC);

ALTER TABLE public.user_app_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_app_versions_select_own ON public.user_app_versions;
CREATE POLICY user_app_versions_select_own ON public.user_app_versions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
-- No insert/update/delete policies: writes go through report_app_version only.

REVOKE ALL ON public.user_app_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_app_versions TO authenticated;
GRANT ALL ON public.user_app_versions TO service_role;

CREATE OR REPLACE FUNCTION public.report_app_version(
  p_code integer,
  p_name text DEFAULT NULL,
  p_platform text DEFAULT 'android'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_platform text := lower(btrim(coalesce(p_platform, '')));
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in again.' USING ERRCODE = '28000';
  END IF;
  IF v_platform NOT IN ('android', 'ios', 'web') THEN
    RAISE EXCEPTION 'Unknown app platform.' USING ERRCODE = '22023';
  END IF;
  IF p_code IS NULL OR p_code < 1 OR p_code > 2100000000 THEN
    RAISE EXCEPTION 'Unknown app version.' USING ERRCODE = '22023';
  END IF;
  IF v_name IS NOT NULL AND (char_length(v_name) > 40 OR v_name !~ '^[0-9A-Za-z._+ -]+$') THEN
    v_name := NULL;
  END IF;

  INSERT INTO public.user_app_versions AS v (user_id, platform, app_version_code, app_version_name, app_version_updated_at)
  VALUES (v_uid, v_platform, p_code, v_name, now())
  ON CONFLICT (user_id, platform) DO UPDATE
    SET app_version_code = EXCLUDED.app_version_code,
        app_version_name = EXCLUDED.app_version_name,
        app_version_updated_at = now()
    -- Skip the write when nothing changed and the row was refreshed in the last 6 hours.
    WHERE v.app_version_code IS DISTINCT FROM EXCLUDED.app_version_code
       OR v.app_version_name IS DISTINCT FROM EXCLUDED.app_version_name
       OR v.app_version_updated_at < now() - interval '6 hours';
END;
$$;

COMMENT ON FUNCTION public.report_app_version(integer, text, text) IS
  'The signed-in member records the app version installed on this platform. Touches only their own row.';

REVOKE ALL ON FUNCTION public.report_app_version(integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_app_version(integer, text, text) TO authenticated, service_role;

-- 2. Indexes for analytics ranges ---------------------------------------------------
CREATE INDEX IF NOT EXISTS incidents_org_incident_date_idx ON public.incidents (organization_id, incident_date);
CREATE INDEX IF NOT EXISTS incidents_org_created_at_idx ON public.incidents (organization_id, created_at);
CREATE INDEX IF NOT EXISTS patrol_routes_org_created_at_idx ON public.patrol_routes (organization_id, created_at);
CREATE INDEX IF NOT EXISTS sos_alerts_org_created_at_idx ON public.sos_alerts (organization_id, created_at);
CREATE INDEX IF NOT EXISTS users_created_at_idx ON public.users (created_at);
-- city_hub_posts has author_organization_id (there is no organization_id column).
CREATE INDEX IF NOT EXISTS city_hub_posts_author_org_created_at_idx ON public.city_hub_posts (author_organization_id, created_at);

-- 3. Private helpers (not callable by clients) --------------------------------------
-- Validated window: defaults to the last 30 days, at most 24 months, grain day/week/month.
CREATE OR REPLACE FUNCTION public.analytics_bounds(
  p_from timestamptz,
  p_to timestamptz,
  p_grain text,
  OUT from_ts timestamptz,
  OUT to_ts timestamptz,
  OUT prev_from_ts timestamptz,
  OUT grain text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  grain := lower(btrim(coalesce(p_grain, 'week')));
  IF grain NOT IN ('day', 'week', 'month') THEN
    RAISE EXCEPTION 'Choose day, week or month for the chart grouping.' USING ERRCODE = '22023';
  END IF;
  to_ts := coalesce(p_to, now());
  from_ts := coalesce(p_from, to_ts - interval '30 days');
  IF from_ts >= to_ts THEN
    RAISE EXCEPTION 'The start date must be before the end date.' USING ERRCODE = '22023';
  END IF;
  IF to_ts - from_ts > interval '24 months 1 day' THEN
    RAISE EXCEPTION 'Pick a date range of 24 months or less.' USING ERRCODE = '22023';
  END IF;
  prev_from_ts := from_ts - (to_ts - from_ts);
END;
$$;

-- The original watch: owns patrol and incident rows that predate organization_id.
CREATE OR REPLACE FUNCTION public.analytics_legacy_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id
  FROM public.organizations o
  WHERE o.name ILIKE '%theescombe%' AND o.type = 'nw_group'
  ORDER BY o.created_at
  LIMIT 1;
$$;

-- Which watches the filters select. Empty filters mean the whole platform (all_orgs).
-- City and suburb match through organizations.city_id / primary_suburb_id and the
-- active organization_suburbs -> suburbs -> cities links.
CREATE OR REPLACE FUNCTION public.analytics_scope(
  p_city_ids uuid[],
  p_suburb_ids uuid[],
  p_org_ids uuid[],
  OUT all_orgs boolean,
  OUT org_ids uuid[],
  OUT include_unassigned boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_city uuid[] := nullif(p_city_ids, '{}');
  v_suburb uuid[] := nullif(p_suburb_ids, '{}');
  v_org uuid[] := nullif(p_org_ids, '{}');
  v_legacy uuid := public.analytics_legacy_org_id();
BEGIN
  all_orgs := v_city IS NULL AND v_suburb IS NULL AND v_org IS NULL;
  IF all_orgs THEN
    SELECT coalesce(array_agg(o.id), '{}') INTO org_ids
    FROM public.organizations o WHERE o.type = 'nw_group';
    include_unassigned := true;
    RETURN;
  END IF;

  SELECT coalesce(array_agg(o.id), '{}') INTO org_ids
  FROM public.organizations o
  WHERE o.type = 'nw_group'
    AND (v_org IS NULL OR o.id = ANY (v_org))
    AND (
      v_city IS NULL
      OR o.city_id = ANY (v_city)
      OR EXISTS (SELECT 1 FROM public.suburbs s WHERE s.id = o.primary_suburb_id AND s.city_id = ANY (v_city))
      OR EXISTS (
        SELECT 1 FROM public.organization_suburbs os
        JOIN public.suburbs s ON s.id = os.suburb_id
        WHERE os.organization_id = o.id AND os.active AND s.city_id = ANY (v_city)
      )
    )
    AND (
      v_suburb IS NULL
      OR o.primary_suburb_id = ANY (v_suburb)
      OR EXISTS (
        SELECT 1 FROM public.organization_suburbs os
        WHERE os.organization_id = o.id AND os.active AND os.suburb_id = ANY (v_suburb)
      )
    );
  include_unassigned := v_legacy IS NOT NULL AND v_legacy = ANY (org_ids);
END;
$$;

-- Does a row's organization fall inside the scope?
CREATE OR REPLACE FUNCTION public.analytics_in_scope(
  p_org uuid, p_all boolean, p_orgs uuid[], p_unassigned boolean
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_org IS NULL THEN coalesce(p_unassigned, false)
    ELSE coalesce(p_all, false) OR p_org = ANY (coalesce(p_orgs, '{}'))
  END;
$$;

-- Minutes for one patrol log (stored duration, else end - start).
CREATE OR REPLACE FUNCTION public.analytics_patrol_minutes(
  p_duration numeric, p_start timestamptz, p_end timestamptz
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_duration IS NOT NULL AND p_duration > 0 THEN p_duration
    WHEN p_start IS NOT NULL AND p_end IS NOT NULL AND p_end > p_start
      THEN extract(epoch FROM (p_end - p_start)) / 60.0
    ELSE 0
  END;
$$;

-- Members in scope: active members of the selected watches, or every user platform-wide.
CREATE OR REPLACE FUNCTION public.analytics_user_in_scope(
  p_user uuid, p_all boolean, p_orgs uuid[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(p_all, false) OR EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = p_user AND m.status = 'active' AND m.organization_id = ANY (coalesce(p_orgs, '{}'))
  );
$$;

-- KPIs for one period.
CREATE OR REPLACE FUNCTION public.analytics_period_kpis(
  p_from timestamptz, p_to timestamptz, p_all boolean, p_orgs uuid[], p_unassigned boolean
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pl AS (
    SELECT l.organization_id, l.user_id::text AS uid, l.start_shared_at, l.end_shared_at,
           public.analytics_patrol_minutes(l.duration_minutes::numeric, l.start_time, l.end_time) AS minutes
    FROM public.patrol_logs l
    WHERE l.start_time >= p_from AND l.start_time < p_to
      AND public.analytics_in_scope(l.organization_id, p_all, p_orgs, p_unassigned)
  ),
  inc AS (
    SELECT i.status
    FROM public.incidents i
    WHERE i.created_at >= p_from AND i.created_at < p_to
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
    'distance_km', (
      SELECT round(coalesce(sum(r.total_distance_km), 0)::numeric, 1)
      FROM public.patrol_routes r
      WHERE r.created_at >= p_from AND r.created_at < p_to
        AND public.analytics_in_scope(r.organization_id, p_all, p_orgs, p_unassigned)
    ),
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

-- Time buckets (Africa/Johannesburg) for the sparklines and charts.
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
    SELECT date_trunc(p_grain, r.created_at AT TIME ZONE 'Africa/Johannesburg') AS bucket,
           sum(r.total_distance_km) AS km
    FROM public.patrol_routes r
    WHERE r.created_at >= p_from AND r.created_at < p_to
      AND public.analytics_in_scope(r.organization_id, p_all, p_orgs, p_unassigned)
    GROUP BY 1
  ),
  inc AS (
    SELECT date_trunc(p_grain, i.created_at AT TIME ZONE 'Africa/Johannesburg') AS bucket, count(*) AS n
    FROM public.incidents i
    WHERE i.created_at >= p_from AND i.created_at < p_to
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

REVOKE ALL ON FUNCTION public.analytics_bounds(timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_legacy_org_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_scope(uuid[], uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_in_scope(uuid, boolean, uuid[], boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_patrol_minutes(numeric, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_user_in_scope(uuid, boolean, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_period_kpis(timestamptz, timestamptz, boolean, uuid[], boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_series(timestamptz, timestamptz, text, boolean, uuid[], boolean) FROM PUBLIC, anon, authenticated;

-- 4. Public analytics RPCs (global admin and technical support only) ----------------
CREATE OR REPLACE FUNCTION public.analytics_overview(
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
  v_latest_terms text;
BEGIN
  IF NOT coalesce(public.is_global_app_staff(), false) THEN
    RAISE EXCEPTION 'Only global admins and support can view analytics.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO b FROM public.analytics_bounds(p_from, p_to, p_grain);
  SELECT * INTO s FROM public.analytics_scope(p_city_ids, p_suburb_ids, p_org_ids);
  SELECT max(t.terms_version) INTO v_latest_terms FROM public.terms_acceptances t;

  RETURN jsonb_build_object(
    'range', jsonb_build_object(
      'from', b.from_ts, 'to', b.to_ts,
      'previous_from', b.prev_from_ts, 'previous_to', b.from_ts,
      'grain', b.grain, 'time_zone', 'Africa/Johannesburg'
    ),
    'scope', jsonb_build_object(
      'platform_wide', s.all_orgs,
      'watch_count', coalesce(array_length(s.org_ids, 1), 0)
    ),
    'current', public.analytics_period_kpis(b.from_ts, b.to_ts, s.all_orgs, s.org_ids, s.include_unassigned),
    'previous', public.analytics_period_kpis(b.prev_from_ts, b.from_ts, s.all_orgs, s.org_ids, s.include_unassigned),
    'series', public.analytics_series(b.from_ts, b.to_ts, b.grain, s.all_orgs, s.org_ids, s.include_unassigned),
    'watches', (
      SELECT jsonb_build_object(
        'total', count(*),
        'active', count(*) FILTER (WHERE o.status = 'active'),
        'pending', count(*) FILTER (WHERE o.status = 'pending'),
        'suspended', count(*) FILTER (WHERE o.status = 'suspended')
      )
      FROM public.organizations o
      WHERE o.id = ANY (s.org_ids)
    ),
    'members_by_role', (
      SELECT coalesce(jsonb_object_agg(role, n), '{}'::jsonb)
      FROM (
        SELECT coalesce(u.role::text, 'unknown') AS role, count(*) AS n
        FROM public.users u
        WHERE public.analytics_user_in_scope(u.id, s.all_orgs, s.org_ids)
        GROUP BY 1
      ) x
    ),
    'members_total', (
      SELECT count(*) FROM public.users u
      WHERE public.analytics_user_in_scope(u.id, s.all_orgs, s.org_ids)
    ),
    'terms', jsonb_build_object(
      'latest_version', v_latest_terms,
      'on_latest', (
        SELECT count(*) FROM public.users u
        WHERE v_latest_terms IS NOT NULL AND u.terms_version = v_latest_terms
          AND public.analytics_user_in_scope(u.id, s.all_orgs, s.org_ids)
      )
    ),
    'app_versions', jsonb_build_object(
      'platform', 'android',
      'seen_since', b.to_ts - interval '90 days',
      'min_supported_version_code', (
        SELECT c.min_supported_version_code FROM public.app_config c WHERE c.platform = 'android'
      ),
      'devices', (
        SELECT count(*) FROM public.user_app_versions v
        WHERE v.platform = 'android'
          AND v.app_version_updated_at >= b.to_ts - interval '90 days'
          AND public.analytics_user_in_scope(v.user_id, s.all_orgs, s.org_ids)
      ),
      'versions', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'devices', n)
                                  ORDER BY code DESC NULLS LAST), '[]'::jsonb)
        FROM (
          SELECT v.app_version_code AS code, max(v.app_version_name) AS name, count(*) AS n
          FROM public.user_app_versions v
          WHERE v.platform = 'android'
            AND v.app_version_updated_at >= b.to_ts - interval '90 days'
            AND public.analytics_user_in_scope(v.user_id, s.all_orgs, s.org_ids)
          GROUP BY v.app_version_code
        ) x
      )
    )
  );
END;
$$;

COMMENT ON FUNCTION public.analytics_overview(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) IS
  'Platform analytics KPIs (current and previous period, time buckets). Global admin and technical support only. Aggregates only.';

REVOKE ALL ON FUNCTION public.analytics_overview(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_overview(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) TO authenticated;

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
    SELECT coalesce(r.organization_id, v_legacy) AS org, sum(r.total_distance_km) AS km
    FROM public.patrol_routes r
    WHERE r.created_at >= b.from_ts AND r.created_at < b.to_ts
    GROUP BY 1
  ),
  inc AS (
    SELECT coalesce(i.organization_id, v_legacy) AS org, count(*) AS n
    FROM public.incidents i
    WHERE i.created_at >= b.from_ts AND i.created_at < b.to_ts
      AND NOT EXISTS (SELECT 1 FROM public.sos_alerts sa WHERE sa.incident_id = i.id)
    GROUP BY 1
  ),
  last_inc AS (
    SELECT coalesce(i.organization_id, v_legacy) AS org, max(i.created_at) AS at
    FROM public.incidents i
    WHERE i.created_at < b.to_ts
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

COMMENT ON FUNCTION public.analytics_watch_table(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) IS
  'One aggregated row per neighbourhood watch for the analytics dashboard. Global admin and technical support only.';

REVOKE ALL ON FUNCTION public.analytics_watch_table(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_watch_table(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) TO authenticated;

-- 5. Verification ---------------------------------------------------------------------
DO $verify$
DECLARE
  problems text := '';
  fn text;
  ix text;
  col text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.analytics_overview(timestamptz,timestamptz,uuid[],uuid[],uuid[],text)',
    'public.analytics_watch_table(timestamptz,timestamptz,uuid[],uuid[],uuid[],text)',
    'public.report_app_version(integer,text,text)',
    'public.analytics_bounds(timestamptz,timestamptz,text)',
    'public.analytics_scope(uuid[],uuid[],uuid[])',
    'public.analytics_period_kpis(timestamptz,timestamptz,boolean,uuid[],boolean)',
    'public.analytics_series(timestamptz,timestamptz,text,boolean,uuid[],boolean)'
  ] LOOP
    IF to_regprocedure(fn) IS NULL THEN
      problems := problems || fn || ' missing; ';
    END IF;
  END LOOP;

  FOREACH col IN ARRAY ARRAY['user_id', 'platform', 'app_version_code', 'app_version_name', 'app_version_updated_at'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'user_app_versions' AND column_name = col) THEN
      problems := problems || 'user_app_versions.' || col || ' missing; ';
    END IF;
  END LOOP;

  FOREACH ix IN ARRAY ARRAY[
    'incidents_org_incident_date_idx', 'incidents_org_created_at_idx', 'patrol_routes_org_created_at_idx',
    'sos_alerts_org_created_at_idx', 'users_created_at_idx', 'city_hub_posts_author_org_created_at_idx'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = ix) THEN
      problems := problems || 'index ' || ix || ' missing; ';
    END IF;
  END LOOP;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_app_versions'::regclass) THEN
    problems := problems || 'user_app_versions RLS off; ';
  END IF;

  IF has_function_privilege('anon', 'public.analytics_overview(timestamptz,timestamptz,uuid[],uuid[],uuid[],text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.analytics_watch_table(timestamptz,timestamptz,uuid[],uuid[],uuid[],text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.report_app_version(integer,text,text)', 'EXECUTE') THEN
    problems := problems || 'anon can execute an analytics function; ';
  END IF;

  IF has_function_privilege('authenticated', 'public.analytics_period_kpis(timestamptz,timestamptz,boolean,uuid[],boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.analytics_scope(uuid[],uuid[],uuid[])', 'EXECUTE') THEN
    problems := problems || 'a private analytics helper is callable by members; ';
  END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'Analytics foundation: FAILED - %', problems;
  END IF;

  RAISE NOTICE 'Analytics foundation: OK';
END
$verify$;
