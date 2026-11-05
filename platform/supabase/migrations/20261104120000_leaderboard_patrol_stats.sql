-- Leaderboard aggregates for one neighbourhood and an optional date window.
-- Forward-only: adds leaderboard_patrol_stats plus two supporting indexes.
-- Does not rewrite or delete patrol rows.
--
-- Isolation: SECURITY DEFINER so the aggregate can read this org's patrol_logs,
-- active_patrols, and the display name / avatar of people who patrolled here,
-- without handing the caller a raw dump of every log. search_path is pinned to
-- public. The function refuses to run unless auth.uid() is set and
-- p_organization_id is one of current_org_ids() (the caller's working
-- neighbourhood and, for non-global members, their memberships). A caller in
-- org A cannot pass org B.
--
-- Null organization_id rows are included only when the requested org's name
-- matches the legacy Theescombe neighbourhood. That is the same unscoped
-- exception the web client already applies (scopeToOrganization) for rows
-- created before organization_id existed. Other orgs never see those rows.
-- EXECUTE is revoked from PUBLIC and anon.

CREATE OR REPLACE FUNCTION public.leaderboard_patrol_stats(
  p_organization_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS TABLE (
  user_id text,
  display_name text,
  total_minutes numeric,
  patrol_count integer,
  avatar_url text,
  car_type text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz := p_from;
  v_to timestamptz := p_to;
  v_legacy boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_organization_id IS NULL
     OR p_organization_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_from > v_to THEN
    v_from := p_to;
    v_to := p_from;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_organization_id
      AND o.name ILIKE '%theescombe%'
  ) INTO v_legacy;

  RETURN QUERY
  WITH raw AS (
    SELECT
      NULLIF(btrim(pl.user_id::text), '') AS uid,
      NULLIF(btrim(pl.user_name), '') AS fallback_name,
      pl.start_time,
      pl.end_time,
      CASE
        WHEN COALESCE(to_jsonb(pl)->>'created_at', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          THEN (to_jsonb(pl)->>'created_at')::timestamptz
        ELSE NULL
      END AS created_at,
      pl.duration_minutes::numeric AS duration_minutes
    FROM public.patrol_logs pl
    WHERE pl.organization_id = p_organization_id
       OR (v_legacy AND pl.organization_id IS NULL)

    UNION ALL

    SELECT
      NULLIF(btrim(ap.user_id::text), '') AS uid,
      NULLIF(btrim(ap.user_name), '') AS fallback_name,
      ap.start_time,
      now() AS end_time,
      NULL::timestamptz AS created_at,
      GREATEST(
        1,
        floor(extract(epoch FROM (now() - ap.start_time)) / 60.0)
      )::numeric AS duration_minutes
    FROM public.active_patrols ap
    WHERE ap.start_time IS NOT NULL
      AND (
        ap.organization_id = p_organization_id
        OR (v_legacy AND ap.organization_id IS NULL)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.patrol_logs pl2
        WHERE pl2.user_id::text IS NOT DISTINCT FROM ap.user_id::text
          AND pl2.start_time IS NOT DISTINCT FROM ap.start_time
          AND (
            pl2.organization_id = p_organization_id
            OR (v_legacy AND pl2.organization_id IS NULL)
          )
      )
  ),
  filtered AS (
    SELECT *
    FROM raw r
    WHERE CASE
      WHEN r.start_time IS NOT NULL OR r.end_time IS NOT NULL THEN
        (
          CASE
            WHEN r.start_time IS NOT NULL AND r.end_time IS NOT NULL THEN GREATEST(r.start_time, r.end_time)
            ELSE COALESCE(r.end_time, r.start_time)
          END
        ) >= COALESCE(v_from, '-infinity'::timestamptz)
        AND COALESCE(r.start_time, r.end_time) <= COALESCE(v_to, 'infinity'::timestamptz)
      ELSE
        r.created_at IS NOT NULL
        AND r.created_at >= COALESCE(v_from, '-infinity'::timestamptz)
        AND r.created_at <= COALESCE(v_to, 'infinity'::timestamptz)
    END
  ),
  grouped AS (
    SELECT
      COALESCE(f.uid, 'name:' || lower(f.fallback_name)) AS group_key,
      MAX(f.uid) AS uid,
      MAX(f.fallback_name) AS fallback_name,
      SUM(
        CASE
          WHEN f.duration_minutes IS NOT NULL AND f.duration_minutes > 0 THEN f.duration_minutes
          WHEN f.start_time IS NOT NULL AND f.end_time IS NOT NULL AND f.end_time > f.start_time
            THEN GREATEST(1, floor(extract(epoch FROM (f.end_time - f.start_time)) / 60.0))
          ELSE GREATEST(0, COALESCE(f.duration_minutes, 0))
        END
      ) AS total_minutes,
      COUNT(*)::integer AS patrol_count
    FROM filtered f
    WHERE f.uid IS NOT NULL OR f.fallback_name IS NOT NULL
    GROUP BY 1
  )
  SELECT
    g.uid AS user_id,
    COALESCE(NULLIF(btrim(u.full_name), ''), g.fallback_name, 'Volunteer') AS display_name,
    COALESCE(g.total_minutes, 0) AS total_minutes,
    g.patrol_count,
    NULLIF(u.avatar_url, '') AS avatar_url,
    NULLIF(to_jsonb(u)->>'car_type', '') AS car_type
  FROM grouped g
  LEFT JOIN public.users u
    ON g.uid IS NOT NULL
   AND u.id::text = g.uid
  ORDER BY g.total_minutes DESC,
           COALESCE(NULLIF(btrim(u.full_name), ''), g.fallback_name, 'Volunteer');
END;
$$;

COMMENT ON FUNCTION public.leaderboard_patrol_stats(uuid, timestamptz, timestamptz) IS
  'Aggregated patrol hours for one organization the caller belongs to. Null dates mean all time. Does not return raw patrol_logs.';

REVOKE ALL ON FUNCTION public.leaderboard_patrol_stats(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leaderboard_patrol_stats(uuid, timestamptz, timestamptz) TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patrol_logs' AND column_name = 'organization_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patrol_logs' AND column_name = 'start_time'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS patrol_logs_org_start_time_idx
      ON public.patrol_logs (organization_id, start_time DESC)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'incidents' AND column_name = 'created_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS incidents_approved_org_created_idx
      ON public.incidents (organization_id, created_at DESC, id DESC)
      WHERE status = ''approved''';
  END IF;
END $$;
