-- Phase P3: SA places search, watch list and suburb requests
--
-- Adds the RPCs behind the new "Where do you live?" flow:
--   * search_cities(q, limit)        anyone (sign-up): South African cities and towns by name
--                                    or old name / alternate spelling, biggest first.
--                                    Matching an old name returns "formerly" (Port Elizabeth ->
--                                    Gqeberha, Grahamstown -> Makhanda, Louis Trichardt -> Makhado).
--   * list_city_watches(city)        signed-in only (D6): approved watches in that city, name and
--                                    suburb only. No member counts, no size, no contacts.
--   * suggest_suburbs(city, q)       signed-in only: existing suburbs in that city that match or are
--                                    spelled closely (prefix + pg_trgm), so people join instead of
--                                    creating a duplicate.
--   * join_watch(org)                signed-in resident / patroller joins an approved watch (same
--                                    rule as choosing an area at sign-up today: active resident).
--   * request_suburb_or_watch(...)   signed-in: asks for a new suburb (and its watch) after an
--                                    explicit "it's not one of these". Goes to the existing approval
--                                    queue (pending org, review_state 'requested'); no access until
--                                    approved. Exact duplicates return the existing suburb instead.
--                                    At most 3 open requests per person.
--   * my_suburb_requests()           signed-in: the caller's own suburb requests and their state.
--   * Approval / rejection of a watch (approve_organization, reject_organization or a console edit)
--     now also activates or rejects its requested suburb, joins pending resident requesters, and
--     creates the suburb for an approved watch that only has a typed watch area (D7).
--   * D7 backfill: approved watches with a typed watch area but no suburb record get one.
--
-- Additive and idempotent; safe to run twice. Needs the SA places schema (P1) and seed (P2).
-- Ends with NOTICE 'SA places P3: OK'.

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
      ('users', 'id'), ('users', 'role'), ('users', 'organization_id'), ('users', 'active_organization_id'),
      ('users', 'home_suburb_id'),
      ('countries', 'iso2'), ('countries', 'active'),
      ('provinces', 'code'), ('provinces', 'name'),
      ('cities', 'id'), ('cities', 'name'), ('cities', 'name_key'), ('cities', 'province_code'),
      ('cities', 'country_iso2'), ('cities', 'population'), ('cities', 'near_label'), ('cities', 'place_type'),
      ('cities', 'status'), ('cities', 'geonames_id'),
      ('city_aliases', 'city_id'), ('city_aliases', 'alias'), ('city_aliases', 'alias_key'), ('city_aliases', 'kind'),
      ('suburbs', 'id'), ('suburbs', 'city_id'), ('suburbs', 'name'), ('suburbs', 'name_key'), ('suburbs', 'status'),
      ('suburbs', 'source'), ('suburbs', 'requested_by'), ('suburbs', 'merged_into_id'), ('suburbs', 'created_at'),
      ('suburb_aliases', 'suburb_id'), ('suburb_aliases', 'alias_key'),
      ('organizations', 'id'), ('organizations', 'name'), ('organizations', 'type'), ('organizations', 'status'),
      ('organizations', 'city_id'), ('organizations', 'primary_suburb_id'), ('organizations', 'settings_json'),
      ('organizations', 'subscription_tier'),
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
      ('public.place_name_key(text)'),
      ('public.is_global_app_staff()'),
      ('public.is_platform_staff()'),
      ('public.org_access_blocked(uuid)'),
      ('public.default_city_id()'),
      ('public.promote_org_requesters(uuid,uuid)'),
      ('public.approve_organization(uuid,uuid,text)'),
      ('public.reject_organization(uuid,uuid,text)'),
      ('public.list_organization_requests()')
    ) AS t(sig)
  LOOP
    IF to_regprocedure(r.sig) IS NULL THEN
      missing := missing || (r.sig || ' function');
    END IF;
  END LOOP;

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
    RAISE EXCEPTION 'SA places P3: not applied, missing %. Nothing was changed.',
      array_to_string(missing, ', ');
  END IF;

  IF to_regclass('public.suburbs_city_name_key_live_uidx') IS NULL THEN
    RAISE NOTICE 'Heads-up: suburbs_city_name_key_live_uidx is missing (repeated suburb spellings in one city). Requests still check for duplicates.';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- Tidy a typed place name: trim, single spaces, at most 80 characters.
