-- Phase P4: SA places on Profile and Choose area
--
-- * users.home_city_id: the city or town a person lives in (any SA place from P2).
--   Filled once from what we already know: their suburb's city, else their watch's city,
--   else the city they picked at sign-up (auth user metadata home_city_id).
-- * my_home_area()            signed-in: your city, your watch (name + suburb only, never sizes
--                             or member counts), watches you're waiting to join, and whether
--                             your account type can change watch here.
-- * set_my_home_city(city)    signed-in: save your city (does not move you between watches).
-- * Joining a watch or getting a suburb fills an empty home city (trigger on users).
-- * switch_my_watch(org)      signed-in resident / patroller: move to another approved watch
--                             (same rule as joining: active straight away; one watch per person).
--                             Watch admins and committee members are refused (ask support).
--
-- Additive and idempotent; safe to run twice. Needs P1, P2, P3 and P5.
-- Ends with NOTICE 'SA places P4: OK'.

-- ---------------------------------------------------------------------------
-- Pre-check: list everything missing at once; change nothing if any is missing
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE
  missing text[] := ARRAY[]::text[];
  r record;
  v_places integer;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('users', 'id'), ('users', 'role'), ('users', 'organization_id'), ('users', 'active_organization_id'),
      ('users', 'home_suburb_id'),
      ('cities', 'id'), ('cities', 'name'), ('cities', 'province'), ('cities', 'province_code'),
      ('cities', 'near_label'), ('cities', 'status'), ('cities', 'geonames_id'),
      ('suburbs', 'id'), ('suburbs', 'city_id'), ('suburbs', 'name'), ('suburbs', 'status'),
      ('organizations', 'id'), ('organizations', 'name'), ('organizations', 'type'), ('organizations', 'status'),
      ('organizations', 'city_id'), ('organizations', 'primary_suburb_id'),
      ('organization_members', 'organization_id'), ('organization_members', 'user_id'),
      ('organization_members', 'member_role'), ('organization_members', 'status'), ('organization_members', 'joined_at')
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
      ('public.org_access_blocked(uuid)'),
      -- P3
      ('public.places_join_member_role(uuid)'),
      ('public.places_current_watch(uuid)'),
      ('public.list_city_watches(uuid)'),
      ('public.join_watch(uuid)'),
      ('public.my_suburb_requests()'),
      -- P5
      ('public.places_org_city(uuid)'),
      ('public.merge_suburb_request(uuid,uuid,text)'),
      ('public.review_watch_join(uuid,uuid,boolean,text)')
    ) AS t(sig)
  LOOP
    IF to_regprocedure(r.sig) IS NULL THEN
      missing := missing || (r.sig || ' function');
    END IF;
  END LOOP;

  IF to_regclass('public.cities') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'cities' AND column_name = 'geonames_id') THEN
    EXECUTE 'SELECT count(*) FROM public.cities WHERE geonames_id IS NOT NULL' INTO v_places;
    IF v_places < 10000 THEN
      missing := missing || format('the SA places seed (P2): %s places loaded, expected about 12 162', v_places);
    END IF;
  END IF;

  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'SA places P4: not applied, missing %. Nothing was changed.',
      array_to_string(missing, ', ');
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- users.home_city_id
-- ---------------------------------------------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS home_city_id uuid REFERENCES public.cities (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS users_home_city_id_idx ON public.users (home_city_id);
COMMENT ON COLUMN public.users.home_city_id IS
  'SA places P4: the city or town the person lives in. Set with set_my_home_city() or switch_my_watch().';

-- The city a person picked at sign-up (auth metadata), if it is a real active city.
CREATE OR REPLACE FUNCTION public.places_signup_city(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw text;
  v_id uuid;
BEGIN
  IF p_user_id IS NULL OR to_regclass('auth.users') IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE 'SELECT raw_user_meta_data->>''home_city_id'' FROM auth.users WHERE id = $1' INTO v_raw USING p_user_id;
  IF v_raw IS NULL OR v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  SELECT c.id INTO v_id FROM public.cities c WHERE c.id = v_raw::uuid AND c.status = 'active';
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.places_signup_city(uuid) FROM PUBLIC, anon, authenticated;

-- Best known city for a person: saved city, else suburb's, else watch's, else sign-up choice.
CREATE OR REPLACE FUNCTION public.places_user_city(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    u.home_city_id,
    (SELECT s.city_id FROM public.suburbs s WHERE s.id = u.home_suburb_id),
    public.places_org_city(public.places_current_watch(u.id)),
    public.places_org_city(u.organization_id),
    public.places_signup_city(u.id)
  )
  FROM public.users u
  WHERE u.id = p_user_id;
$$;
REVOKE ALL ON FUNCTION public.places_user_city(uuid) FROM PUBLIC, anon, authenticated;

-- Joining a watch or getting a suburb (sign-up, join, approval, staff assign) fills an empty home city.
CREATE OR REPLACE FUNCTION public.trg_users_fill_home_city()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.home_city_id IS NULL AND (NEW.home_suburb_id IS NOT NULL OR NEW.organization_id IS NOT NULL) THEN
    NEW.home_city_id := coalesce(
      (SELECT s.city_id FROM public.suburbs s WHERE s.id = NEW.home_suburb_id),
      public.places_org_city(NEW.organization_id)
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_users_fill_home_city() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS users_fill_home_city ON public.users;
CREATE TRIGGER users_fill_home_city
  BEFORE INSERT OR UPDATE OF home_suburb_id, organization_id ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_users_fill_home_city();

-- One-off fill for people who have no saved city yet.
DO $backfill$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.users u
  SET home_city_id = public.places_user_city(u.id)
  WHERE u.home_city_id IS NULL
    AND public.places_user_city(u.id) IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'SA places P4: home city filled for % account(s).', v_n;
END
$backfill$;

-- ---------------------------------------------------------------------------
-- my_home_area: what Profile and Choose area show
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_home_area()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_city uuid;
  v_watch uuid;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in to see your area.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_uid) THEN
    RETURN jsonb_build_object('city', NULL, 'watch', NULL, 'waiting', '[]'::jsonb, 'can_change_watch', false);
  END IF;

  v_city := public.places_user_city(v_uid);
  v_watch := public.places_current_watch(v_uid);

  SELECT jsonb_build_object(
    'city', (
      SELECT jsonb_build_object('id', c.id, 'name', c.name, 'province', c.province,
                                'province_code', c.province_code, 'near_label', c.near_label)
      FROM public.cities c WHERE c.id = v_city
    ),
    'city_saved', (SELECT u.home_city_id IS NOT NULL FROM public.users u WHERE u.id = v_uid),
    'watch', (
      SELECT jsonb_build_object('organization_id', o.id, 'name', o.name, 'suburb', s.name,
                                'city_id', public.places_org_city(o.id),
                                'my_role', om.member_role)
      FROM public.organizations o
      LEFT JOIN public.suburbs s ON s.id = o.primary_suburb_id AND s.status = 'active'
      LEFT JOIN public.organization_members om ON om.organization_id = o.id AND om.user_id = v_uid
      WHERE o.id = v_watch
    ),
    'waiting', coalesce((
      SELECT jsonb_agg(jsonb_build_object('organization_id', o.id, 'name', o.name, 'suburb', s.name)
                       ORDER BY om.joined_at DESC)
      FROM public.organization_members om
      JOIN public.organizations o ON o.id = om.organization_id
      LEFT JOIN public.suburbs s ON s.id = o.primary_suburb_id AND s.status = 'active'
      WHERE om.user_id = v_uid
        AND om.status = 'pending'
        AND o.type = 'nw_group'
        AND o.status = 'active'
    ), '[]'::jsonb),
    'can_change_watch', public.places_join_member_role(v_uid) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id = v_uid AND om.status = 'active' AND o.type = 'nw_group'
          AND om.member_role NOT IN ('resident', 'patroller')
      )
  ) INTO v_out;

  RETURN v_out;
END;
$$;
COMMENT ON FUNCTION public.my_home_area() IS
  'SA places P4: the caller''s city, watch (name + suburb only), watches they are waiting to join, and whether they can change watch.';

-- ---------------------------------------------------------------------------
-- set_my_home_city
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_my_home_city(p_city_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_city record;
  v_watch uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in to change your city.' USING ERRCODE = '42501';
  END IF;

  SELECT c.id, c.name INTO v_city
  FROM public.cities c
  WHERE c.id = p_city_id AND c.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose your city or town from the list.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.users SET home_city_id = v_city.id WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your profile isn''t set up yet. Please try again in a moment.' USING ERRCODE = '22023';
  END IF;

  v_watch := public.places_current_watch(v_uid);
  RETURN jsonb_build_object(
    'status', 'saved',
    'city_id', v_city.id,
    'city', v_city.name,
    'watch_in_other_city', v_watch IS NOT NULL
      AND public.places_org_city(v_watch) IS DISTINCT FROM v_city.id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- switch_my_watch: move to another approved watch
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.switch_my_watch(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org record;
  v_role text;
  v_from record;
  v_mine text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in to change your watch.' USING ERRCODE = '42501';
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
  ELSIF v_mine = 'suspended' THEN
    RAISE EXCEPTION 'Please ask the watch admins to add you back to this watch.' USING ERRCODE = '22023';
  END IF;

  v_role := public.places_join_member_role(v_uid);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Your account type can''t change watch here. Please ask support to move you.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = v_uid AND om.status = 'active' AND o.type = 'nw_group'
      AND om.member_role NOT IN ('resident', 'patroller')
  ) THEN
    RAISE EXCEPTION 'You help run a watch, so support needs to move you. Please ask support.' USING ERRCODE = '42501';
  END IF;

  SELECT o.id, o.name INTO v_from
  FROM public.organizations o
  WHERE o.id = public.places_current_watch(v_uid);

  -- Leave the old watch (and any other join waits), then join the new one.
  DELETE FROM public.organization_members om
  USING public.organizations o
  WHERE om.user_id = v_uid
    AND om.organization_id = o.id
    AND o.type = 'nw_group'
    AND o.status = 'active'
    AND om.organization_id <> v_org.id
    AND om.member_role IN ('resident', 'patroller')
    AND om.status IN ('active', 'pending');

  INSERT INTO public.organization_members (organization_id, user_id, member_role, status)
  VALUES (v_org.id, v_uid, v_role, 'active')
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET status = 'active', member_role = EXCLUDED.member_role;

  UPDATE public.users
  SET organization_id = v_org.id,
      active_organization_id = v_org.id,
      home_suburb_id = v_org.primary_suburb_id,
      home_city_id = coalesce(public.places_org_city(v_org.id), home_city_id)
  WHERE id = v_uid;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_from.id IS NULL THEN 'joined' ELSE 'switched' END,
    'organization_id', v_org.id,
    'name', v_org.name,
    'from_name', v_from.name
  );
END;
$$;
COMMENT ON FUNCTION public.switch_my_watch(uuid) IS
  'SA places P4: a resident or patroller moves to another approved watch (active straight away, like joining). Watch admins and committee members are refused.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.places_signup_city(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.places_user_city(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.my_home_area() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_home_area() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_my_home_city(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_home_city(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.switch_my_watch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.switch_my_watch(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Final check
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  problems text[] := ARRAY[]::text[];
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'home_city_id') THEN
    problems := problems || 'users.home_city_id missing'::text;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES ('public.my_home_area()'), ('public.set_my_home_city(uuid)'), ('public.switch_my_watch(uuid)')) AS t(sig)
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

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'users_fill_home_city' AND tgrelid = 'public.users'::regclass) THEN
    problems := problems || 'users_fill_home_city trigger missing'::text;
  END IF;

  FOR r IN SELECT * FROM (VALUES ('public.places_signup_city(uuid)'), ('public.places_user_city(uuid)'),
                                  ('public.trg_users_fill_home_city()')) AS t(sig) LOOP
    IF to_regprocedure(r.sig) IS NULL THEN
      problems := problems || (r.sig || ' missing');
    ELSIF has_function_privilege('authenticated', r.sig, 'EXECUTE') OR has_function_privilege('anon', r.sig, 'EXECUTE') THEN
      problems := problems || (r.sig || ' callable by clients');
    END IF;
  END LOOP;

  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION 'SA places P4: check failed: %.', array_to_string(problems, '; ');
  END IF;
  RAISE NOTICE 'SA places P4: OK';
END
$verify$;

NOTIFY pgrst, 'reload schema';
