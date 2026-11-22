-- Analytics phase 4: resident analytics (active members, reports by role, residents vs patrol
-- coverage per suburb, retention, local services) and security companies.
-- Additive and idempotent: one new table (user_activity_days), CREATE OR REPLACE functions,
-- no changes to existing data. Requires 20261122040000_analytics_names.sql.
--
--   public.touch_activity(p_platform)      any signed-in member marks "opened the app today"
--                                           (own row only; one row per member per day)
--   public.analytics_residents(...)        global admins and support only; aggregates only
--   public.analytics_security(...)         global admins and support only; aggregates only
--
-- Privacy: user_activity_days keeps only member id, calendar day (South African time) and the
-- platform. No times, locations, pages or devices. Rows go when the account is deleted.
-- Active-member figures only fill in from the day this is applied.

-- 0. Pre-check: list everything missing at once ------------------------------------------
DO $precheck$
DECLARE
  missing text := '';
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public','users','id'),('public','users','role'),('public','users','created_at'),
      ('public','users','home_suburb_id'),('public','users','organization_id'),
      ('auth','users','id'),('auth','users','last_sign_in_at'),
      ('public','organizations','id'),('public','organizations','name'),('public','organizations','type'),
      ('public','organizations','status'),('public','organizations','city_id'),
      ('public','organizations','primary_suburb_id'),('public','organizations','created_at'),
      ('public','organizations','settings_json'),
      ('public','organization_members','organization_id'),('public','organization_members','user_id'),
      ('public','organization_members','status'),
      ('public','organization_suburbs','organization_id'),('public','organization_suburbs','suburb_id'),
      ('public','organization_suburbs','active'),
      ('public','suburbs','id'),('public','suburbs','name'),('public','suburbs','city_id'),
      ('public','cities','id'),('public','cities','name'),
      ('public','patrol_logs','user_id'),('public','patrol_logs','organization_id'),
      ('public','patrol_logs','start_time'),('public','patrol_logs','end_time'),
      ('public','patrol_logs','duration_minutes'),('public','patrol_logs','suburb_id'),
      ('public','active_patrols','user_id'),('public','active_patrols','organization_id'),
      ('public','patrol_slots','date'),('public','patrol_slots','organization_id'),
      ('public','incidents','id'),('public','incidents','organization_id'),('public','incidents','reporter_id'),
      ('public','incidents','status'),('public','incidents','submitted_at'),('public','incidents','incident_date'),
      ('public','incidents','approved_at'),('public','incidents','suburb_id'),
      ('public','sos_alerts','incident_id'),('public','sos_alerts','resident_id'),
      ('public','sos_alerts','organization_id'),('public','sos_alerts','created_at'),
      ('public','sos_alerts','acknowledged_at'),('public','sos_alerts','acknowledged_by_user_id'),
      ('public','sos_alerts','resolved_by_organization_id'),
      ('public','user_app_versions','user_id'),('public','user_app_versions','app_version_updated_at'),
      ('public','resident_security_memberships','resident_user_id'),
      ('public','resident_security_memberships','security_company_id'),
      ('public','resident_security_memberships','membership_status'),
      ('public','resident_security_memberships','verified_at'),
      ('public','resident_security_memberships','created_at'),
      ('public','security_membership_events','event_type'),('public','security_membership_events','from_company_id'),
      ('public','security_membership_events','to_company_id'),('public','security_membership_events','created_at'),
      ('public','security_assignments','security_company_id'),('public','security_assignments','suburb_id'),
      ('public','security_assignments','assignment_type'),('public','security_assignments','active'),
      ('public','security_resident_access','security_company_id'),('public','security_resident_access','access_level'),
      ('public','security_resident_access','active'),
      ('public','local_service_listings','id'),('public','local_service_listings','organization_id'),
      ('public','local_service_listings','owner_user_id'),('public','local_service_listings','category_slug'),
      ('public','local_service_listings','status'),('public','local_service_listings','created_at'),
      ('public','local_service_listings','is_featured'),
      ('public','local_service_categories','slug'),('public','local_service_categories','label'),
      ('public','local_service_categories','parent_slug'),
      ('public','local_service_reviews','listing_id'),('public','local_service_reviews','rating'),
      ('public','local_service_reviews','status'),('public','local_service_reviews','created_at')
    ) AS t(sch, tbl, col)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = r.sch AND c.table_name = r.tbl AND c.column_name = r.col
    ) THEN
      missing := missing || CASE WHEN r.sch = 'public' THEN '' ELSE r.sch || '.' END || r.tbl || '.' || r.col || ' ';
    END IF;
  END LOOP;
  IF to_regprocedure('public.is_global_app_staff()') IS NULL THEN
    missing := missing || 'function is_global_app_staff() ';
  END IF;
  IF to_regprocedure('public.analytics_scope(uuid[],uuid[],uuid[])') IS NULL
     OR to_regprocedure('public.analytics_buckets(timestamptz,timestamptz,text)') IS NULL THEN
    missing := missing || 'analytics foundation and phase 3 ';
  END IF;
  IF to_regprocedure('public.analytics_person_name(jsonb,jsonb,text)') IS NULL THEN
    missing := missing || 'analytics names (run 20261122040000_analytics_names.sql first) ';
  END IF;
  IF missing <> '' THEN
    RAISE EXCEPTION 'Analytics phase 4: not applied, missing %', btrim(missing);
  END IF;