CREATE OR REPLACE FUNCTION public.places_clean_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 80);
$$;
REVOKE ALL ON FUNCTION public.places_clean_name(text) FROM PUBLIC, anon, authenticated;

-- The member role a signed-in person gets when joining a watch, or NULL if their
-- account type does not join watches this way (staff, admins, security partners).
CREATE OR REPLACE FUNCTION public.places_join_member_role(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE replace(lower(btrim(coalesce(u.role::text, ''))), '-', '_')
           WHEN '' THEN 'resident'
           WHEN 'user' THEN 'resident'
           WHEN 'resident' THEN 'resident'
           WHEN 'patroller' THEN 'patroller'
           WHEN 'volunteer' THEN 'patroller'
           ELSE NULL
         END
  FROM public.users u
  WHERE u.id = p_user_id;
$$;
REVOKE ALL ON FUNCTION public.places_join_member_role(uuid) FROM PUBLIC, anon, authenticated;

-- The approved watch the person already belongs to, if any.
CREATE OR REPLACE FUNCTION public.places_current_watch(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.user_id = p_user_id
    AND om.status = 'active'
    AND o.type = 'nw_group'
    AND o.status = 'active'
  ORDER BY om.joined_at
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.places_current_watch(uuid) FROM PUBLIC, anon, authenticated;

-- Approved watches for one suburb (primary or linked). Name only.
CREATE OR REPLACE FUNCTION public.places_suburb_watches(p_suburb_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'organization_id', w.id,
           'name', w.name,
           'my_status', w.my_status
         ) ORDER BY lower(w.name)), '[]'::jsonb)
  FROM (
    SELECT DISTINCT o.id, o.name,
           (SELECT om.status FROM public.organization_members om
             WHERE om.organization_id = o.id AND om.user_id = p_user_id
               AND om.status IN ('active', 'pending')) AS my_status
    FROM public.organizations o
    WHERE o.type = 'nw_group'
      AND o.status = 'active'
      AND (
        o.primary_suburb_id = p_suburb_id
        OR EXISTS (
          SELECT 1 FROM public.organization_suburbs os
          WHERE os.organization_id = o.id AND os.suburb_id = p_suburb_id AND os.active
        )
      )
  ) w;
