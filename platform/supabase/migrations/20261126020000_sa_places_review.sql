-- Phase P5: SA places approval queue (review, merge, watch join requests)
--
-- * list_organization_requests() (reviewers: platform staff, global admins, technical support)
--   now also shows:
--     - resident and patroller requesters (suburb requests), not only admin-role requesters;
--     - city, province, the requested suburb and its state;
--     - "possible_duplicates": approved watches in the same city with the same or a close
--       suburb spelling or watch name, to merge into;
--     - people waiting to join an approved watch after a merge (kind 'join').
-- * merge_suburb_request(org, into_org, note): reviewers fold a pending watch / suburb request
--   into an approved watch in the same city (D9):
--     - each requester becomes a PENDING member of the existing watch (its watch admin, or a
--       reviewer, approves); someone already in another watch is left alone;
--     - the requested suburb is marked merged into the existing watch's suburb and its spelling
--       saved as a suburb alias (so suggestions find it next time); if the existing watch has no
--       suburb yet, the requested suburb goes live as its suburb instead;
--     - the duplicate watch is closed (suspended, review_state 'merged', name freed), like reject.
-- * list_watch_join_requests() / review_watch_join(org, user, approve, note): a watch admin (or a
--   reviewer) approves or declines people waiting to join their watch.
-- * my_organization_requests() and my_suburb_requests() also report "merged" (and into what).
--
-- Additive and idempotent; safe to run twice. Needs P1 (schema), P2 (seed) and P3 (search).
-- Ends with NOTICE 'SA places P5: OK'.