END
$precheck$;

-- 1. Daily activity record ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_activity_days (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  day date NOT NULL,
  platform text NOT NULL DEFAULT 'web',
  PRIMARY KEY (user_id, day),
  CONSTRAINT user_activity_days_platform_ok CHECK (platform IN ('android', 'ios', 'web'))
);

CREATE INDEX IF NOT EXISTS user_activity_days_day_idx ON public.user_activity_days (day);

COMMENT ON TABLE public.user_activity_days IS
  'One row per member per day they opened the app (South African date). Only id, day and platform; feeds active-member and retention analytics.';

ALTER TABLE public.user_activity_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_activity_days_select_own ON public.user_activity_days;
CREATE POLICY user_activity_days_select_own ON public.user_activity_days
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
-- No insert/update/delete policies: writes go through touch_activity() only.

REVOKE ALL ON public.user_activity_days FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_activity_days TO authenticated;
GRANT ALL ON public.user_activity_days TO service_role;

CREATE OR REPLACE FUNCTION public.touch_activity(p_platform text DEFAULT 'web')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_platform text := lower(btrim(coalesce(p_platform, '')));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in again.' USING ERRCODE = '28000';
  END IF;
  IF v_platform NOT IN ('android', 'ios', 'web') THEN
    v_platform := 'web';
  END IF;
  INSERT INTO public.user_activity_days (user_id, day, platform)
  VALUES (v_uid, (now() AT TIME ZONE 'Africa/Johannesburg')::date, v_platform)
  ON CONFLICT (user_id, day) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.touch_activity(text) IS
  'The signed-in member marks that they opened the app today. Touches only their own row; at most one row per day.';