$$;
REVOKE ALL ON FUNCTION public.places_suburb_watches(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Find or create the live suburb for a typed name in a city (used on approval and in the backfill).
CREATE OR REPLACE FUNCTION public.places_ensure_suburb(p_city_id uuid, p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := public.places_clean_name(p_name);
  v_key text := public.place_name_key(public.places_clean_name(p_name));
  v_id uuid;
BEGIN
  IF p_city_id IS NULL OR length(v_key) < 2 THEN
    RETURN NULL;
  END IF;

  SELECT s.id INTO v_id
  FROM public.suburbs s
  WHERE s.city_id = p_city_id AND s.name_key = v_key AND s.status IN ('active', 'requested')
  ORDER BY (s.status = 'active') DESC, s.created_at
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.suburbs SET status = 'active' WHERE id = v_id AND status = 'requested';
    RETURN v_id;
  END IF;

  -- A rejected or merged row with the exact same spelling is brought back
  -- (UNIQUE (city_id, name) would block a second row).
  UPDATE public.suburbs
  SET status = 'active', merged_into_id = NULL
  WHERE city_id = p_city_id AND name = v_name AND status IN ('rejected', 'merged')
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.suburbs (city_id, name, status, source)
  VALUES (p_city_id, v_name, 'active', 'admin')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.places_ensure_suburb(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- search_cities: anyone (needed on the sign-up form)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_cities(p_q text, p_limit integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  k text := public.place_name_key(left(coalesce(p_q, ''), 80));
  lim integer := least(greatest(coalesce(p_limit, 10), 1), 20);
  v_out jsonb;
BEGIN
  IF length(k) < 2 THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH live AS (
    SELECT c.id, c.name, c.name_key, c.province_code, c.near_label, c.place_type, c.population
    FROM public.cities c
    JOIN public.countries co ON co.iso2 = c.country_iso2 AND co.active
    WHERE c.status = 'active' AND c.country_iso2 = 'ZA'
  ),
  hits AS (
    SELECT l.id,
           CASE WHEN l.name_key = k THEN 0
                WHEN l.name_key LIKE k || '%' THEN 1
                WHEN l.name_key LIKE '% ' || k || '%' THEN 2
                ELSE 3 END AS rank,
           similarity(l.name_key, k) AS sim,
           NULL::text AS alias,
           NULL::text AS alias_kind
    FROM live l
    WHERE l.name_key LIKE k || '%'
       OR l.name_key LIKE '% ' || k || '%'
       OR (length(k) >= 3 AND similarity(l.name_key, k) >= 0.4)
    UNION ALL
    SELECT a.city_id,
           CASE WHEN a.alias_key = k THEN 0
                WHEN a.alias_key LIKE k || '%' THEN 1
                WHEN a.alias_key LIKE '% ' || k || '%' THEN 2
                ELSE 3 END,
           similarity(a.alias_key, k),
           a.alias,
           a.kind
    FROM public.city_aliases a
    JOIN live l ON l.id = a.city_id
    WHERE a.alias_key LIKE k || '%'
       OR a.alias_key LIKE '% ' || k || '%'
       OR (length(k) >= 3 AND similarity(a.alias_key, k) >= 0.4)
  ),
  -- One row per city: its best match, preferring its own name over an alias.
  -- Exact, then starts-with, then a word inside, then a close spelling; the
  -- biggest place first within each group (Witbank -> eMalahleni before a
  -- village also called Witbank).
  best AS (
    SELECT DISTINCT ON (h.id) h.*
    FROM hits h
    ORDER BY h.id, h.rank, (h.alias IS NOT NULL), h.sim DESC
  ),
  top AS (
    SELECT b.rank, b.alias, b.alias_kind, l.*
    FROM best b
    JOIN live l ON l.id = b.id
    ORDER BY b.rank, l.population DESC, l.name, l.id
    LIMIT lim
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'name', t.name,
           'province', p.name,
           'province_code', t.province_code,
           'near_label', t.near_label,
           'place_type', t.place_type,
           'formerly', CASE WHEN t.alias_kind = 'old_name' THEN t.alias END,
           'also_known_as', CASE WHEN t.alias_kind = 'alternate' THEN t.alias END
         ) ORDER BY t.rank, t.population DESC, t.name, t.id), '[]'::jsonb)
    INTO v_out
  FROM top t
  LEFT JOIN public.provinces p ON p.code = t.province_code;

  RETURN v_out;
END;
$$;
COMMENT ON FUNCTION public.search_cities(text, integer) IS
  'SA places P3: South African cities and towns by name, old name or alternate spelling; biggest first. Returns id, name, province, near_label, formerly / also_known_as.';

-- ---------------------------------------------------------------------------
-- list_city_watches: signed-in only (D6). Name and suburb only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_city_watches(p_city_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in to see the watches in your city.' USING ERRCODE = '42501';
  END IF;
  IF p_city_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'organization_id', w.id,
           'name', w.name,
           'suburb', w.suburb,
           'my_status', w.my_status
         ) ORDER BY lower(coalesce(w.suburb, w.name)), lower(w.name)), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT o.id, o.name, s.name AS suburb,
           (SELECT om.status FROM public.organization_members om
             WHERE om.organization_id = o.id AND om.user_id = v_uid
               AND om.status IN ('active', 'pending')) AS my_status
    FROM public.organizations o
    LEFT JOIN public.suburbs s ON s.id = o.primary_suburb_id AND s.status = 'active'
    WHERE o.type = 'nw_group'
      AND o.status = 'active'
      AND (o.city_id = p_city_id OR s.city_id = p_city_id)
    ORDER BY lower(coalesce(s.name, o.name)), lower(o.name)
    LIMIT 300
  ) w;

  RETURN v_out;
