-- Phase R5: tighten constraints
--
-- After the city_admin retirement (R1-R4) and SA places P1-P6:
--
-- * CHECK constraints on organizations.type, organization_members.member_role and
--   users.role no longer list city_admin. The refuse trigger from R1 is left in place.
-- * Leftover operational rows with no organisation (from before watches were
--   tenant-scoped) are attached to the first watch (Theescombe Neighborhood Watch,
--   either spelling). users.organization_id is left alone: staff and people waiting
--   to join a watch may have none.
-- * organizations.city_id and suburbs.city_id become NOT NULL. Empty values are
--   filled first from the linked suburb or watch, then from places_fallback_city()
--   (the same last resort the P6 trigger uses). The suburbs.city_id foreign key
--   stops using ON DELETE SET NULL, so a city cannot disappear from under a suburb.
--
-- Additive and idempotent; safe to run twice. Needs P1, P2, P3, P5, P4, P6 and the
-- city_admin retirement (20261123020000). Ends with NOTICE 'SA places R5: OK'.
--
-- Does not delete any rows. If any city_admin user, membership or organisation is
-- still present, the pre-check stops and lists the counts.

-- ---------------------------------------------------------------------------
-- Pre-check: list everything missing or blocking at once; change nothing
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE
  missing text[] := ARRAY[]::text[];
  r record;
  v_places integer;
  v_n bigint;
  v_roles text;
  v_first uuid;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('users', 'id'), ('users', 'role'),
      ('cities', 'id'), ('cities', 'name'), ('cities', 'geonames_id'),
      ('suburbs', 'id'), ('suburbs', 'city_id'), ('suburbs', 'name'),
      ('organizations', 'id'), ('organizations', 'name'), ('organizations', 'type'),
      ('organizations', 'status'), ('organizations', 'city_id'),
      ('organizations', 'primary_suburb_id'), ('organizations', 'created_at'),
      ('organization_members', 'organization_id'), ('organization_members', 'user_id'),
      ('organization_members', 'member_role')
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
      ('public.default_city_id()'),
      ('public.set_default_city_id()'),
      ('public.places_fallback_city()'),
      ('public.refuse_retired_city_admin()'),
      -- P6 / P5, so this file is not applied ahead of the places chain
      ('public.places_org_city(uuid)'),
      ('public.list_community_contacts()')
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

  -- Blockers: leftover city_admin rows (never deleted by this file).
  IF to_regclass('public.users') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role') THEN
    EXECUTE $q$
      SELECT count(*) FROM public.users
      WHERE replace(lower(trim(coalesce(role::text, ''))), '-', '_') = 'city_admin'
    $q$ INTO v_n;
    IF v_n > 0 THEN
      missing := missing || format('%s user(s) still have role city_admin', v_n);
    END IF;
  END IF;
  IF to_regclass('public.organization_members') IS NOT NULL THEN
    EXECUTE $q$
      SELECT count(*) FROM public.organization_members
      WHERE replace(lower(trim(coalesce(member_role, ''))), '-', '_') = 'city_admin'
    $q$ INTO v_n;
    IF v_n > 0 THEN
      missing := missing || format('%s membership(s) still have member_role city_admin', v_n);
    END IF;
  END IF;
  IF to_regclass('public.organizations') IS NOT NULL THEN
    EXECUTE $q$
      SELECT count(*) FROM public.organizations
      WHERE replace(lower(trim(coalesce(type, ''))), '-', '_') = 'city_admin'
    $q$ INTO v_n;
    IF v_n > 0 THEN
      missing := missing || format('%s organisation(s) still have type city_admin', v_n);
    END IF;
  END IF;

  -- Roles / types that would fail the tightened CHECKs (other than city_admin, already listed).
  IF to_regclass('public.users') IS NOT NULL THEN
    EXECUTE $q$
      SELECT string_agg(DISTINCT role::text, ', ' ORDER BY role::text)
      FROM public.users
      WHERE replace(lower(trim(coalesce(role::text, ''))), '-', '_')
        NOT IN ('user', 'volunteer', 'patroller', 'resident', 'committee', 'investigator',
                'admin', 'technical_support', 'nw_admin', 'security_admin', 'city_admin')
    $q$ INTO v_roles;
    IF v_roles IS NOT NULL THEN
      missing := missing || ('users.role values that the tightened check would reject: ' || v_roles);
    END IF;
  END IF;
  IF to_regclass('public.organization_members') IS NOT NULL THEN
    EXECUTE $q$
      SELECT string_agg(DISTINCT member_role, ', ' ORDER BY member_role)
      FROM public.organization_members
      WHERE replace(lower(trim(coalesce(member_role, ''))), '-', '_')
        NOT IN ('resident', 'patroller', 'nw_admin', 'committee', 'security_admin',
                'technical_support', 'city_admin')
    $q$ INTO v_roles;
    IF v_roles IS NOT NULL THEN
      missing := missing || ('member_role values that the tightened check would reject: ' || v_roles);
    END IF;
  END IF;
  IF to_regclass('public.organizations') IS NOT NULL THEN
    EXECUTE $q$
      SELECT string_agg(DISTINCT type, ', ' ORDER BY type)
      FROM public.organizations
      WHERE replace(lower(trim(coalesce(type, ''))), '-', '_')
        NOT IN ('nw_group', 'security_company', 'city_admin')
    $q$ INTO v_roles;
    IF v_roles IS NOT NULL THEN
      missing := missing || ('organizations.type values that the tightened check would reject: ' || v_roles);
    END IF;
  END IF;

  -- First watch, only required when leftover unscoped operational rows exist.
  -- The name is matched with either spelling of "neighborhood". Looked up only
  -- when the organisations table is already present (listed in missing otherwise).
  IF to_regclass('public.organizations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'type') THEN
    SELECT o.id INTO v_first
    FROM public.organizations o
    WHERE o.type = 'nw_group'
      AND lower(o.name) IN ('theescombe neighborhood watch', 'theescombe neighbourhood watch')
    ORDER BY o.created_at, o.id
    LIMIT 1;
    IF v_first IS NULL THEN
      SELECT o.id INTO v_first
      FROM public.organizations o
      WHERE o.type = 'nw_group' AND o.status = 'active'
      ORDER BY o.created_at, o.id
      LIMIT 1;
    END IF;
  END IF;

  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'SA places R5: not applied, missing %. Nothing was changed.',
      array_to_string(missing, ', ');
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- Backfill empty cities (safe inference, then the P6 fallback)
-- ---------------------------------------------------------------------------
DO $fill_city$
DECLARE
  v_from_suburb integer := 0;
  v_from_org integer := 0;
  v_org_fb integer := 0;
  v_sub_fb integer := 0;
  v_city uuid;
BEGIN
  UPDATE public.organizations o
  SET city_id = s.city_id
  FROM public.suburbs s
  WHERE o.city_id IS NULL
    AND s.id = o.primary_suburb_id
    AND s.city_id IS NOT NULL;
  GET DIAGNOSTICS v_from_suburb = ROW_COUNT;

  UPDATE public.suburbs s
  SET city_id = o.city_id
  FROM public.organizations o
  WHERE s.city_id IS NULL
    AND o.primary_suburb_id = s.id
    AND o.city_id IS NOT NULL;
  GET DIAGNOSTICS v_from_org = ROW_COUNT;

  v_city := public.places_fallback_city();
  IF v_city IS NOT NULL THEN
    UPDATE public.organizations SET city_id = v_city WHERE city_id IS NULL;
    GET DIAGNOSTICS v_org_fb = ROW_COUNT;
    UPDATE public.suburbs SET city_id = v_city WHERE city_id IS NULL;
    GET DIAGNOSTICS v_sub_fb = ROW_COUNT;
  END IF;

  IF v_from_suburb > 0 OR v_from_org > 0 OR v_org_fb > 0 OR v_sub_fb > 0 THEN
    RAISE NOTICE 'SA places R5: filled empty city_id on % organisation(s) from a suburb, % suburb(s) from a watch, % remaining row(s) from the fallback city.',
      v_from_suburb, v_from_org, v_org_fb + v_sub_fb;
  END IF;
END
$fill_city$;

-- ---------------------------------------------------------------------------
-- Backfill leftover unscoped operational rows onto the first watch
-- ---------------------------------------------------------------------------
DO $fill_org$
DECLARE
  v_first uuid;
  t text;
  v_n integer;
  v_total integer := 0;
  v_tables text[] := ARRAY[]::text[];
BEGIN
  SELECT o.id INTO v_first
  FROM public.organizations o
  WHERE o.type = 'nw_group'
    AND lower(o.name) IN ('theescombe neighborhood watch', 'theescombe neighbourhood watch')
  ORDER BY o.created_at, o.id
  LIMIT 1;
  IF v_first IS NULL THEN
    SELECT o.id INTO v_first
    FROM public.organizations o
    WHERE o.type = 'nw_group' AND o.status = 'active'
    ORDER BY o.created_at, o.id
    LIMIT 1;
  END IF;
  IF v_first IS NULL THEN
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY[
    'incidents', 'criminal_profiles', 'profile_incidents',
    'patrol_logs', 'patrol_slots', 'active_patrols', 'patrol_locations', 'patrol_routes',
    'chat_messages', 'feedback', 'hotspot_events', 'camera_spots',
    'profile_match_queue', 'resident_report_events', 'sos_alerts'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'organization_id'
    ) THEN
      EXECUTE format(
        'UPDATE public.%I SET organization_id = $1 WHERE organization_id IS NULL',
        t
      ) USING v_first;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN
        v_total := v_total + v_n;
        v_tables := v_tables || (t || ' (' || v_n || ')');
      END IF;
    END IF;
  END LOOP;

  IF v_total > 0 THEN
    RAISE NOTICE 'SA places R5: attached % leftover unscoped row(s) to the first watch: %.',
      v_total, array_to_string(v_tables, ', ');
  END IF;
END
$fill_org$;

-- ---------------------------------------------------------------------------
-- NOT NULL on city_id, and suburbs cannot lose their city
-- ---------------------------------------------------------------------------
DO $nn$
DECLARE
  r record;
  v_null_org integer;
  v_null_sub integer;
BEGIN
  SELECT count(*) INTO v_null_org FROM public.organizations WHERE city_id IS NULL;
  SELECT count(*) INTO v_null_sub FROM public.suburbs WHERE city_id IS NULL;
  IF v_null_org > 0 OR v_null_sub > 0 THEN
    RAISE EXCEPTION 'SA places R5: not applied, % organisation(s) and % suburb(s) still have no city after backfill. Nothing was constrained.',
      v_null_org, v_null_sub;
  END IF;

  -- Recreate suburbs.city_id FK without ON DELETE SET NULL / CASCADE (would fight NOT NULL).
  FOR r IN
    SELECT c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    WHERE c.conrelid = 'public.suburbs'::regclass
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) ILIKE '%REFERENCES%cities%'
  LOOP
    IF r.def ILIKE '%ON DELETE SET NULL%' OR r.def ILIKE '%ON DELETE CASCADE%' THEN
      EXECUTE format('ALTER TABLE public.suburbs DROP CONSTRAINT IF EXISTS %I', r.conname);
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.suburbs'::regclass
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) ILIKE '%REFERENCES%cities%'
  ) THEN
    ALTER TABLE public.suburbs
      ADD CONSTRAINT suburbs_city_id_fkey
      FOREIGN KEY (city_id) REFERENCES public.cities (id) ON DELETE RESTRICT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizations'
      AND column_name = 'city_id' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.organizations ALTER COLUMN city_id SET NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'suburbs'
      AND column_name = 'city_id' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.suburbs ALTER COLUMN city_id SET NOT NULL;
  END IF;