-- ---------------------------------------------------------------------------
-- Pre-check: list everything missing at once; change nothing if any is missing
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE
  missing text[] := ARRAY[]::text[];
  r record;
  v_trgm text;
  v_places integer;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('users', 'id'), ('users', 'role'), ('users', 'full_name'), ('users', 'email'), ('users', 'phone'),
      ('users', 'organization_id'), ('users', 'active_organization_id'), ('users', 'home_suburb_id'),
      ('cities', 'id'), ('cities', 'name'), ('cities', 'province'), ('cities', 'province_code'),
      ('cities', 'status'), ('cities', 'geonames_id'),
      ('suburbs', 'id'), ('suburbs', 'city_id'), ('suburbs', 'name'), ('suburbs', 'name_key'), ('suburbs', 'status'),
      ('suburbs', 'source'), ('suburbs', 'requested_by'), ('suburbs', 'merged_into_id'), ('suburbs', 'created_at'),
      ('suburb_aliases', 'suburb_id'), ('suburb_aliases', 'alias'), ('suburb_aliases', 'alias_key'),
      ('organizations', 'id'), ('organizations', 'name'), ('organizations', 'type'), ('organizations', 'status'),
      ('organizations', 'city_id'), ('organizations', 'primary_suburb_id'), ('organizations', 'settings_json'),
      ('organizations', 'created_at'),
      ('organization_members', 'organization_id'), ('organization_members', 'user_id'),
      ('organization_members', 'member_role'), ('organization_members', 'status'), ('organization_members', 'joined_at'),
      ('organization_suburbs', 'organization_id'), ('organization_suburbs', 'suburb_id'),
      ('organization_suburbs', 'assignment_type'), ('organization_suburbs', 'active')
    ) AS t(tbl, col)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = r.tbl AND c.column_name = r.col
    ) THEN
      missing := missing || (r.tbl || '.' || r.col);
    END IF;
  END LOOP;

  FOR r IN
    SELECT * FROM (VALUES
      -- P1 and the sign-up admin gate
      ('public.place_name_key(text)'),
      ('public.is_global_app_staff()'),
      ('public.is_platform_staff()'),
      ('public.org_access_blocked(uuid)'),
      ('public.signup_admin_role_key(text)'),
      ('public.is_org_nw_admin(uuid)'),
      ('public.can_review_organization_requests()'),
      ('public.promote_org_requesters(uuid,uuid)'),
      ('public.approve_organization(uuid,uuid,text)'),
      ('public.reject_organization(uuid,uuid,text)'),
      ('public.list_organization_requests()'),
      ('public.my_organization_requests()'),
      -- P3
      ('public.places_clean_name(text)'),
      ('public.places_join_member_role(uuid)'),
      ('public.places_current_watch(uuid)'),
      ('public.places_ensure_suburb(uuid,text)'),
      ('public.list_city_watches(uuid)'),
      ('public.suggest_suburbs(uuid,text)'),
      ('public.join_watch(uuid)'),
      ('public.request_suburb_or_watch(uuid,text,boolean,boolean,text)'),
      ('public.my_suburb_requests()'),
      ('public.trg_org_suburb_on_review()')
    ) AS t(sig)
  LOOP
    IF to_regprocedure(r.sig) IS NULL THEN
      missing := missing || (r.sig || ' function');
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'organizations_suburb_on_review'
                 AND tgrelid = to_regclass('public.organizations')) THEN
    missing := missing || 'organizations_suburb_on_review trigger (P3)'::text;
  END IF;

  SELECT n.nspname INTO v_trgm
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';
  IF v_trgm IS NULL THEN
    missing := missing || 'pg_trgm extension'::text;
  ELSIF v_trgm NOT IN ('public', 'extensions') THEN
    missing := missing || format('pg_trgm in schema public or extensions (found %s)', v_trgm);
  END IF;

  IF to_regclass('public.cities') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'cities' AND column_name = 'geonames_id') THEN
    EXECUTE 'SELECT count(*) FROM public.cities WHERE geonames_id IS NOT NULL' INTO v_places;
    IF v_places < 10000 THEN
      missing := missing || format('the SA places seed (P2): %s places loaded, expected about 12 162', v_places);
    END IF;
  END IF;

  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'SA places P5: not applied, missing %. Nothing was changed.',
      array_to_string(missing, ', ');
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- The city a watch belongs to: its own city, else its main suburb's city.
CREATE OR REPLACE FUNCTION public.places_org_city(p_org_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(o.city_id, s.city_id)
  FROM public.organizations o
  LEFT JOIN public.suburbs s ON s.id = o.primary_suburb_id
  WHERE o.id = p_org_id;
$$;
REVOKE ALL ON FUNCTION public.places_org_city(uuid) FROM PUBLIC, anon, authenticated;

-- Approved watches in the same city that look like the same place as a pending request:
-- same suburb spelling, a close suburb spelling, or a close watch name. Best first, at most 5.
CREATE OR REPLACE FUNCTION public.places_request_duplicates(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_req record;
  v_city uuid;
  k text;
  nk text;
  v_out jsonb;
BEGIN
  SELECT o.id, o.name, o.type, o.status, o.settings_json, s.name AS suburb
    INTO v_req
  FROM public.organizations o
  LEFT JOIN public.suburbs s ON s.id = o.primary_suburb_id
  WHERE o.id = p_org_id;
  IF NOT FOUND OR v_req.type <> 'nw_group' OR v_req.status <> 'pending' THEN
    RETURN '[]'::jsonb;
  END IF;

  v_city := public.places_org_city(p_org_id);
  k := public.place_name_key(public.places_clean_name(coalesce(v_req.suburb, v_req.settings_json->>'watch_area', '')));
  nk := public.place_name_key(public.places_clean_name(v_req.name));
  IF v_city IS NULL OR (length(k) < 2 AND length(nk) < 3) THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH cand AS (
    SELECT o.id, o.name, s.id AS suburb_id, s.name AS suburb,
           coalesce(s.name_key, public.place_name_key(public.places_clean_name(o.settings_json->>'watch_area'))) AS area_key,
           public.place_name_key(o.name) AS name_key
    FROM public.organizations o
    LEFT JOIN public.suburbs s ON s.id = o.primary_suburb_id AND s.status = 'active'
    WHERE o.type = 'nw_group'
      AND o.status = 'active'
      AND o.id <> p_org_id
      AND (o.city_id = v_city OR s.city_id = v_city)
  ), alias_hit AS (
    SELECT c.id, max(similarity(a.alias_key, k)) AS sim, bool_or(a.alias_key = k) AS same
    FROM cand c
    JOIN public.suburb_aliases a ON a.suburb_id = c.suburb_id
    WHERE length(k) >= 2
    GROUP BY c.id
  ), scored AS (
    SELECT c.*,
           CASE
             WHEN length(k) >= 2 AND (c.area_key = k OR coalesce(ah.same, false)) THEN 'same_suburb'
             WHEN length(k) >= 3 AND c.area_key IS NOT NULL AND c.area_key <> ''
                  AND (c.area_key LIKE k || '%' OR k LIKE c.area_key || '%'
                       OR similarity(c.area_key, k) >= 0.35 OR word_similarity(k, c.area_key) >= 0.6
                       OR coalesce(ah.sim, 0) >= 0.35) THEN 'similar_suburb'
             WHEN length(nk) >= 3 AND similarity(c.name_key, nk) >= 0.45 THEN 'similar_name'
           END AS reason,
           greatest(
             CASE WHEN length(k) >= 2 AND c.area_key IS NOT NULL THEN similarity(c.area_key, k) ELSE 0 END,
             coalesce(ah.sim, 0),
             CASE WHEN length(nk) >= 3 THEN similarity(c.name_key, nk) * 0.9 ELSE 0 END
           ) AS score
    FROM cand c
    LEFT JOIN alias_hit ah ON ah.id = c.id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'organization_id', d.id,
           'name', d.name,
           'suburb_id', d.suburb_id,
           'suburb', d.suburb,
           'reason', d.reason
         ) ORDER BY d.rank, d.score DESC, lower(d.name)), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT s.*, CASE s.reason WHEN 'same_suburb' THEN 0 WHEN 'similar_suburb' THEN 1 ELSE 2 END AS rank
    FROM scored s
    WHERE s.reason IS NOT NULL
    ORDER BY rank, score DESC, lower(s.name)
    LIMIT 5
  ) d;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.places_request_duplicates(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reviewer queue: resident requesters, location, possible duplicates, join waits
-- (same output as before, plus new fields; old app builds ignore the extras)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_organization_requests()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.can_review_organization_requests() THEN
    RAISE EXCEPTION 'Only platform staff, admins and technical support can review requests.'
      USING ERRCODE = '42501';
  END IF;

  WITH req AS (
    SELECT o.*, 'new'::text AS kind
    FROM public.organizations o
    WHERE o.status = 'pending'
    UNION ALL
    SELECT o.*, 'join'::text AS kind
    FROM public.organizations o
    WHERE o.status = 'active'
      AND EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id = o.id
          AND om.status = 'pending'
          AND (
            om.member_role IN ('nw_admin', 'security_admin')
            OR (o.type = 'nw_group' AND om.member_role IN ('resident', 'patroller'))
          )
      )
  )
  SELECT coalesce(jsonb_agg(item ORDER BY created_at DESC), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT
      r.created_at,
      jsonb_build_object(
        'kind', r.kind,
        'organization_id', r.id,
        'name', r.name,
        'type', r.type,
        'status', r.status,
        'review_state', nullif(r.settings_json->>'review_state', ''),
        'source', nullif(r.settings_json->>'source', ''),
        'created_at', r.created_at,
        'requested_at', coalesce(nullif(r.settings_json->>'requested_at', ''), r.created_at::text),
        'city', c.name,
        'city_id', c.id,
        'province', c.province,
        'suburb_id', s.id,
        'suburb', s.name,
        'suburb_status', s.status,
        'watch_area', nullif(r.settings_json->>'watch_area', ''),
        'coverage_area', coalesce(nullif(r.settings_json->>'coverage_area', ''), nullif(r.settings_json->>'latest_signup_coverage_area', '')),
        'registration', coalesce(nullif(r.settings_json->>'psira_or_registration', ''), nullif(r.settings_json->>'psira_reg', '')),
        'possible_duplicates', CASE WHEN r.kind = 'new' AND r.type = 'nw_group'
                                    THEN public.places_request_duplicates(r.id) ELSE '[]'::jsonb END,
        'people', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
                   'user_id', u.id,
                   'name', coalesce(nullif(btrim(u.full_name), ''), u.email::text, 'Member'),
                   'email', u.email::text,
                   'phone', u.phone,
                   'member_role', om.member_role,
                   'membership_status', om.status,
                   'since', om.joined_at,
                   'from_request', (
                     SELECT coalesce(nullif(src.settings_json->>'watch_area', ''), src.settings_json->>'original_name')
                     FROM public.organizations src
                     JOIN public.organization_members som ON som.organization_id = src.id AND som.user_id = u.id
                     WHERE src.settings_json->>'merged_into_org_id' = r.id::text
                     ORDER BY src.created_at DESC
                     LIMIT 1
                   )
                 ) ORDER BY om.joined_at)
          FROM public.organization_members om
          JOIN public.users u ON u.id = om.user_id
          WHERE om.organization_id = r.id
            AND (
              (om.member_role IN ('nw_admin', 'security_admin', 'committee')
                AND (om.status = 'pending' OR (r.kind = 'new' AND om.status = 'active')))
              OR (om.member_role IN ('resident', 'patroller') AND om.status = 'pending' AND r.type = 'nw_group')
            )
        ), '[]'::jsonb)
      ) AS item
    FROM req r
    LEFT JOIN public.cities c ON c.id = coalesce(r.city_id, (SELECT s0.city_id FROM public.suburbs s0 WHERE s0.id = r.primary_suburb_id))
    LEFT JOIN public.suburbs s ON s.id = r.primary_suburb_id
    LIMIT 300
  ) x;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.list_organization_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_organization_requests() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- merge_suburb_request: fold a pending watch / suburb request into an approved watch (D9)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_suburb_request(
  p_org_id uuid,
  p_into_org_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  src record;
  tgt record;
  v_src_city uuid;
  v_tgt_city uuid;
  v_src_suburb record;
  v_tgt_suburb uuid;
  v_alias text;
  v_suburb_state text := 'none';
  v_role text;
  v_current uuid;
  v_moved integer := 0;
  v_busy integer := 0;
  v_skipped integer := 0;
  r record;
  note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
BEGIN
  IF NOT public.can_review_organization_requests() THEN
    RAISE EXCEPTION 'Only platform staff, admins and technical support can merge requests.'
      USING ERRCODE = '42501';
  END IF;

  IF p_org_id IS NULL OR p_into_org_id IS NULL THEN
    RAISE EXCEPTION 'Choose the request and the watch to merge it into.' USING ERRCODE = '22023';
  END IF;
  IF p_org_id = p_into_org_id THEN
    RAISE EXCEPTION 'Choose a different watch to merge into.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO src FROM public.organizations WHERE id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That request no longer exists. Refresh the list.' USING ERRCODE = 'P0002';
  END IF;
  IF src.type <> 'nw_group' OR src.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending watch requests can be merged. Refresh the list.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO tgt FROM public.organizations WHERE id = p_into_org_id FOR UPDATE;
  IF NOT FOUND OR tgt.type <> 'nw_group' OR tgt.status <> 'active' OR public.org_access_blocked(tgt.id) THEN
    RAISE EXCEPTION 'You can only merge into an approved watch. Refresh the list.' USING ERRCODE = '22023';
  END IF;

  v_src_city := public.places_org_city(src.id);
  v_tgt_city := public.places_org_city(tgt.id);
  IF v_src_city IS DISTINCT FROM v_tgt_city THEN
    RAISE EXCEPTION 'You can only merge into a watch in the same city.' USING ERRCODE = '22023';
  END IF;

  -- 1. The suburb: the request's spelling becomes an alias of the existing watch's suburb,
  --    or, if that watch has no suburb yet, the requested suburb becomes its suburb.
  SELECT s.id, s.name, s.name_key, s.status INTO v_src_suburb
  FROM public.suburbs s WHERE s.id = src.primary_suburb_id;
  SELECT s.id INTO v_tgt_suburb
  FROM public.suburbs s WHERE s.id = tgt.primary_suburb_id AND s.status = 'active';

  IF v_tgt_suburb IS NOT NULL THEN
    IF v_src_suburb.id IS NOT NULL AND v_src_suburb.id <> v_tgt_suburb AND v_src_suburb.status = 'requested' THEN
      UPDATE public.suburbs SET status = 'merged', merged_into_id = v_tgt_suburb WHERE id = v_src_suburb.id;
      v_suburb_state := 'merged';
    END IF;
    v_alias := public.places_clean_name(coalesce(v_src_suburb.name, src.settings_json->>'watch_area'));
    IF length(public.place_name_key(v_alias)) >= 2
       AND public.place_name_key(v_alias) <> (SELECT s.name_key FROM public.suburbs s WHERE s.id = v_tgt_suburb) THEN
      INSERT INTO public.suburb_aliases (suburb_id, alias)
      VALUES (v_tgt_suburb, v_alias)
      ON CONFLICT (suburb_id, alias_key) DO NOTHING;
      IF v_suburb_state = 'none' THEN
        v_suburb_state := 'alias';
      END IF;
    END IF;
  ELSE
    IF v_src_suburb.id IS NOT NULL AND v_src_suburb.status IN ('requested', 'active') THEN
      UPDATE public.suburbs SET status = 'active' WHERE id = v_src_suburb.id AND status = 'requested';
      v_tgt_suburb := v_src_suburb.id;
    ELSE
      v_tgt_suburb := public.places_ensure_suburb(v_tgt_city, src.settings_json->>'watch_area');
    END IF;
    IF v_tgt_suburb IS NOT NULL THEN
      UPDATE public.organizations SET primary_suburb_id = v_tgt_suburb WHERE id = tgt.id;
      INSERT INTO public.organization_suburbs (organization_id, suburb_id, assignment_type, active)
      VALUES (tgt.id, v_tgt_suburb, 'primary', true)
      ON CONFLICT (organization_id, suburb_id) DO UPDATE SET active = true;
      v_suburb_state := 'linked';
    END IF;
  END IF;

  -- 2. The requesters: pending members of the existing watch (D9). Admin-role requesters
  --    lose any admin role the request gave them, exactly as on reject.
  FOR r IN
    SELECT om.user_id, om.member_role
    FROM public.organization_members om
    WHERE om.organization_id = src.id
      AND om.status IN ('pending', 'active')
  LOOP
    UPDATE public.organization_members SET status = 'suspended'
    WHERE organization_id = src.id AND user_id = r.user_id;

    UPDATE public.users u
    SET
      role = CASE
        WHEN r.member_role IN ('nw_admin', 'security_admin')
         AND public.signup_admin_role_key(u.role::text) = r.member_role
         AND NOT EXISTS (
           SELECT 1 FROM public.organization_members om2
           WHERE om2.user_id = u.id
             AND om2.organization_id <> src.id
             AND om2.status = 'active'
             AND om2.member_role = r.member_role
             AND NOT public.org_access_blocked(om2.organization_id)
         )
        THEN 'resident'
        ELSE u.role
      END,
      organization_id = CASE WHEN u.organization_id = src.id THEN NULL ELSE u.organization_id END,
      active_organization_id = CASE WHEN u.active_organization_id = src.id THEN NULL ELSE u.active_organization_id END
    WHERE u.id = r.user_id;

    IF EXISTS (SELECT 1 FROM public.organization_members om
               WHERE om.organization_id = tgt.id AND om.user_id = r.user_id AND om.status IN ('active', 'pending')) THEN
      v_moved := v_moved + 1;  -- already there (member or waiting)
      CONTINUE;
    END IF;

    v_current := public.places_current_watch(r.user_id);
    IF v_current IS NOT NULL THEN
      v_busy := v_busy + 1;    -- joined another watch meanwhile: left as is
      CONTINUE;
    END IF;

    v_role := public.places_join_member_role(r.user_id);
    IF v_role IS NULL THEN
      v_skipped := v_skipped + 1;  -- staff or partner account: not added
      CONTINUE;
    END IF;

    INSERT INTO public.organization_members (organization_id, user_id, member_role, status)
    VALUES (tgt.id, r.user_id, v_role, 'pending')
    ON CONFLICT (organization_id, user_id) DO UPDATE
      SET status = 'pending', member_role = EXCLUDED.member_role, joined_at = now()
      WHERE public.organization_members.status NOT IN ('active', 'pending');
    v_moved := v_moved + 1;
  END LOOP;

  -- 3. Close the duplicate request (frees the name, like reject; the review trigger leaves
  --    the suburb alone because the state is 'merged', not 'rejected').
  UPDATE public.organization_suburbs SET active = false WHERE organization_id = src.id;
  UPDATE public.organizations
  SET status = 'suspended',
      name = left(name, 150) || ' (merged ' || substr(id::text, 1, 8) || ')',
      settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'review_state', 'merged',
        'reviewed_at', now(),
        'reviewed_by', auth.uid(),
        'review_note', note,
        'original_name', src.name,
        'merged_into_org_id', tgt.id,
        'merged_into_name', tgt.name
      ))
  WHERE id = src.id;

  RETURN jsonb_build_object(
    'status', 'merged',
    'organization_id', src.id,
    'into_organization_id', tgt.id,
    'into_name', tgt.name,
    'suburb', v_suburb_state,
    'moved', v_moved,
    'already_in_other_watch', v_busy,
    'not_added', v_skipped
  );