END;
$$;
COMMENT ON FUNCTION public.list_city_watches(uuid) IS
  'SA places P3: approved watches in a city for signed-in people. Name and suburb only (plus the caller''s own membership state).';

-- ---------------------------------------------------------------------------
-- suggest_suburbs: signed-in only. Exact, prefix and close spellings.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.suggest_suburbs(p_city_id uuid, p_q text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  k text := public.place_name_key(public.places_clean_name(p_q));
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in to look up suburbs.' USING ERRCODE = '42501';
  END IF;
  IF p_city_id IS NULL OR length(k) < 2 THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH hits AS (
    SELECT s.id,
           CASE WHEN s.name_key = k THEN 0
                WHEN s.name_key LIKE k || '%' THEN 1
                WHEN s.name_key LIKE '% ' || k || '%' THEN 2
                ELSE 3 END AS rank,
           greatest(similarity(s.name_key, k), word_similarity(k, s.name_key)) AS sim
    FROM public.suburbs s
    WHERE s.city_id = p_city_id
      AND s.status IN ('active', 'requested')
      AND (
        s.name_key LIKE k || '%'
        OR s.name_key LIKE '% ' || k || '%'
        OR (length(k) >= 3 AND (similarity(s.name_key, k) >= 0.35 OR word_similarity(k, s.name_key) >= 0.6))
      )
    UNION ALL
    SELECT s.id,
           CASE WHEN a.alias_key = k THEN 0
                WHEN a.alias_key LIKE k || '%' THEN 1
                WHEN a.alias_key LIKE '% ' || k || '%' THEN 2
                ELSE 3 END,
           greatest(similarity(a.alias_key, k), word_similarity(k, a.alias_key))
    FROM public.suburb_aliases a
    JOIN public.suburbs s ON s.id = a.suburb_id
    WHERE s.city_id = p_city_id
      AND s.status = 'active'
      AND (
        a.alias_key LIKE k || '%'
        OR a.alias_key LIKE '% ' || k || '%'
        OR (length(k) >= 3 AND (similarity(a.alias_key, k) >= 0.35 OR word_similarity(k, a.alias_key) >= 0.6))
      )
  ),
  best AS (
    SELECT DISTINCT ON (h.id) h.*
    FROM hits h
    ORDER BY h.id, h.rank, h.sim DESC
  ),
  top AS (
    SELECT b.rank, b.sim, s.id, s.name, s.status
    FROM best b
    JOIN public.suburbs s ON s.id = b.id
    ORDER BY b.rank, b.sim DESC, lower(s.name), s.id
    LIMIT 8
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'suburb_id', t.id,
           'name', t.name,
           'match', CASE t.rank WHEN 0 THEN 'exact' WHEN 3 THEN 'similar' ELSE 'prefix' END,
           'state', CASE WHEN t.status = 'active' THEN 'active' ELSE 'being_set_up' END,
           'watches', CASE WHEN t.status = 'active' THEN public.places_suburb_watches(t.id, v_uid) ELSE '[]'::jsonb END
         ) ORDER BY t.rank, t.sim DESC, lower(t.name), t.id), '[]'::jsonb)
    INTO v_out
  FROM top t;

  RETURN v_out;
END;
$$;
COMMENT ON FUNCTION public.suggest_suburbs(uuid, text) IS
  'SA places P3: suburbs in a city matching a typed name (exact, prefix, close spelling) with their approved watches. Requested suburbs show as being set up, without who asked.';