REVOKE ALL ON FUNCTION public.touch_activity(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_activity(text) TO authenticated, service_role;

-- 2. Private helpers ----------------------------------------------------------------------
-- Role groups for reporting. 'user' is the legacy name for a resident.
CREATE OR REPLACE FUNCTION public.analytics_role_group(p_role text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(btrim(coalesce(p_role, '')))
    WHEN 'resident' THEN 'resident'
    WHEN 'user' THEN 'resident'
    WHEN 'patroller' THEN 'patroller'
    WHEN 'nw_admin' THEN 'watch_admin'
    WHEN 'committee' THEN 'watch_admin'
    WHEN 'security_admin' THEN 'security'
    WHEN 'admin' THEN 'staff'
    WHEN 'technical_support' THEN 'staff'
    WHEN '' THEN 'unknown'
    ELSE 'other'
  END;
$$;

-- Which watches a security company covers: its active suburb assignments, plus every
-- registered watch in its city (what the partner command dashboard shows).
CREATE OR REPLACE FUNCTION public.analytics_security_coverage()
RETURNS TABLE (company_id uuid, watch_id uuid, via text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (c.id, w.id) c.id, w.id,
         CASE WHEN EXISTS (
           SELECT 1 FROM public.security_assignments sa
           WHERE sa.security_company_id = c.id AND sa.active AND sa.suburb_id = w.primary_suburb_id
         ) THEN 'assigned' ELSE 'city' END
  FROM public.organizations c
  JOIN public.organizations w ON w.type = 'nw_group' AND w.status <> 'suspended'
  WHERE c.type = 'security_company'
    AND (
      EXISTS (
        SELECT 1 FROM public.security_assignments sa
        WHERE sa.security_company_id = c.id AND sa.active
          AND (sa.suburb_id = w.primary_suburb_id
               OR EXISTS (SELECT 1 FROM public.organization_suburbs os
                          WHERE os.organization_id = w.id AND os.active AND os.suburb_id = sa.suburb_id))
      )
      OR (c.city_id IS NOT NULL AND w.city_id = c.city_id)
    )
  ORDER BY c.id, w.id;
$$;

-- 3. Residents ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_residents(
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
  v_from_day date;
  v_to_day date;
  v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
  v_since date;
  v_active jsonb;
  v_reports jsonb;
  v_suburbs jsonb;
  v_retention jsonb;
  v_services jsonb;
BEGIN
  IF NOT coalesce(public.is_global_app_staff(), false) THEN
    RAISE EXCEPTION 'Only global admins and support can view analytics.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public.analytics_bounds(p_from, p_to, p_grain);
  SELECT * INTO s FROM public.analytics_scope(p_city_ids, p_suburb_ids, p_org_ids);
  v_from_day := (b.from_ts AT TIME ZONE 'Africa/Johannesburg')::date;
  v_to_day := ((b.to_ts - interval '1 microsecond') AT TIME ZONE 'Africa/Johannesburg')::date;
  SELECT min(day) INTO v_since FROM public.user_activity_days;

  -- A. Active members (from user_activity_days; fills in from the day phase 4 was applied)
  WITH act AS (
    SELECT a.user_id, a.day, a.platform, public.analytics_role_group(u.role::text) AS grp
    FROM public.user_activity_days a
    JOIN public.users u ON u.id = a.user_id
    WHERE a.day BETWEEN least(v_from_day, v_to_day - 29) AND v_to_day
      AND public.analytics_user_in_scope(a.user_id, s.all_orgs, s.org_ids)
  ),
  win AS (SELECT * FROM act WHERE day >= v_from_day),
  daily AS (
    SELECT d::date AS day,
           count(DISTINCT w.user_id) FILTER (WHERE w.grp = 'resident') AS residents,
           count(DISTINCT w.user_id) FILTER (WHERE w.grp = 'patroller') AS patrollers,
           count(DISTINCT w.user_id) AS members
    FROM generate_series(greatest(v_from_day, coalesce(v_since, v_to_day)), v_to_day, interval '1 day') d
    LEFT JOIN win w ON w.day = d::date
    GROUP BY 1
  ),
  series AS (
    SELECT bk.bucket,
           count(DISTINCT w.user_id) FILTER (WHERE w.grp = 'resident') AS residents,
           count(DISTINCT w.user_id) FILTER (WHERE w.grp = 'patroller') AS patrollers,
           count(DISTINCT w.user_id) AS members
    FROM public.analytics_buckets(b.from_ts, b.to_ts, b.grain) bk
    LEFT JOIN win w ON date_trunc(b.grain, w.day::timestamp) = bk.bucket
    GROUP BY bk.bucket
  )
  SELECT jsonb_build_object(
    'tracking_since', v_since,
    'days_tracked', CASE WHEN v_since IS NULL OR v_since > v_to_day THEN 0 ELSE v_to_day - greatest(v_since, v_from_day) + 1 END,
    'as_of', v_to_day,
    'in_period', (SELECT jsonb_build_object(
        'residents', count(DISTINCT user_id) FILTER (WHERE grp = 'resident'),
        'patrollers', count(DISTINCT user_id) FILTER (WHERE grp = 'patroller'),
        'members', count(DISTINCT user_id)) FROM win),
    'dau', (SELECT jsonb_build_object(
        'residents', count(DISTINCT user_id) FILTER (WHERE grp = 'resident'),
        'patrollers', count(DISTINCT user_id) FILTER (WHERE grp = 'patroller'),
        'members', count(DISTINCT user_id)) FROM act WHERE day = v_to_day),
    'avg_dau', (SELECT jsonb_build_object(
        'residents', round(coalesce(avg(residents), 0), 1),
        'patrollers', round(coalesce(avg(patrollers), 0), 1),
        'members', round(coalesce(avg(members), 0), 1)) FROM daily),
    'wau', (SELECT jsonb_build_object(
        'residents', count(DISTINCT user_id) FILTER (WHERE grp = 'resident'),
        'patrollers', count(DISTINCT user_id) FILTER (WHERE grp = 'patroller'),
        'members', count(DISTINCT user_id)) FROM act WHERE day > v_to_day - 7),
    'mau', (SELECT jsonb_build_object(
        'residents', count(DISTINCT user_id) FILTER (WHERE grp = 'resident'),
        'patrollers', count(DISTINCT user_id) FILTER (WHERE grp = 'patroller'),
        'members', count(DISTINCT user_id)) FROM act WHERE day > v_to_day - 30),
    'by_platform', (SELECT coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'members', n) ORDER BY n DESC, platform), '[]'::jsonb)
                    FROM (SELECT platform, count(DISTINCT user_id) AS n FROM win GROUP BY 1) p),
    'series', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'bucket', to_char(bucket, 'YYYY-MM-DD'), 'residents', residents, 'patrollers', patrollers, 'members', members)
                ORDER BY bucket), '[]'::jsonb) FROM series)
  ) INTO v_active;

  -- B. Reports by who raised them, and response times
  WITH inc AS (
    SELECT public.analytics_role_group(u.role::text) AS grp,
           coalesce(i.submitted_at, i.incident_date::timestamptz) AS reported_at,
           i.approved_at, lower(coalesce(i.status, '')) AS status
    FROM public.incidents i
    LEFT JOIN public.users u ON u.id::text = i.reporter_id::text
    WHERE coalesce(i.submitted_at, i.incident_date::timestamptz) >= b.from_ts
      AND coalesce(i.submitted_at, i.incident_date::timestamptz) < b.to_ts
      AND public.analytics_in_scope(i.organization_id, s.all_orgs, s.org_ids, s.include_unassigned)
      AND NOT EXISTS (SELECT 1 FROM public.sos_alerts sa WHERE sa.incident_id = i.id)
  ),
  sos AS (
    SELECT public.analytics_role_group(u.role::text) AS grp, sa.created_at, sa.acknowledged_at
    FROM public.sos_alerts sa
    LEFT JOIN public.incidents i ON i.id = sa.incident_id
    LEFT JOIN public.users u ON u.id = sa.resident_id
    WHERE sa.created_at >= b.from_ts AND sa.created_at < b.to_ts
      AND public.analytics_in_scope(coalesce(sa.organization_id, i.organization_id), s.all_orgs, s.org_ids, s.include_unassigned)
  ),
  groups AS (
    SELECT grp FROM inc UNION SELECT grp FROM sos
  ),
  per AS (
    SELECT g.grp,
      (SELECT count(*) FROM inc WHERE inc.grp = g.grp) AS incidents,
      (SELECT count(*) FROM inc WHERE inc.grp = g.grp AND (approved_at IS NOT NULL OR status = 'approved')) AS approved,
      (SELECT count(*) FROM inc WHERE inc.grp = g.grp AND status = 'pending') AS pending,
      (SELECT public.analytics_secs(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (approved_at - reported_at))))
         FROM inc WHERE inc.grp = g.grp AND approved_at >= reported_at) AS approve_median_seconds,
      (SELECT public.analytics_secs(percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (approved_at - reported_at))))
         FROM inc WHERE inc.grp = g.grp AND approved_at >= reported_at) AS approve_p90_seconds,
      (SELECT count(*) FROM sos WHERE sos.grp = g.grp) AS sos,
      (SELECT count(*) FROM sos WHERE sos.grp = g.grp AND acknowledged_at IS NOT NULL) AS sos_acknowledged,
      (SELECT public.analytics_secs(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (acknowledged_at - created_at))))
         FROM sos WHERE sos.grp = g.grp AND acknowledged_at >= created_at) AS sos_ack_median_seconds,
      (SELECT public.analytics_secs(percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (acknowledged_at - created_at))))
         FROM sos WHERE sos.grp = g.grp AND acknowledged_at >= created_at) AS sos_ack_p90_seconds
    FROM groups g
  )
  SELECT jsonb_build_object(
    'incidents', (SELECT count(*) FROM inc),
    'sos', (SELECT count(*) FROM sos),
    'by_role', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'role', grp, 'incidents', incidents, 'approved', approved, 'pending', pending,
        'approve_median_seconds', approve_median_seconds, 'approve_p90_seconds', approve_p90_seconds,
        'sos', sos, 'sos_acknowledged', sos_acknowledged,
        'sos_ack_median_seconds', sos_ack_median_seconds, 'sos_ack_p90_seconds', sos_ack_p90_seconds)
      ORDER BY (incidents + sos) DESC, grp) FROM per), '[]'::jsonb)
  ) INTO v_reports;

  -- C. Residents per suburb next to patrol coverage
  WITH res AS (
    SELECT coalesce(u.home_suburb_id, o.primary_suburb_id) AS suburb_id
    FROM public.users u
    LEFT JOIN public.organizations o ON o.id = u.organization_id
    WHERE public.analytics_role_group(u.role::text) = 'resident'
      AND public.analytics_user_in_scope(u.id, s.all_orgs, s.org_ids)
  ),
  pat AS (
    SELECT coalesce(l.suburb_id, o.primary_suburb_id) AS suburb_id,
           public.analytics_patrol_minutes(l.duration_minutes::numeric, l.start_time, l.end_time) AS minutes
    FROM public.patrol_logs l
    LEFT JOIN public.organizations o ON o.id = coalesce(l.organization_id, v_legacy)
    WHERE l.start_time >= b.from_ts AND l.start_time < b.to_ts
      AND public.analytics_in_scope(l.organization_id, s.all_orgs, s.org_ids, s.include_unassigned)
  ),
  r AS (SELECT suburb_id, count(*) AS residents FROM res GROUP BY 1),
  p AS (SELECT suburb_id, count(*) AS patrols, round(sum(minutes) / 60.0, 1) AS hours FROM pat GROUP BY 1),
  j AS (
    SELECT coalesce(r.suburb_id, p.suburb_id) AS suburb_id, coalesce(r.residents, 0) AS residents,
           coalesce(p.patrols, 0) AS patrols, coalesce(p.hours, 0) AS hours
    FROM r FULL JOIN p
      ON coalesce(p.suburb_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(r.suburb_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ),
  tot AS (
    SELECT sum(residents) FILTER (WHERE suburb_id IS NOT NULL) AS residents,
           sum(hours) FILTER (WHERE suburb_id IS NOT NULL) AS hours
    FROM j
  ),
  rated AS (
    SELECT j.*, sb.name AS suburb, c.name AS city,
           CASE WHEN j.residents > 0 THEN round(j.hours * 100.0 / j.residents, 1) END AS hours_per_100,
           (j.suburb_id IS NOT NULL AND j.residents >= 5 AND (
              j.patrols = 0
              OR (t.residents > 0 AND t.hours > 0 AND j.hours * 100.0 / j.residents < 0.5 * (t.hours * 100.0 / t.residents))
           )) AS under_covered
    FROM j CROSS JOIN tot t
    LEFT JOIN public.suburbs sb ON sb.id = j.suburb_id
    LEFT JOIN public.cities c ON c.id = sb.city_id
  )
  SELECT jsonb_build_object(
    'min_residents', 5,
    'platform_hours_per_100', (SELECT CASE WHEN residents > 0 THEN round(hours * 100.0 / residents, 1) END FROM tot),
    'suburbs_with_residents', (SELECT count(*) FROM rated WHERE suburb_id IS NOT NULL AND residents > 0),
    'under_covered', (SELECT count(*) FROM rated WHERE under_covered),
    'residents_without_area', (SELECT coalesce(sum(residents), 0) FROM rated WHERE suburb_id IS NULL),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'suburb_id', suburb_id, 'suburb', coalesce(suburb, 'Area not set'), 'city', city,
        'residents', residents, 'patrols', patrols, 'hours', hours,
        'hours_per_100_residents', hours_per_100, 'under_covered', under_covered)
      ORDER BY under_covered DESC, residents DESC, patrols DESC, coalesce(suburb, '~'))
      FROM (SELECT * FROM rated ORDER BY under_covered DESC, residents DESC, patrols DESC, coalesce(suburb, '~') LIMIT 30) x), '[]'::jsonb)
  ) INTO v_suburbs;

  -- F. Retention by sign-up month (last 12 months up to the end of the range)
  WITH cohort_users AS (
    SELECT u.id, public.analytics_role_group(u.role::text) AS grp, u.created_at,
           date_trunc('month', u.created_at AT TIME ZONE 'Africa/Johannesburg') AS month
    FROM public.users u
    WHERE u.created_at < b.to_ts
      AND u.created_at >= (date_trunc('month', (b.to_ts - interval '1 microsecond') AT TIME ZONE 'Africa/Johannesburg') - interval '11 months') AT TIME ZONE 'Africa/Johannesburg'
      AND public.analytics_role_group(u.role::text) IN ('resident', 'patroller')
      AND public.analytics_user_in_scope(u.id, s.all_orgs, s.org_ids)
  ),
  seen AS (
    SELECT cu.*,
           (SELECT max(a.day) FROM public.user_activity_days a WHERE a.user_id = cu.id) AS last_activity_day,
           au.last_sign_in_at,
           (SELECT max(v.app_version_updated_at) FROM public.user_app_versions v WHERE v.user_id = cu.id) AS last_version_at
    FROM cohort_users cu
    LEFT JOIN auth.users au ON au.id = cu.id
  ),
  sig AS (
    SELECT seen.*,
           greatest(
             ((last_activity_day + 1)::timestamp AT TIME ZONE 'Africa/Johannesburg') - interval '1 second',
             last_sign_in_at, last_version_at
           ) AS last_seen,
           CASE WHEN last_activity_day IS NOT NULL THEN 'activity'
                WHEN last_sign_in_at IS NOT NULL OR last_version_at IS NOT NULL THEN 'sign_in'
                ELSE 'none' END AS source
    FROM seen
  ),
  rows AS (
    SELECT month, grp,
           count(*) AS joined,
           count(*) FILTER (WHERE created_at + interval '30 days' <= now()) AS eligible_30,
           count(*) FILTER (WHERE created_at + interval '30 days' <= now() AND last_seen >= created_at + interval '30 days') AS retained_30,
           count(*) FILTER (WHERE created_at + interval '90 days' <= now()) AS eligible_90,
           count(*) FILTER (WHERE created_at + interval '90 days' <= now() AND last_seen >= created_at + interval '90 days') AS retained_90
    FROM sig GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'tracking_since', v_since,
    'sources', (SELECT jsonb_build_object(
        'activity_days', count(*) FILTER (WHERE source = 'activity'),
        'sign_in_only', count(*) FILTER (WHERE source = 'sign_in'),
        'no_signal', count(*) FILTER (WHERE source = 'none')) FROM sig),
    'totals', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'group', grp, 'joined', joined, 'eligible_30', e30, 'retained_30', r30, 'eligible_90', e90, 'retained_90', r90) ORDER BY grp DESC)
      FROM (SELECT grp, sum(joined) AS joined, sum(eligible_30) AS e30, sum(retained_30) AS r30,
                   sum(eligible_90) AS e90, sum(retained_90) AS r90 FROM rows GROUP BY grp) t), '[]'::jsonb),
    'cohorts', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'month', to_char(month, 'YYYY-MM'), 'group', grp, 'joined', joined,
        'eligible_30', eligible_30, 'retained_30', retained_30,
        'eligible_90', eligible_90, 'retained_90', retained_90) ORDER BY month DESC, grp DESC) FROM rows), '[]'::jsonb)
  ) INTO v_retention;

  -- G. Local services and talents (resident business listings)
  WITH l AS (
    SELECT l.id, l.owner_user_id, l.status, l.created_at, l.is_featured,
           coalesce(pc.label, c.label, initcap(replace(l.category_slug, '-', ' ')), 'Other') AS category
    FROM public.local_service_listings l
    LEFT JOIN public.local_service_categories c ON c.slug = l.category_slug
    LEFT JOIN public.local_service_categories pc ON pc.slug = c.parent_slug
    WHERE l.status <> 'removed'
      AND public.analytics_in_scope(l.organization_id, s.all_orgs, s.org_ids, false)
  ),
  rv AS (
    SELECT r.rating, r.created_at
    FROM public.local_service_reviews r
    JOIN l ON l.id = r.listing_id
    WHERE r.status = 'published'
  )
  SELECT jsonb_build_object(
    'listings', (SELECT count(*) FROM l),
    'active', (SELECT count(*) FROM l WHERE status = 'published'),
    'inactive', (SELECT count(*) FROM l WHERE status <> 'published'),
    'awaiting_review', (SELECT count(*) FROM l WHERE status = 'pending'),
    'featured', (SELECT count(*) FROM l WHERE is_featured AND status = 'published'),
    'new_in_period', (SELECT count(*) FROM l WHERE created_at >= b.from_ts AND created_at < b.to_ts),
    'providers', (SELECT count(DISTINCT owner_user_id) FROM l),
    'active_providers', (SELECT count(DISTINCT owner_user_id) FROM l WHERE status = 'published'),
    'by_status', coalesce((SELECT jsonb_agg(jsonb_build_object('status', status, 'listings', n) ORDER BY n DESC, status)
                 FROM (SELECT status, count(*) AS n FROM l GROUP BY 1) x), '[]'::jsonb),
    'by_category', coalesce((SELECT jsonb_agg(jsonb_build_object('category', category, 'listings', n, 'active', a) ORDER BY n DESC, category)
                 FROM (SELECT category, count(*) AS n, count(*) FILTER (WHERE status = 'published') AS a FROM l GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 15) x), '[]'::jsonb),
    'reviews', (SELECT jsonb_build_object(
        'total', count(*),
        'in_period', count(*) FILTER (WHERE created_at >= b.from_ts AND created_at < b.to_ts),
        'avg_rating', round(avg(rating), 2)) FROM rv)
  ) INTO v_services;

  RETURN jsonb_build_object(
    'range', jsonb_build_object('from', b.from_ts, 'to', b.to_ts, 'grain', b.grain),
    'active', v_active,
    'reports', v_reports,
    'suburbs', v_suburbs,
    'retention', v_retention,
    'services', v_services
  );