END;
$$;
REVOKE ALL ON FUNCTION public.merge_suburb_request(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_suburb_request(uuid, uuid, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.merge_suburb_request(uuid, uuid, text) IS
  'SA places P5: reviewers merge a pending watch / suburb request into an approved watch in the same city. Requesters become pending members there (D9); the suburb spelling becomes an alias; the duplicate is closed.';

-- ---------------------------------------------------------------------------
-- Join requests for a watch's own admins (and reviewers)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_watch_join_requests()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reviewer boolean;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in to see join requests.' USING ERRCODE = '42501';
  END IF;
  v_reviewer := public.can_review_organization_requests();

  SELECT coalesce(jsonb_agg(x.item ORDER BY x.joined_at), '[]'::jsonb) INTO v_out
  FROM (
    SELECT om.joined_at,
           jsonb_build_object(
             'organization_id', o.id,
             'organization_name', o.name,
             'user_id', u.id,
             'name', coalesce(nullif(btrim(u.full_name), ''), u.email::text, 'Member'),
             'email', u.email::text,
             'phone', u.phone,
             'member_role', om.member_role,
             'requested_at', om.joined_at,
             'from_request', (
               SELECT coalesce(nullif(src.settings_json->>'watch_area', ''), src.settings_json->>'original_name')
               FROM public.organizations src
               JOIN public.organization_members som ON som.organization_id = src.id AND som.user_id = u.id
               WHERE src.settings_json->>'merged_into_org_id' = o.id::text
               ORDER BY src.created_at DESC
               LIMIT 1
             )
           ) AS item
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    JOIN public.users u ON u.id = om.user_id
    WHERE om.status = 'pending'
      AND om.member_role IN ('resident', 'patroller')
      AND o.type = 'nw_group'
      AND o.status = 'active'
      AND (v_reviewer OR public.is_org_nw_admin(o.id))
    ORDER BY om.joined_at
    LIMIT 200
  ) x;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.list_watch_join_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_watch_join_requests() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.review_watch_join(
  p_org_id uuid,
  p_user_id uuid,
  p_approve boolean,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org record;
  v_name text;
  v_current uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in to review join requests.' USING ERRCODE = '42501';
  END IF;

  SELECT o.id, o.name, o.primary_suburb_id INTO v_org
  FROM public.organizations o
  WHERE o.id = p_org_id AND o.type = 'nw_group' AND o.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That watch isn''t available right now. Refresh the list.' USING ERRCODE = '22023';
  END IF;

  IF NOT (public.can_review_organization_requests() OR public.is_org_nw_admin(p_org_id)) THEN
    RAISE EXCEPTION 'Only this watch''s admins or platform staff can review join requests.' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.organization_members om
  WHERE om.organization_id = p_org_id AND om.user_id = p_user_id
    AND om.status = 'pending' AND om.member_role IN ('resident', 'patroller')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is nothing waiting for approval here. Refresh the list.' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(nullif(btrim(u.full_name), ''), 'This person') INTO v_name FROM public.users u WHERE u.id = p_user_id;

  IF coalesce(p_approve, false) THEN
    v_current := public.places_current_watch(p_user_id);
    IF v_current IS NOT NULL AND v_current <> p_org_id THEN
      RAISE EXCEPTION '% has already joined another watch. Decline this request instead.', v_name USING ERRCODE = '22023';
    END IF;
    UPDATE public.organization_members SET status = 'active'
    WHERE organization_id = p_org_id AND user_id = p_user_id;
    UPDATE public.users
    SET organization_id = coalesce(organization_id, p_org_id),
        active_organization_id = coalesce(active_organization_id, p_org_id),
        home_suburb_id = coalesce(home_suburb_id, v_org.primary_suburb_id)
    WHERE id = p_user_id;
    RETURN jsonb_build_object('status', 'approved', 'organization_id', p_org_id, 'user_id', p_user_id, 'name', v_name);
  END IF;

  UPDATE public.organization_members SET status = 'suspended'
  WHERE organization_id = p_org_id AND user_id = p_user_id;
  RETURN jsonb_build_object('status', 'declined', 'organization_id', p_org_id, 'user_id', p_user_id, 'name', v_name);
END;
$$;
REVOKE ALL ON FUNCTION public.review_watch_join(uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_watch_join(uuid, uuid, boolean, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Requesters' own status: also "merged" (and into what)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_organization_requests()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'organization_id', o.id,
           'name', coalesce(nullif(o.settings_json->>'original_name', ''), o.name),
           'type', o.type,
           'requested_role', om.member_role,
           'state', CASE
             WHEN om.status = 'pending' THEN 'pending'
             WHEN coalesce(o.settings_json->>'review_state', '') = 'merged' THEN 'merged'
             ELSE 'not_approved'
           END,
           'merged_into', CASE WHEN coalesce(o.settings_json->>'review_state', '') = 'merged'
                               THEN nullif(o.settings_json->>'merged_into_name', '') END,
           'requested_at', om.joined_at
         ) ORDER BY om.joined_at DESC), '[]'::jsonb)
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.user_id = auth.uid()
    AND om.member_role IN ('nw_admin', 'security_admin')
    AND (
      om.status = 'pending'
      OR (om.status = 'suspended' AND coalesce(o.settings_json->>'review_state', '') IN ('rejected', 'merged'))
    );
$$;
REVOKE ALL ON FUNCTION public.my_organization_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_organization_requests() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.my_suburb_requests()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'suburb_id', s.id,
           'suburb', s.name,
           'city', c.name,
           'state', CASE s.status WHEN 'requested' THEN 'pending' WHEN 'active' THEN 'approved'
                                  WHEN 'merged' THEN 'merged' ELSE 'not_approved' END,
           'merged_into', CASE WHEN s.status = 'merged' THEN m.name END,
           'requested_at', s.created_at
         ) ORDER BY s.created_at DESC), '[]'::jsonb)
  FROM public.suburbs s
  LEFT JOIN public.cities c ON c.id = s.city_id
  LEFT JOIN public.suburbs m ON m.id = s.merged_into_id
  WHERE auth.uid() IS NOT NULL
    AND s.requested_by = auth.uid()
    AND s.source = 'member';