-- ---------------------------------------------------------------------------
-- join_watch: a signed-in resident or patroller joins an approved watch
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_watch(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_org record;
  v_mine text;
  v_current uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in to join a watch.' USING ERRCODE = '42501';
  END IF;

  SELECT o.id, o.name, o.primary_suburb_id INTO v_org
  FROM public.organizations o
  WHERE o.id = p_org_id AND o.type = 'nw_group' AND o.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That watch isn''t taking new members right now. Refresh the list.' USING ERRCODE = '22023';
  END IF;

  SELECT om.status INTO v_mine
  FROM public.organization_members om
  WHERE om.organization_id = p_org_id AND om.user_id = v_uid;
  IF v_mine = 'active' THEN
    RETURN jsonb_build_object('status', 'already_member', 'organization_id', v_org.id, 'name', v_org.name);
  ELSIF v_mine = 'pending' THEN
    RETURN jsonb_build_object('status', 'pending', 'organization_id', v_org.id, 'name', v_org.name);
  ELSIF v_mine IS NOT NULL THEN
    RAISE EXCEPTION 'Please ask the watch admins to add you back to this watch.' USING ERRCODE = '22023';
  END IF;

  v_role := public.places_join_member_role(v_uid);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Your account type can''t join a watch here. Please ask support to add you.' USING ERRCODE = '42501';
  END IF;

  v_current := public.places_current_watch(v_uid);
  IF v_current IS NOT NULL THEN
    RAISE EXCEPTION 'You''re already in a watch. If you''ve moved, please ask support to move you.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.organization_members (organization_id, user_id, member_role, status)
  VALUES (v_org.id, v_uid, v_role, 'active')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  UPDATE public.users
  SET organization_id = coalesce(organization_id, v_org.id),
      active_organization_id = coalesce(active_organization_id, v_org.id),
      home_suburb_id = coalesce(home_suburb_id, v_org.primary_suburb_id)
  WHERE id = v_uid;

  RETURN jsonb_build_object('status', 'joined', 'organization_id', v_org.id, 'name', v_org.name);
END;
$$;
COMMENT ON FUNCTION public.join_watch(uuid) IS
  'SA places P3: a signed-in resident or patroller joins an approved watch (same rule as choosing an area at sign-up). One watch per person.';

-- ---------------------------------------------------------------------------
-- request_suburb_or_watch: new suburb (and its watch) for approval
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_suburb_or_watch(
  p_city_id uuid,
  p_suburb_name text,
  p_confirm_not_listed boolean DEFAULT false,
  p_start_watch boolean DEFAULT false,
  p_watch_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := public.places_clean_name(p_suburb_name);
  v_key text := public.place_name_key(public.places_clean_name(p_suburb_name));
  v_city record;
  v_role text;
  v_member_role text;
  v_existing record;
  v_suggestions jsonb;
  v_open integer;
  v_suburb uuid;
  v_watch text;
  v_org uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in to ask for a new suburb.' USING ERRCODE = '42501';
  END IF;

  SELECT c.id, c.name INTO v_city
  FROM public.cities c
  WHERE c.id = p_city_id AND c.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose your city from the list first.' USING ERRCODE = '22023';
  END IF;

  IF length(v_key) < 2 OR length(v_name) < 2 THEN
    RAISE EXCEPTION 'Enter your suburb''s name (2 to 80 characters).' USING ERRCODE = '22023';
  END IF;

  v_role := public.places_join_member_role(v_uid);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Your account type can''t ask for a suburb here. Please ask support.' USING ERRCODE = '42501';
  END IF;
  IF public.places_current_watch(v_uid) IS NOT NULL THEN
    RAISE EXCEPTION 'You''re already in a watch. If you''ve moved, please ask support to move you.' USING ERRCODE = '22023';
  END IF;

  -- Exact spelling already there (approved or being set up): return it, create nothing.
  SELECT s.id, s.name, s.status INTO v_existing
  FROM public.suburbs s
  WHERE s.city_id = v_city.id AND s.name_key = v_key AND s.status IN ('active', 'requested')
  ORDER BY (s.status = 'active') DESC, s.created_at
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'exists',
      'suburb_id', v_existing.id,
      'name', v_existing.name,
      'state', CASE WHEN v_existing.status = 'active' THEN 'active' ELSE 'being_set_up' END,
      'watches', CASE WHEN v_existing.status = 'active'
                      THEN public.places_suburb_watches(v_existing.id, v_uid) ELSE '[]'::jsonb END
    );
  END IF;

  -- Close spellings: the person must say "it's not one of these" first.
  v_suggestions := public.suggest_suburbs(v_city.id, v_name);
  IF jsonb_array_length(v_suggestions) > 0 AND NOT coalesce(p_confirm_not_listed, false) THEN
    RETURN jsonb_build_object('status', 'confirm_needed', 'suggestions', v_suggestions);
  END IF;

  SELECT count(*) INTO v_open
  FROM public.suburbs s
  WHERE s.requested_by = v_uid AND s.status = 'requested';
  IF v_open >= 3 THEN
    RAISE EXCEPTION 'You already have 3 suburb requests waiting. We''ll let you know once they''re reviewed.' USING ERRCODE = '22023';
  END IF;

  -- The suburb, waiting for approval (hidden from everyone until then).
  UPDATE public.suburbs
  SET status = 'requested', source = 'member', requested_by = v_uid, merged_into_id = NULL
  WHERE city_id = v_city.id AND name = v_name AND status IN ('rejected', 'merged')
  RETURNING id INTO v_suburb;
  IF v_suburb IS NULL THEN
    INSERT INTO public.suburbs (city_id, name, status, source, requested_by)
    VALUES (v_city.id, v_name, 'requested', 'member', v_uid)
    RETURNING id INTO v_suburb;
  END IF;

  -- Its watch, in the existing approval queue (pending, review_state 'requested').
  v_watch := left(coalesce(nullif(public.places_clean_name(p_watch_name), ''), v_name || ' Neighbourhood Watch'), 120);
  IF EXISTS (SELECT 1 FROM public.organizations o WHERE lower(o.name) = lower(v_watch)) THEN
    v_watch := v_watch || ' — pending ' || substr(v_uid::text, 1, 8);
  END IF;
  v_member_role := CASE WHEN coalesce(p_start_watch, false) THEN 'nw_admin' ELSE v_role END;

  INSERT INTO public.organizations (name, type, status, subscription_tier, city_id, primary_suburb_id, settings_json)
  VALUES (
    v_watch, 'nw_group', 'pending', 'beta', v_city.id, v_suburb,
    jsonb_build_object(
      'source', 'suburb_request',
      'watch_area', v_name,
      'review_state', 'requested',
      'requested_by', v_uid,
      'requested_at', now(),
      'requested_role', v_member_role
    )
  )
  RETURNING id INTO v_org;

  INSERT INTO public.organization_suburbs (organization_id, suburb_id, assignment_type, active)
  VALUES (v_org, v_suburb, 'primary', true)
  ON CONFLICT (organization_id, suburb_id) DO NOTHING;

  INSERT INTO public.organization_members (organization_id, user_id, member_role, status)
  VALUES (v_org, v_uid, v_member_role, 'pending')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  RETURN jsonb_build_object(
    'status', 'requested',
    'suburb_id', v_suburb,
    'suburb', v_name,
    'organization_id', v_org,
    'watch_name', v_watch,
    'city', v_city.name
  );
END;
$$;
COMMENT ON FUNCTION public.request_suburb_or_watch(uuid, text, boolean, boolean, text) IS
  'SA places P3: asks for a new suburb and its watch (approval queue). Exact duplicates return the existing suburb; close spellings need p_confirm_not_listed; 3 open requests per person.';

-- The caller's own suburb requests (for the "waiting for approval" note).
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
           'requested_at', s.created_at
         ) ORDER BY s.created_at DESC), '[]'::jsonb)
  FROM public.suburbs s
  LEFT JOIN public.cities c ON c.id = s.city_id
  WHERE auth.uid() IS NOT NULL
    AND s.requested_by = auth.uid()
    AND s.source = 'member';