END
$nn$;

-- ---------------------------------------------------------------------------
-- CHECKs without city_admin
-- ---------------------------------------------------------------------------
DO $checks$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS nsp, t.relname AS tbl, c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname IN ('organizations', 'organization_members', 'users')
      AND c.contype = 'c'
      AND position('city_admin' IN lower(pg_get_constraintdef(c.oid))) > 0
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.nsp, r.tbl, r.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.organizations'::regclass AND c.contype = 'c'
      AND position('nw_group' IN pg_get_constraintdef(c.oid)) > 0
      AND position('security_company' IN pg_get_constraintdef(c.oid)) > 0
      AND position('city_admin' IN lower(pg_get_constraintdef(c.oid))) = 0
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_type_check
      CHECK (type IN ('nw_group', 'security_company'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.organization_members'::regclass AND c.contype = 'c'
      AND position('member_role' IN lower(pg_get_constraintdef(c.oid))) > 0
      AND position('city_admin' IN lower(pg_get_constraintdef(c.oid))) = 0
  ) THEN
    ALTER TABLE public.organization_members
      ADD CONSTRAINT organization_members_member_role_check
      CHECK (member_role IN (
        'resident',
        'patroller',
        'nw_admin',
        'committee',
        'security_admin',
        'technical_support'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.users'::regclass AND c.contype = 'c'
      AND position('city_admin' IN lower(pg_get_constraintdef(c.oid))) = 0
      AND (
        position('role' IN lower(pg_get_constraintdef(c.oid))) > 0
        AND position('platform_role' IN lower(pg_get_constraintdef(c.oid))) = 0
      )
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_role_check
      CHECK (
        replace(lower(trim(coalesce(role::text, ''))), '-', '_') IN (
          'user',
          'volunteer',
          'patroller',
          'resident',
          'committee',
          'investigator',
          'admin',
          'technical_support',
          'nw_admin',
          'security_admin'
        )
      );
  END IF;
END
$checks$;

-- ---------------------------------------------------------------------------
-- Final check
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  problems text[] := ARRAY[]::text[];
  r record;
  v_def text;
  v_n bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizations'
      AND column_name = 'city_id' AND is_nullable = 'YES'
  ) THEN
    problems := problems || 'organizations.city_id is still nullable'::text;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'suburbs'
      AND column_name = 'city_id' AND is_nullable = 'YES'
  ) THEN
    problems := problems || 'suburbs.city_id is still nullable'::text;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.suburbs'::regclass
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) ILIKE '%city_id%REFERENCES%cities%'
      AND pg_get_constraintdef(c.oid) ILIKE '%ON DELETE SET NULL%'
  ) THEN
    problems := problems || 'suburbs.city_id still becomes empty if the city is removed'::text;
  END IF;

  FOR r IN
    SELECT t.relname AS tbl, c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname IN ('organizations', 'organization_members', 'users')
      AND c.contype = 'c'
      AND position('city_admin' IN lower(pg_get_constraintdef(c.oid))) > 0
  LOOP
    problems := problems || (r.tbl || '.' || r.conname || ' still allows city_admin');
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.organizations'::regclass AND c.contype = 'c'
      AND position('nw_group' IN pg_get_constraintdef(c.oid)) > 0
      AND position('city_admin' IN lower(pg_get_constraintdef(c.oid))) = 0
  ) THEN
    problems := problems || 'organizations type check is missing'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.organization_members'::regclass AND c.contype = 'c'
      AND position('member_role' IN lower(pg_get_constraintdef(c.oid))) > 0
      AND position('city_admin' IN lower(pg_get_constraintdef(c.oid))) = 0
  ) THEN
    problems := problems || 'organization_members role check is missing'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.users'::regclass AND c.contype = 'c'
      AND position('city_admin' IN lower(pg_get_constraintdef(c.oid))) = 0
      AND position('resident' IN lower(pg_get_constraintdef(c.oid))) > 0
  ) THEN
    problems := problems || 'users role check is missing'::text;
  END IF;

  IF to_regprocedure('public.refuse_retired_city_admin()') IS NULL THEN
    problems := problems || 'refuse_retired_city_admin() is missing'::text;
  END IF;

  SELECT count(*) INTO v_n FROM public.organizations WHERE city_id IS NULL;
  IF v_n > 0 THEN
    problems := problems || format('%s organisation(s) have no city', v_n);
  END IF;
  SELECT count(*) INTO v_n FROM public.suburbs WHERE city_id IS NULL;
  IF v_n > 0 THEN
    problems := problems || format('%s suburb(s) have no city', v_n);
  END IF;

  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION 'SA places R5: check failed: %', array_to_string(problems, '; ');
  END IF;
  RAISE NOTICE 'SA places R5: OK';
END
$verify$;