END;
$$;

-- 4. Security companies -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_security(
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
  v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
  v_companies uuid[];
  v_watches uuid[];
  v_out jsonb;
BEGIN
  IF NOT coalesce(public.is_global_app_staff(), false) THEN
    RAISE EXCEPTION 'Only global admins and support can view analytics.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public.analytics_bounds(p_from, p_to, p_grain);
  SELECT * INTO s FROM public.analytics_scope(p_city_ids, p_suburb_ids, p_org_ids);

  -- Companies in scope: all of them platform-wide; with filters, those covering a selected
  -- watch, or based in a selected city.
  SELECT coalesce(array_agg(c.id), '{}') INTO v_companies
  FROM public.organizations c
  WHERE c.type = 'security_company'
    AND (
      s.all_orgs
      OR EXISTS (SELECT 1 FROM public.analytics_security_coverage() cv WHERE cv.company_id = c.id AND cv.watch_id = ANY (s.org_ids))
      OR (nullif(p_org_ids, '{}') IS NULL AND nullif(p_suburb_ids, '{}') IS NULL AND c.city_id = ANY (coalesce(p_city_ids, '{}')))
    );

  -- Watch areas those companies cover (limited to the watches the filters select).
  SELECT coalesce(array_agg(DISTINCT cv.watch_id), '{}') INTO v_watches
  FROM public.analytics_security_coverage() cv
  WHERE cv.company_id = ANY (v_companies)
    AND (s.all_orgs OR cv.watch_id = ANY (s.org_ids));

  WITH comp AS (
    SELECT c.id, c.name, c.status, c.created_at,
           coalesce(c.settings_json->>'coverage_scope', c.settings_json->>'latest_signup_coverage_scope', '') = 'city' AS city_wide
    FROM public.organizations c WHERE c.id = ANY (v_companies)
  ),
  asg AS (
    SELECT sa.* FROM public.security_assignments sa
    WHERE sa.security_company_id = ANY (v_companies) AND sa.active
  ),
  mem AS (
    SELECT m.* FROM public.resident_security_memberships m
    WHERE m.security_company_id = ANY (v_companies)
  ),
  ev AS (
    SELECT e.* FROM public.security_membership_events e
    WHERE e.created_at >= b.from_ts AND e.created_at < b.to_ts
      AND (e.to_company_id = ANY (v_companies) OR e.from_company_id = ANY (v_companies))
  ),
  sec_staff AS (
    SELECT DISTINCT m.user_id FROM public.organization_members m
    JOIN public.organizations o ON o.id = m.organization_id AND o.type = 'security_company'
    WHERE m.status = 'active'
    UNION
    SELECT u.id FROM public.users u WHERE lower(coalesce(u.role::text, '')) = 'security_admin'
  ),
  sos AS (
    SELECT sa.created_at, sa.acknowledged_at, sa.acknowledged_by_user_id, sa.resolved_by_organization_id
    FROM public.sos_alerts sa
    LEFT JOIN public.incidents i ON i.id = sa.incident_id
    WHERE sa.created_at >= b.from_ts AND sa.created_at < b.to_ts
      AND coalesce(sa.organization_id, i.organization_id) = ANY (v_watches)
  ),
  inc AS (
    SELECT coalesce(i.submitted_at, i.incident_date::timestamptz) AS reported_at, i.approved_at
    FROM public.incidents i
    WHERE coalesce(i.submitted_at, i.incident_date::timestamptz) >= b.from_ts
      AND coalesce(i.submitted_at, i.incident_date::timestamptz) < b.to_ts
      AND i.organization_id = ANY (v_watches)
      AND NOT EXISTS (SELECT 1 FROM public.sos_alerts x WHERE x.incident_id = i.id)
  ),
  per_company AS (
    SELECT c.name, c.status,
           (SELECT count(*) FROM mem WHERE mem.security_company_id = c.id AND membership_status IN ('self_reported', 'verified')) AS clients,
           (SELECT count(*) FROM mem WHERE mem.security_company_id = c.id AND membership_status = 'verified') AS verified,
           (SELECT count(*) FROM asg WHERE asg.security_company_id = c.id) AS suburbs,
           (SELECT count(*) FROM public.analytics_security_coverage() cv WHERE cv.company_id = c.id) AS watch_areas
    FROM comp c
  )
  SELECT jsonb_build_object(
    'companies', jsonb_build_object(
      'total', (SELECT count(*) FROM comp),
      'active', (SELECT count(*) FROM comp WHERE status = 'active'),
      'new_in_period', (SELECT count(*) FROM comp WHERE created_at >= b.from_ts AND created_at < b.to_ts),
      'city_wide', (SELECT count(*) FROM comp WHERE city_wide),
      'with_assignments', (SELECT count(DISTINCT security_company_id) FROM asg),
      'by_status', coalesce((SELECT jsonb_agg(jsonb_build_object('status', status, 'companies', n) ORDER BY n DESC, status)
                   FROM (SELECT status, count(*) AS n FROM comp GROUP BY 1) x), '[]'::jsonb)
    ),
    'series', (SELECT coalesce(jsonb_agg(jsonb_build_object('bucket', to_char(bk.bucket, 'YYYY-MM-DD'), 'companies', n,
                  'clients', cl) ORDER BY bk.bucket), '[]'::jsonb)
               FROM (SELECT bk.bucket,
                            (SELECT count(*) FROM comp WHERE date_trunc(b.grain, comp.created_at AT TIME ZONE 'Africa/Johannesburg') = bk.bucket) AS n,
                            (SELECT count(*) FROM mem WHERE date_trunc(b.grain, mem.created_at AT TIME ZONE 'Africa/Johannesburg') = bk.bucket) AS cl
                     FROM public.analytics_buckets(b.from_ts, b.to_ts, b.grain) bk) bk),
    'areas', jsonb_build_object(
      'assigned_suburbs', (SELECT count(DISTINCT suburb_id) FROM asg),
      'by_assignment', coalesce((SELECT jsonb_agg(jsonb_build_object('type', assignment_type, 'assignments', n) ORDER BY n DESC, assignment_type)
                       FROM (SELECT assignment_type, count(*) AS n FROM asg GROUP BY 1) x), '[]'::jsonb),
      'watch_areas_covered', cardinality(v_watches),
      'watch_areas_total', (SELECT count(*) FROM public.organizations o
                            WHERE o.type = 'nw_group' AND o.status <> 'suspended' AND (s.all_orgs OR o.id = ANY (s.org_ids)))
    ),
    'clients', jsonb_build_object(
      'linked', (SELECT count(*) FROM mem WHERE membership_status IN ('self_reported', 'verified')),
      'verified', (SELECT count(*) FROM mem WHERE membership_status = 'verified'),
      'awaiting_verification', (SELECT count(*) FROM mem WHERE membership_status = 'self_reported'),
      'new_in_period', (SELECT count(*) FROM mem WHERE created_at >= b.from_ts AND created_at < b.to_ts),
      'verified_in_period', (SELECT count(*) FROM mem WHERE verified_at >= b.from_ts AND verified_at < b.to_ts),
      'by_status', coalesce((SELECT jsonb_agg(jsonb_build_object('status', membership_status, 'clients', n) ORDER BY n DESC, membership_status)
                   FROM (SELECT membership_status, count(*) AS n FROM mem GROUP BY 1) x), '[]'::jsonb),
      'access_by_level', coalesce((SELECT jsonb_agg(jsonb_build_object('level', access_level, 'residents', n) ORDER BY n DESC, access_level)
                   FROM (SELECT access_level, count(*) AS n FROM public.security_resident_access
                         WHERE active AND security_company_id = ANY (v_companies) GROUP BY 1) x), '[]'::jsonb)
    ),
    'movement', jsonb_build_object(
      'won', (SELECT count(*) FROM ev WHERE to_company_id = ANY (v_companies) AND event_type IN ('claimed', 'transferred')),
      'lost', (SELECT count(*) FROM ev WHERE from_company_id = ANY (v_companies)
                 AND event_type IN ('transferred', 'withdrawn', 'expired', 'deleted')),
      'verified', (SELECT count(*) FROM ev WHERE event_type = 'verified'),
      'rejected', (SELECT count(*) FROM ev WHERE event_type = 'rejected'),
      'by_event', coalesce((SELECT jsonb_agg(jsonb_build_object('event', event_type, 'events', n) ORDER BY n DESC, event_type)
                  FROM (SELECT event_type, count(*) AS n FROM ev GROUP BY 1) x), '[]'::jsonb)
    ),
    'safety', jsonb_build_object(
      'sos', (SELECT count(*) FROM sos),
      'sos_acknowledged', (SELECT count(*) FROM sos WHERE acknowledged_at IS NOT NULL),
      'sos_ack_median_seconds', (SELECT public.analytics_secs(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (acknowledged_at - created_at)))) FROM sos WHERE acknowledged_at >= created_at),
      'sos_ack_p90_seconds', (SELECT public.analytics_secs(percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (acknowledged_at - created_at)))) FROM sos WHERE acknowledged_at >= created_at),
      'sos_ack_by_security', (SELECT count(*) FROM sos WHERE acknowledged_by_user_id IN (SELECT user_id FROM sec_staff)),
      'sos_security_ack_median_seconds', (SELECT public.analytics_secs(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (acknowledged_at - created_at))))
                                          FROM sos WHERE acknowledged_at >= created_at AND acknowledged_by_user_id IN (SELECT user_id FROM sec_staff)),
      'sos_resolved_by_security', (SELECT count(*) FROM sos WHERE resolved_by_organization_id = ANY (v_companies)),
      'incidents', (SELECT count(*) FROM inc),
      'incidents_approved', (SELECT count(*) FROM inc WHERE approved_at IS NOT NULL),
      'incident_approve_median_seconds', (SELECT public.analytics_secs(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (approved_at - reported_at)))) FROM inc WHERE approved_at >= reported_at)
    ),
    'coverage', jsonb_build_object(
      'live_patrols_now', (SELECT count(*) FROM public.active_patrols ap WHERE ap.organization_id = ANY (v_watches)),
      'scheduled_today', (SELECT count(*) FROM public.patrol_slots ps WHERE ps.organization_id = ANY (v_watches) AND ps.date = v_today),
      'scheduled_next_7_days', (SELECT count(*) FROM public.patrol_slots ps WHERE ps.organization_id = ANY (v_watches)
                                AND ps.date >= v_today AND ps.date < v_today + 7)
    ),
    'top_companies', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'name', name, 'status', status, 'clients', clients, 'verified', verified, 'suburbs', suburbs, 'watch_areas', watch_areas)
      ORDER BY clients DESC, verified DESC, name)
      FROM (SELECT * FROM per_company ORDER BY clients DESC, verified DESC, name LIMIT 10) x), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out || jsonb_build_object('range', jsonb_build_object('from', b.from_ts, 'to', b.to_ts, 'grain', b.grain));