$$;

-- ---------------------------------------------------------------------------
-- Approval / rejection of a watch also settles its suburb (D7)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_org_suburb_on_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_area text;
  v_city uuid;
  v_live uuid;
  r record;
BEGIN
  IF NEW.type <> 'nw_group' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'active' THEN
    v_city := coalesce(NEW.city_id, public.default_city_id());

    IF NEW.primary_suburb_id IS NOT NULL THEN
      -- The requested suburb goes live, unless the same spelling went live meanwhile.
      SELECT s2.id INTO v_live
      FROM public.suburbs s JOIN public.suburbs s2
        ON s2.city_id = s.city_id AND s2.name_key = s.name_key AND s2.id <> s.id AND s2.status = 'active'
      WHERE s.id = NEW.primary_suburb_id AND s.status = 'requested'
      LIMIT 1;
      IF v_live IS NOT NULL THEN
        UPDATE public.suburbs SET status = 'merged', merged_into_id = v_live WHERE id = NEW.primary_suburb_id;
        NEW.primary_suburb_id := v_live;
        INSERT INTO public.organization_suburbs (organization_id, suburb_id, assignment_type, active)
        VALUES (NEW.id, v_live, 'primary', true)
        ON CONFLICT (organization_id, suburb_id) DO NOTHING;
      ELSE
        UPDATE public.suburbs SET status = 'active' WHERE id = NEW.primary_suburb_id AND status = 'requested';
      END IF;
    ELSE
      -- A watch approved with only a typed area gets a suburb record.
      v_area := nullif(public.places_clean_name(NEW.settings_json->>'watch_area'), '');
      IF v_area IS NOT NULL THEN
        NEW.primary_suburb_id := public.places_ensure_suburb(v_city, v_area);
        IF NEW.primary_suburb_id IS NOT NULL THEN
          INSERT INTO public.organization_suburbs (organization_id, suburb_id, assignment_type, active)
          VALUES (NEW.id, NEW.primary_suburb_id, 'primary', true)
          ON CONFLICT (organization_id, suburb_id) DO NOTHING;
        END IF;
      END IF;
    END IF;

    -- Residents and patrollers who asked for this suburb join it now.
    -- (Someone who joined another watch in the meantime stays pending here.)
    FOR r IN
      SELECT om.user_id
      FROM public.organization_members om
      WHERE om.organization_id = NEW.id
        AND om.status = 'pending'
        AND om.member_role IN ('resident', 'patroller')
        AND public.places_current_watch(om.user_id) IS NULL
    LOOP
      UPDATE public.organization_members SET status = 'active'
      WHERE organization_id = NEW.id AND user_id = r.user_id;
      UPDATE public.users
      SET organization_id = coalesce(organization_id, NEW.id),
          active_organization_id = coalesce(active_organization_id, NEW.id),
          home_suburb_id = coalesce(home_suburb_id, NEW.primary_suburb_id)
      WHERE id = r.user_id;
    END LOOP;

  ELSIF NEW.status = 'suspended' AND OLD.status = 'pending'
        AND coalesce(NEW.settings_json->>'review_state', '') = 'rejected'
        AND NEW.primary_suburb_id IS NOT NULL THEN
    UPDATE public.suburbs SET status = 'rejected'
    WHERE id = NEW.primary_suburb_id AND status = 'requested';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_org_suburb_on_review() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS organizations_suburb_on_review ON public.organizations;