$$;
REVOKE ALL ON FUNCTION public.my_suburb_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_suburb_requests() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.places_org_city(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.places_request_duplicates(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Final check
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  problems text[] := ARRAY[]::text[];
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.list_organization_requests()'),
      ('public.merge_suburb_request(uuid,uuid,text)'),
      ('public.list_watch_join_requests()'),
      ('public.review_watch_join(uuid,uuid,boolean,text)'),
      ('public.my_organization_requests()'),
      ('public.my_suburb_requests()')
    ) AS t(sig)
  LOOP
    IF to_regprocedure(r.sig) IS NULL THEN
      problems := problems || (r.sig || ' missing');
      CONTINUE;
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(r.sig)) THEN
      problems := problems || (r.sig || ' is not SECURITY DEFINER');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) cfg
                   WHERE p.oid = to_regprocedure(r.sig) AND cfg LIKE 'search_path=%') THEN
      problems := problems || (r.sig || ' has no fixed search_path');
    END IF;
    IF has_function_privilege('anon', r.sig, 'EXECUTE') THEN
      problems := problems || (r.sig || ' callable by anon');
    END IF;
    IF NOT has_function_privilege('authenticated', r.sig, 'EXECUTE') THEN
      problems := problems || (r.sig || ' not callable by signed-in users');
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM (VALUES ('public.places_org_city(uuid)'), ('public.places_request_duplicates(uuid)')) AS t(sig) LOOP
    IF to_regprocedure(r.sig) IS NULL THEN
      problems := problems || (r.sig || ' missing');
    ELSIF has_function_privilege('authenticated', r.sig, 'EXECUTE') OR has_function_privilege('anon', r.sig, 'EXECUTE') THEN
      problems := problems || (r.sig || ' callable by clients');
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'organizations_suburb_on_review'
                 AND tgrelid = 'public.organizations'::regclass) THEN
    problems := problems || 'organizations_suburb_on_review trigger missing'::text;
  END IF;

  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION 'SA places P5: check failed: %.', array_to_string(problems, '; ');
  END IF;
  RAISE NOTICE 'SA places P5: OK';
END
$verify$;

NOTIFY pgrst, 'reload schema';