END;
$$;

-- 5. Privileges and comments --------------------------------------------------------------
REVOKE ALL ON FUNCTION public.analytics_role_group(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_security_coverage() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_residents(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.analytics_security(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_residents(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_security(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) TO authenticated;

COMMENT ON FUNCTION public.analytics_role_group(text) IS 'Analytics (private): reporting group for a users.role value.';
COMMENT ON FUNCTION public.analytics_security_coverage() IS 'Analytics (private): watches each security company covers (assigned suburbs, else same city).';
COMMENT ON FUNCTION public.analytics_residents(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) IS
  'Analytics: active members, reports by role, residents vs patrol coverage per suburb, retention cohorts, local services. Global staff only; aggregates only.';
COMMENT ON FUNCTION public.analytics_security(timestamptz, timestamptz, uuid[], uuid[], uuid[], text) IS
  'Analytics: security companies, partner areas, clients, won/lost, SOS and incidents in partner areas, live and scheduled coverage. Global staff only; aggregates only.';

-- 6. Verify -------------------------------------------------------------------------------
DO $verify$
DECLARE
  problems text := '';
  f text;
BEGIN
  IF to_regclass('public.user_activity_days') IS NULL THEN problems := problems || 'user_activity_days table; '; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.user_activity_days'::regclass AND relrowsecurity) THEN
    problems := problems || 'user_activity_days RLS off; ';
  END IF;
  IF has_table_privilege('authenticated', 'public.user_activity_days', 'INSERT')
     OR has_table_privilege('authenticated', 'public.user_activity_days', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.user_activity_days', 'DELETE')
     OR has_table_privilege('anon', 'public.user_activity_days', 'SELECT') THEN
    problems := problems || 'user_activity_days is writable by members or readable by anon; ';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.touch_activity(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.touch_activity(text)', 'EXECUTE') THEN
    problems := problems || 'touch_activity privileges; ';
  END IF;
  FOREACH f IN ARRAY ARRAY[
    'public.analytics_residents(timestamptz,timestamptz,uuid[],uuid[],uuid[],text)',
    'public.analytics_security(timestamptz,timestamptz,uuid[],uuid[],uuid[],text)'
  ] LOOP
    IF to_regprocedure(f) IS NULL THEN
      problems := problems || f || ' missing; ';
    ELSIF has_function_privilege('anon', f, 'EXECUTE') OR NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN
      problems := problems || f || ' privileges; ';
    ELSIF position('is_global_app_staff' IN pg_get_functiondef(f::regprocedure)) = 0 THEN
      problems := problems || f || ' has no staff gate; ';
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.analytics_role_group(text)', 'public.analytics_security_coverage()'] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE') THEN
      problems := problems || f || ' callable by members; ';
    END IF;
  END LOOP;
  IF public.analytics_role_group('user') <> 'resident' OR public.analytics_role_group(NULL) <> 'unknown' THEN
    problems := problems || 'analytics_role_group; ';
  END IF;
  IF problems <> '' THEN
    RAISE EXCEPTION 'Analytics phase 4: verification failed: %', problems;
  END IF;
  RAISE NOTICE 'Analytics phase 4: OK';
END
$verify$;