CREATE TRIGGER organizations_suburb_on_review
  BEFORE UPDATE OF status ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_org_suburb_on_review();

-- ---------------------------------------------------------------------------
-- D7 backfill: approved watches with a typed area but no suburb record
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE
  o record;
  v_suburb uuid;
  v_done text[] := ARRAY[]::text[];
  v_left text;
BEGIN
  FOR o IN
    SELECT org.id, org.name, coalesce(org.city_id, public.default_city_id()) AS city_id,
           nullif(public.places_clean_name(org.settings_json->>'watch_area'), '') AS area
    FROM public.organizations org
    WHERE org.type = 'nw_group'
      AND org.status = 'active'
      AND org.primary_suburb_id IS NULL
      AND nullif(public.places_clean_name(org.settings_json->>'watch_area'), '') IS NOT NULL
    ORDER BY org.name
  LOOP
    v_suburb := public.places_ensure_suburb(o.city_id, o.area);
    IF v_suburb IS NOT NULL THEN
      UPDATE public.organizations SET primary_suburb_id = v_suburb WHERE id = o.id;
      INSERT INTO public.organization_suburbs (organization_id, suburb_id, assignment_type, active)
      VALUES (o.id, v_suburb, 'primary', true)
      ON CONFLICT (organization_id, suburb_id) DO NOTHING;
      v_done := v_done || format('%s -> %s', o.name, o.area);
    END IF;
  END LOOP;

  RAISE NOTICE 'SA places P3: suburb records added for % approved watch(es)%', cardinality(v_done),
    CASE WHEN cardinality(v_done) > 0 THEN ': ' || array_to_string(v_done, '; ') ELSE '.' END;

  SELECT string_agg(org.name, ', ' ORDER BY org.name) INTO v_left
  FROM public.organizations org
  WHERE org.type = 'nw_group' AND org.status = 'active' AND org.primary_suburb_id IS NULL;
  IF v_left IS NOT NULL THEN
    RAISE NOTICE 'Heads-up: approved watches with no suburb yet (no typed area to use; set one under Organisations): %', v_left;
  END IF;
END
$backfill$;

-- ---------------------------------------------------------------------------
-- Grants: search for anyone; the rest for signed-in people only
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.places_join_member_role(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.places_current_watch(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.places_suburb_watches(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.places_ensure_suburb(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.places_clean_name(text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.search_cities(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_cities(text, integer) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_city_watches(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_city_watches(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.suggest_suburbs(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_suburbs(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.join_watch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_watch(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.request_suburb_or_watch(uuid, text, boolean, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_suburb_or_watch(uuid, text, boolean, boolean, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.my_suburb_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_suburb_requests() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Final check
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  problems text[] := ARRAY[]::text[];
  r record;
  v_first text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.search_cities(text,integer)', true),
      ('public.list_city_watches(uuid)', false),
      ('public.suggest_suburbs(uuid,text)', false),
      ('public.join_watch(uuid)', false),
      ('public.request_suburb_or_watch(uuid,text,boolean,boolean,text)', false),
      ('public.my_suburb_requests()', false)
    ) AS t(sig, anon_ok)
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
    IF has_function_privilege('anon', r.sig, 'EXECUTE') <> r.anon_ok THEN
      problems := problems || (r.sig || CASE WHEN r.anon_ok THEN ' not callable by anon' ELSE ' callable by anon' END);
    END IF;
    IF NOT has_function_privilege('authenticated', r.sig, 'EXECUTE') THEN
      problems := problems || (r.sig || ' not callable by signed-in users');
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM (VALUES ('public.places_join_member_role(uuid)'), ('public.places_current_watch(uuid)'),
                                  ('public.places_suburb_watches(uuid,uuid)'), ('public.places_ensure_suburb(uuid,text)'),
                                  ('public.trg_org_suburb_on_review()')) AS t(sig) LOOP
    IF has_function_privilege('authenticated', r.sig, 'EXECUTE') OR has_function_privilege('anon', r.sig, 'EXECUTE') THEN
      problems := problems || (r.sig || ' callable by clients');
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'organizations_suburb_on_review'
                 AND tgrelid = 'public.organizations'::regclass) THEN
    problems := problems || 'organizations_suburb_on_review trigger missing'::text;
  END IF;

  IF EXISTS (SELECT 1 FROM public.cities WHERE geonames_id = 964420) THEN
    SELECT public.search_cities('Port Elizabeth', 1)->0->>'name' INTO v_first;
    IF v_first IS DISTINCT FROM 'Gqeberha' THEN
      problems := problems || format('search_cities(''Port Elizabeth'') returned %s, expected Gqeberha', coalesce(v_first, 'nothing'));
    END IF;
  END IF;
  IF jsonb_array_length(public.search_cities('Nelson Mandela Bay', 5)) > 0
     AND (public.search_cities('Nelson Mandela Bay', 1)->0->>'name') ILIKE 'nelson mandela bay%' THEN
    problems := problems || 'search_cities returns the Nelson Mandela Bay municipality'::text;
  END IF;

  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION 'SA places P3: check failed: %. Nothing was changed.', array_to_string(problems, '; ');
  END IF;
  RAISE NOTICE 'SA places P3: OK';
END
$verify$;

NOTIFY pgrst, 'reload schema';
