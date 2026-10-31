-- =============================================================================
-- G7 - Two-org isolation test script (NOT a migration)
-- platform/supabase/sql/isolation_tests_community.sql
-- =============================================================================
-- WHAT IT DOES
--   Creates two throwaway organizations (A and B) and throwaway users inside ONE
--   transaction, impersonates each user with request.jwt.claims +
--   SET LOCAL ROLE authenticated, runs the NEW_FEATURES_BLUEPRINT section 14
--   checks that exist after G1-G6, and then rolls EVERYTHING back.
--
-- SAFETY (why this is OK to paste into the live SQL editor)
--   * BEGIN ... ROLLBACK. The script ends with a deliberate RAISE EXCEPTION
--     that carries the report, so the transaction is aborted even if a client
--     ignored the final ROLLBACK. Nothing it creates can be committed.
--   * Fixtures (auth.users, public.users, organizations, organization_members,
--     area_broadcasts, emergency_directory_entries, activity_logs,
--     user_notification_prefs, city_hub_read_state, storage.objects attempts)
--     use fresh gen_random_uuid() ids and 'g7-isolation-' names. No UPDATE or
--     DELETE targets any pre-existing row; every write uses a fixture id.
--   * pg_net / database-webhook requests and app_notifications made by
--     triggers are rows in this transaction, so they roll back too and are
--     never sent. Realtime only streams committed changes.
--   * No DDL on real objects. Helpers live in pg_temp (session-only).
--
-- ADAPTATIONS vs CURSOR_PROMPTS.md G7 (the project has no staging)
--   * No psql -v a_res=... variables: the Supabase SQL editor can't expand
--     them, and picking real users would mean impersonating real accounts.
--     Fixture users are created in-transaction instead (auth.users insert rolls
--     back cleanly as part of the same transaction).
--   * pg_temp.expect_error / expect_rows are implemented as soft checks that
--     record PASS/FAIL into a temp table instead of stopping at the first
--     failure, so you see every result in one run.
--   * Expected messages follow the CURRENT code where it differs from the
--     section 14 wording (row 29 'Not allowed', row 32 'not found').
--
-- HOW TO RUN
--   Supabase dashboard -> SQL editor -> New query -> paste the whole file ->
--   Run. The run ALWAYS ends in an ERROR box. That is intentional:
--     "G7 ISOLATION: ALL n CHECKS PASSED (rolled back, nothing saved)"
--     "G7 ISOLATION: k of n CHECKS FAILED: #row test -> detail | ..."
--   psql alternative (also shows the full results table first):
--     psql "$DB_URL" -f platform/supabase/sql/isolation_tests_community.sql
--   After the run, optional proof nothing persisted (expect 0):
--     SELECT count(*) FROM public.organizations WHERE name LIKE 'g7-isolation-%';
--
-- EXTEND IN EVERY PHASE: add checks in the marked TODO sections.
-- =============================================================================

BEGIN;

SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE g7_ids (k text PRIMARY KEY, v uuid NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE g7_results (
  n serial PRIMARY KEY,
  matrix_row text,
  test text,
  ok boolean,
  detail text
) ON COMMIT DROP;

-- -----------------------------------------------------------------------------
-- Helpers (pg_temp = this session only)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.id(p_k text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT v FROM g7_ids WHERE k = p_k $$;

-- Impersonate: set JWT claims and switch role for the rest of the transaction
-- (or the enclosing sub-block). Call RESET ROLE afterwards.
CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid, p_role text DEFAULT 'authenticated')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p, 'role', p_role)::text,
    true
  );
  PERFORM set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.as_postgres() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $$;

-- Core runner. Runs p_sql as p_user (role p_role) in a sub-transaction.
--   p_mode = 'error'   pass if it raises and SQLERRM ~* p_expect
--   p_mode = 'blocked' pass if it raises matching p_expect OR changes 0 rows
--   p_mode = 'rows'    p_sql must be a SELECT; pass if count(*) = p_expect::int
--   p_mode = 'true'    p_sql returns one boolean; pass if it is true
--   p_mode = 'ok'      pass if it runs without error
CREATE OR REPLACE FUNCTION pg_temp.check(
  p_row text, p_test text, p_user uuid, p_mode text, p_sql text,
  p_expect text DEFAULT NULL, p_role text DEFAULT 'authenticated'
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_ok boolean := false;
  v_detail text;
  v_n bigint;
  v_b boolean;
BEGIN
  BEGIN
    PERFORM pg_temp.as_user(p_user, p_role);
    IF p_mode = 'rows' THEN
      EXECUTE format('SELECT count(*) FROM (%s) q', p_sql) INTO v_n;
      v_ok := v_n = p_expect::bigint;
      v_detail := format('got %s rows, expected %s', v_n, p_expect);
    ELSIF p_mode = 'true' THEN
      EXECUTE p_sql INTO v_b;
      v_ok := coalesce(v_b, false);
      v_detail := format('got %s', v_b);
    ELSE
      EXECUTE p_sql;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF p_mode = 'ok' THEN
        v_ok := true; v_detail := 'ran ok';
      ELSIF p_mode = 'blocked' THEN
        v_ok := v_n = 0;
        v_detail := format('no error, %s rows changed', v_n);
      ELSE
        v_ok := false;
        v_detail := format('expected error ~ "%s" but it succeeded (%s rows)', p_expect, v_n);
      END IF;
    END IF;
    -- Inline (not pg_temp.as_postgres) because we are still the impersonated role.
    RESET ROLE;
  EXCEPTION WHEN others THEN
    -- Sub-transaction rolled back: role and claims are already reverted.
    IF p_mode IN ('error', 'blocked') THEN
      v_ok := SQLERRM ~* p_expect;
      v_detail := CASE WHEN v_ok THEN 'raised: ' ELSE 'wrong error: ' END || SQLERRM;
    ELSE
      v_ok := false;
      v_detail := 'unexpected error: ' || SQLERRM;
    END IF;
  END;
  PERFORM pg_temp.as_postgres();
  INSERT INTO g7_results (matrix_row, test, ok, detail)
  VALUES (p_row, p_test, v_ok, v_detail);
END $$;

-- Blueprint-named wrappers (section 4.7).
CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_row text, p_test text, p_user uuid, p_sql text, p_like text)
RETURNS void LANGUAGE sql AS $$ SELECT pg_temp.check(p_row, p_test, p_user, 'error', p_sql, p_like) $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_rows(p_row text, p_test text, p_user uuid, p_sql text, p_n int)
RETURNS void LANGUAGE sql AS $$ SELECT pg_temp.check(p_row, p_test, p_user, 'rows', p_sql, p_n::text) $$;

-- Record a check computed as postgres (e.g. "value unchanged").
CREATE OR REPLACE FUNCTION pg_temp.assert(p_row text, p_test text, p_cond boolean, p_detail text)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO g7_results (matrix_row, test, ok, detail)
  VALUES (p_row, p_test, coalesce(p_cond, false), p_detail)
$$;

-- -----------------------------------------------------------------------------
-- Fixtures (all new rows, all rolled back)
-- -----------------------------------------------------------------------------
DO $fx$
DECLARE
  sfx text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  r record;
BEGIN
  INSERT INTO g7_ids VALUES
    ('org_a', gen_random_uuid()), ('org_b', gen_random_uuid()),
    ('a_res', gen_random_uuid()), ('a_admin', gen_random_uuid()),
    ('b_res', gen_random_uuid()), ('b_admin', gen_random_uuid()),
    ('a_notice', gen_random_uuid()), ('b_entry', gen_random_uuid()),
    ('a_log', gen_random_uuid()), ('sec_co', gen_random_uuid()),
    ('fake_incident', gen_random_uuid());

  INSERT INTO public.organizations (id, name, type, status)
  VALUES (pg_temp.id('org_a'), 'g7-isolation-A-' || sfx, 'nw_group', 'active'),
         (pg_temp.id('org_b'), 'g7-isolation-B-' || sfx, 'nw_group', 'active');

  FOR r IN SELECT * FROM (VALUES
      ('a_res',   'org_a', 'resident'),
      ('a_admin', 'org_a', 'nw_admin'),
      ('b_res',   'org_b', 'resident'),
      ('b_admin', 'org_b', 'nw_admin')) t(k, org, role)
  LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    VALUES (pg_temp.id(r.k), '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'g7-' || r.k || '-' || sfx || '@example.invalid', now(), now());

    -- ON CONFLICT: a signup hook may already have created the profile row.
    -- EXECUTE + %L so the role literal casts whether users.role is text or an enum.
    EXECUTE format(
      'INSERT INTO public.users (id, email, full_name, role, organization_id, verified, status)
       VALUES (%L, %L, %L, %L, %L, true, %L)
       ON CONFLICT (id) DO UPDATE
         SET role = EXCLUDED.role, organization_id = EXCLUDED.organization_id,
             full_name = EXCLUDED.full_name, verified = true, status = %L',
      pg_temp.id(r.k), 'g7-' || r.k || '-' || sfx || '@example.invalid',
      'G7 ' || r.k, r.role, pg_temp.id(r.org), 'active', 'active');

    INSERT INTO public.organization_members (organization_id, user_id, member_role, status)
    VALUES (pg_temp.id(r.org), pg_temp.id(r.k), r.role, 'active')
    ON CONFLICT (organization_id, user_id) DO NOTHING;
  END LOOP;

  INSERT INTO public.area_broadcasts (id, organization_id, author_id, headline, body)
  VALUES (pg_temp.id('a_notice'), pg_temp.id('org_a'), pg_temp.id('a_admin'),
          'G7 test notice', 'G7 isolation fixture');

  INSERT INTO public.emergency_directory_entries (id, kind, name, organization_id)
  VALUES (pg_temp.id('b_entry'), 'other', 'G7 B contact', pg_temp.id('org_b'));

  INSERT INTO public.activity_logs (id, organization_id, user_id, action)
  VALUES (pg_temp.id('a_log'), pg_temp.id('org_a'), pg_temp.id('a_admin'), 'g7_isolation_fixture');

  -- A resident mutes sos (mandatory, must still deliver) and area_broadcast push.
  INSERT INTO public.user_notification_prefs (user_id, kind, push_enabled, in_app_enabled)
  VALUES (pg_temp.id('a_res'), 'sos', false, false),
         (pg_temp.id('a_res'), 'area_broadcast', false, true),
         (pg_temp.id('b_res'), 'area_broadcast', true, true);

  INSERT INTO public.city_hub_read_state (user_id, last_seen_at)
  VALUES (pg_temp.id('b_res'), now() - interval '1 day');
END
$fx$;

-- -----------------------------------------------------------------------------
-- G1 - area broadcasts (matrix row 3)
-- -----------------------------------------------------------------------------
SELECT pg_temp.expect_error('3', 'B nw_admin hide_area_broadcast(A notice) -> not found',
  pg_temp.id('b_admin'), format('SELECT public.hide_area_broadcast(%L)', pg_temp.id('a_notice')), 'notice not found');
SELECT pg_temp.expect_error('3', 'B nw_admin edit_area_broadcast(A notice) -> not found',
  pg_temp.id('b_admin'), format('SELECT public.edit_area_broadcast(%L, %L, %L)', pg_temp.id('a_notice'), 'x', 'y'), 'notice not found');
SELECT pg_temp.expect_error('3', 'B nw_admin restore_area_broadcast(A notice) -> not found',
  pg_temp.id('b_admin'), format('SELECT public.restore_area_broadcast(%L)', pg_temp.id('a_notice')), 'notice not found');
SELECT pg_temp.expect_rows('3', 'B resident cannot SELECT A notice',
  pg_temp.id('b_res'), format('SELECT 1 FROM public.area_broadcasts WHERE id = %L', pg_temp.id('a_notice')), 0);
SELECT pg_temp.expect_error('3', 'A resident (not author/staff) hide A notice -> forbidden',
  pg_temp.id('a_res'), format('SELECT public.hide_area_broadcast(%L)', pg_temp.id('a_notice')), 'forbidden');
SELECT pg_temp.expect_rows('3', 'control: A resident CAN see A notice',
  pg_temp.id('a_res'), format('SELECT 1 FROM public.area_broadcasts WHERE id = %L', pg_temp.id('a_notice')), 1);

-- -----------------------------------------------------------------------------
-- G2 - audit log (rows 26, 27, 22-style append-only)
-- -----------------------------------------------------------------------------
SELECT pg_temp.expect_rows('26', 'A resident SELECT activity_logs -> 0 rows',
  pg_temp.id('a_res'), 'SELECT 1 FROM public.activity_logs', 0);
SELECT pg_temp.expect_error('27', 'A resident INSERT activity_logs -> denied',
  pg_temp.id('a_res'),
  format('INSERT INTO public.activity_logs (organization_id, user_id, action) VALUES (%L, %L, %L)',
         pg_temp.id('org_a'), pg_temp.id('a_res'), 'forged'),
  'permission denied|row-level security');
SELECT pg_temp.expect_rows('26', 'B nw_admin sees 0 Org A audit rows',
  pg_temp.id('b_admin'), format('SELECT 1 FROM public.activity_logs WHERE organization_id = %L', pg_temp.id('org_a')), 0);
SELECT pg_temp.expect_rows('26', 'control: A nw_admin sees the A fixture audit row',
  pg_temp.id('a_admin'), format('SELECT 1 FROM public.activity_logs WHERE id = %L', pg_temp.id('a_log')), 1);
SELECT pg_temp.check('G2', 'service_role UPDATE activity_logs -> append-only',
  NULL, 'error', format('UPDATE public.activity_logs SET action = %L WHERE id = %L', 'x', pg_temp.id('a_log')),
  'append-only', 'service_role');
SELECT pg_temp.check('G2', 'service_role DELETE activity_logs -> append-only',
  NULL, 'error', format('DELETE FROM public.activity_logs WHERE id = %L', pg_temp.id('a_log')),
  'append-only', 'service_role');

-- -----------------------------------------------------------------------------
-- G3 - emergency directory (rows 28, 29)
-- -----------------------------------------------------------------------------
SELECT pg_temp.expect_error('28', 'A nw_admin upsert p_scope=>global -> Not allowed',
  pg_temp.id('a_admin'),
  $q$SELECT public.upsert_emergency_directory_entry(p_id => NULL, p_kind => 'other', p_name => 'G7 global',
     p_phone => NULL, p_alt_phone => NULL, p_email => NULL, p_contact_person_name => NULL, p_notes => NULL,
     p_sort_order => 100, p_active => true, p_scope => 'global')$q$,
  'Not allowed');
SELECT pg_temp.expect_error('29', 'A nw_admin edits B entry by id -> Not allowed',
  pg_temp.id('a_admin'),
  format($q$SELECT public.upsert_emergency_directory_entry(p_id => %L, p_kind => 'other', p_name => 'hijack',
     p_phone => NULL, p_alt_phone => NULL, p_email => NULL, p_contact_person_name => NULL, p_notes => NULL,
     p_sort_order => 100, p_active => true)$q$, pg_temp.id('b_entry')),
  'Not allowed|not found');
SELECT pg_temp.expect_error('29', 'A nw_admin set_emergency_directory_active(B entry) -> Not allowed',
  pg_temp.id('a_admin'), format('SELECT public.set_emergency_directory_active(%L, false)', pg_temp.id('b_entry')),
  'Not allowed|not found');
SELECT pg_temp.check('28', 'control: A nw_admin can add an org-scoped entry',
  pg_temp.id('a_admin'), 'ok',
  $q$SELECT public.upsert_emergency_directory_entry(p_id => NULL, p_kind => 'other', p_name => 'G7 A local',
     p_phone => NULL, p_alt_phone => NULL, p_email => NULL, p_contact_person_name => NULL, p_notes => NULL,
     p_sort_order => 100, p_active => true)$q$);
SELECT pg_temp.assert('29', 'B entry unchanged after attacks',
  (SELECT name = 'G7 B contact' AND active FROM public.emergency_directory_entries WHERE id = pg_temp.id('b_entry')),
  'checked as postgres');

-- -----------------------------------------------------------------------------
-- G4 - storage writes + criminal-photos lockdown (rows 24, 25)
-- Inserts into storage.objects are metadata rows only (no file) and roll back.
-- -----------------------------------------------------------------------------
SELECT pg_temp.expect_error('24', 'B resident write incident-photos/<incident not in B>/x.jpg -> denied',
  pg_temp.id('b_res'),
  format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)',
         'incident-photos', pg_temp.id('fake_incident') || '/x.jpg', pg_temp.id('b_res')),
  'row-level security|permission denied');
SELECT pg_temp.expect_error('25', 'resident overwrite security-branding/<other company>/logo.png -> denied',
  pg_temp.id('a_res'),
  format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)',
         'security-branding', pg_temp.id('sec_co') || '/logo.png', pg_temp.id('a_res')),
  'row-level security|permission denied');
SELECT pg_temp.expect_error('G4', 'resident upload criminal-photos (not intel role) -> denied',
  pg_temp.id('a_res'),
  format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)',
         'criminal-photos', 'criminal-profiles/' || pg_temp.id('a_res') || '/x.jpg', pg_temp.id('a_res')),
  'row-level security|permission denied');
SELECT pg_temp.expect_error('G4', 'nw_admin upload criminal-photos under ANOTHER uploader folder -> denied',
  pg_temp.id('a_admin'),
  format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)',
         'criminal-photos', 'criminal-profiles/' || pg_temp.id('b_admin') || '/x.jpg', pg_temp.id('a_admin')),
  'row-level security|permission denied');
-- TODO(row 24 strong form): needs a real Org A incident fixture; incidents
-- columns are not defined in this repo's migrations, so it is not created here.

-- -----------------------------------------------------------------------------
-- G5 - users privilege guard (rows 30, 31, 32)
-- 'blocked' = trigger error OR RLS hides the row (0 rows changed).
-- -----------------------------------------------------------------------------
SELECT pg_temp.check('30', 'A resident sets own role=nw_admin -> blocked',
  pg_temp.id('a_res'), 'blocked',
  format('UPDATE public.users SET role = %L WHERE id = %L', 'nw_admin', pg_temp.id('a_res')),
  'cannot change your own role');
SELECT pg_temp.check('30', 'A resident moves self to Org B -> blocked',
  pg_temp.id('a_res'), 'blocked',
  format('UPDATE public.users SET organization_id = %L WHERE id = %L', pg_temp.id('org_b'), pg_temp.id('a_res')),
  'cannot change your own');
SELECT pg_temp.check('30', 'A resident sets active_organization_id = Org B -> blocked',
  pg_temp.id('a_res'), 'blocked',
  format('UPDATE public.users SET active_organization_id = %L WHERE id = %L', pg_temp.id('org_b'), pg_temp.id('a_res')),
  'not a member of that neighbourhood');
SELECT pg_temp.check('31', 'A nw_admin sets A member role=admin -> blocked',
  pg_temp.id('a_admin'), 'blocked',
  format('UPDATE public.users SET role = %L WHERE id = %L', 'admin', pg_temp.id('a_res')),
  'only platform staff');
SELECT pg_temp.check('32', 'A nw_admin sets B member role=patroller -> blocked',
  pg_temp.id('a_admin'), 'blocked',
  format('UPDATE public.users SET role = %L WHERE id = %L', 'patroller', pg_temp.id('b_res')),
  'not found|forbidden');
SELECT pg_temp.check('32', 'A resident edits another A user -> blocked',
  pg_temp.id('a_res'), 'blocked',
  format('UPDATE public.users SET full_name = %L WHERE id = %L', 'pwned', pg_temp.id('a_admin')),
  'forbidden|not found');
SELECT pg_temp.assert('30-32', 'fixture roles/orgs unchanged after attacks',
  (SELECT bool_and(CASE u.id
      WHEN pg_temp.id('a_res') THEN u.role::text = 'resident' AND u.organization_id = pg_temp.id('org_a')
        AND u.active_organization_id IS DISTINCT FROM pg_temp.id('org_b')
      WHEN pg_temp.id('b_res') THEN u.role::text = 'resident'
      WHEN pg_temp.id('a_admin') THEN u.full_name IS NOT DISTINCT FROM 'G7 a_admin'
    END)
   FROM public.users u WHERE u.id IN (pg_temp.id('a_res'), pg_temp.id('b_res'), pg_temp.id('a_admin'))),
  'checked as postgres');

-- -----------------------------------------------------------------------------
-- G6 - notification prefs (row 33) + own-row RLS
-- -----------------------------------------------------------------------------
SELECT pg_temp.check('33', 'A resident muted sos -> should_notify(push) still true',
  NULL, 'true', format('SELECT public.should_notify(%L, %L, %L)', pg_temp.id('a_res'), 'sos', 'push'),
  NULL, 'service_role');
SELECT pg_temp.check('33', 'A resident muted sos -> should_notify(in_app) still true',
  NULL, 'true', format('SELECT public.should_notify(%L, %L, %L)', pg_temp.id('a_res'), 'sos', 'in_app'),
  NULL, 'service_role');
SELECT pg_temp.check('G6', 'control: muted area_broadcast push -> should_notify false',
  NULL, 'true', format('SELECT NOT public.should_notify(%L, %L, %L)', pg_temp.id('a_res'), 'area_broadcast', 'push'),
  NULL, 'service_role');
SELECT pg_temp.expect_error('G6', 'authenticated cannot call should_notify',
  pg_temp.id('a_res'), format('SELECT public.should_notify(%L, %L)', pg_temp.id('b_res'), 'sos'), 'permission denied');
SELECT pg_temp.expect_rows('G6', 'A resident cannot read B resident prefs',
  pg_temp.id('a_res'), format('SELECT 1 FROM public.user_notification_prefs WHERE user_id = %L', pg_temp.id('b_res')), 0);
SELECT pg_temp.expect_rows('G6', 'control: A resident reads own prefs',
  pg_temp.id('a_res'), format('SELECT 1 FROM public.user_notification_prefs WHERE user_id = %L', pg_temp.id('a_res')), 2);
SELECT pg_temp.expect_error('G6', 'A resident inserts prefs for B resident -> RLS',
  pg_temp.id('a_res'),
  format('INSERT INTO public.user_notification_prefs (user_id, kind, push_enabled) VALUES (%L, %L, false)', pg_temp.id('b_res'), 'chat'),
  'row-level security');
SELECT pg_temp.check('G6', 'A resident updates B resident prefs -> 0 rows',
  pg_temp.id('a_res'), 'blocked',
  format('UPDATE public.user_notification_prefs SET push_enabled = false WHERE user_id = %L', pg_temp.id('b_res')),
  'row-level security');

-- -----------------------------------------------------------------------------
-- City Hub read state (G-series follow-up, own-row only)
-- -----------------------------------------------------------------------------
SELECT pg_temp.expect_rows('CH', 'A resident cannot read B city_hub_read_state',
  pg_temp.id('a_res'), format('SELECT 1 FROM public.city_hub_read_state WHERE user_id = %L', pg_temp.id('b_res')), 0);
SELECT pg_temp.check('CH', 'A resident updates B city_hub_read_state -> 0 rows',
  pg_temp.id('a_res'), 'blocked',
  format('UPDATE public.city_hub_read_state SET last_seen_at = now() WHERE user_id = %L', pg_temp.id('b_res')),
  'row-level security');
SELECT pg_temp.expect_error('CH', 'A resident inserts read state for another user -> RLS',
  pg_temp.id('a_res'),
  format('INSERT INTO public.city_hub_read_state (user_id) VALUES (%L)', pg_temp.id('a_admin')),
  'row-level security|duplicate');
SELECT pg_temp.check('CH', 'control: A resident mark_city_hub_visited() own row',
  pg_temp.id('a_res'), 'ok', 'SELECT public.mark_city_hub_visited()');

-- -----------------------------------------------------------------------------
-- Patrol: end_patrol only ends the caller's own patrol
-- -----------------------------------------------------------------------------
SELECT pg_temp.expect_error('PT', 'A resident end_patrol(B user) -> own patrol only',
  pg_temp.id('a_res'), format('SELECT public.end_patrol(%L::uuid, false)', pg_temp.id('b_res')), 'only end your own patrol');
SELECT pg_temp.check('PT', 'control: end_patrol(self) with no active patrol is a no-op',
  pg_temp.id('a_res'), 'ok', format('SELECT public.end_patrol(%L::uuid, false)', pg_temp.id('a_res')));

-- -----------------------------------------------------------------------------
-- -----------------------------------------------------------------------------
-- P0a - capability grants (rows 1, 13 + acceptance criteria). Needs migration
-- 20261031010000_org_capability_grants.sql applied first.
-- -----------------------------------------------------------------------------
DO $p0a_fx$
DECLARE
  sfx text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  r record;
BEGIN
  INSERT INTO g7_ids VALUES ('a_unv', gen_random_uuid()), ('a_comm', gen_random_uuid()), ('a_pat', gen_random_uuid());
  FOR r IN SELECT * FROM (VALUES
      ('a_unv', 'resident', false), ('a_comm', 'committee', true), ('a_pat', 'patroller', true)) t(k, role, ver)
  LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    VALUES (pg_temp.id(r.k), '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'g7-' || r.k || '-' || sfx || '@example.invalid', now(), now());
    EXECUTE format(
      'INSERT INTO public.users (id, email, full_name, role, organization_id, verified, status)
       VALUES (%L, %L, %L, %L, %L, %L, %L)
       ON CONFLICT (id) DO UPDATE
         SET role = EXCLUDED.role, organization_id = EXCLUDED.organization_id,
             full_name = EXCLUDED.full_name, verified = EXCLUDED.verified, status = EXCLUDED.status',
      pg_temp.id(r.k), 'g7-' || r.k || '-' || sfx || '@example.invalid',
      'G7 ' || r.k, r.role, pg_temp.id('org_a'), r.ver, 'active');
    INSERT INTO public.organization_members (organization_id, user_id, member_role, status)
    VALUES (pg_temp.id('org_a'), pg_temp.id(r.k), r.role, 'active')
    ON CONFLICT (organization_id, user_id) DO NOTHING;
  END LOOP;
  -- Make sure the unverified fixture really is unverified.
  UPDATE public.resident_profiles SET verification_date = NULL WHERE user_id = pg_temp.id('a_unv');
END
$p0a_fx$;

SELECT pg_temp.assert('P0a', 'fixture: a_unv is not a verified household',
  NOT public.is_verified_household(pg_temp.id('a_unv')), 'checked as postgres');
SELECT pg_temp.expect_error('1', 'B nw_admin grant_org_capability(A resident) -> not in this neighbourhood',
  pg_temp.id('b_admin'), format('SELECT public.grant_org_capability(%L, %L)', pg_temp.id('a_res'), 'resident_broadcaster'),
  'user is not in this neighbourhood');
SELECT pg_temp.expect_error('P0a', 'A committee cannot grant (D1) -> forbidden',
  pg_temp.id('a_comm'), format('SELECT public.grant_org_capability(%L, %L)', pg_temp.id('a_res'), 'resident_broadcaster'),
  'forbidden');
SELECT pg_temp.expect_error('P0a', 'A resident cannot grant -> forbidden',
  pg_temp.id('a_res'), format('SELECT public.grant_org_capability(%L, %L)', pg_temp.id('a_res'), 'resident_moderator'),
  'forbidden');
SELECT pg_temp.expect_error('P0a', 'A admin grant resident cap to unverified resident (D3) -> refused',
  pg_temp.id('a_admin'), format('SELECT public.grant_org_capability(%L, %L)', pg_temp.id('a_unv'), 'resident_broadcaster'),
  'only verified households');
SELECT pg_temp.expect_error('P0a', 'A admin grant equipment_custodian to plain resident (D17) -> refused',
  pg_temp.id('a_admin'), format('SELECT public.grant_org_capability(%L, %L)', pg_temp.id('a_res'), 'equipment_custodian'),
  'must be a watch member');
SELECT pg_temp.check('P0a', 'control: A admin grants resident_broadcaster to verified A resident',
  pg_temp.id('a_admin'), 'ok', format('SELECT public.grant_org_capability(%L, %L, %L)', pg_temp.id('a_res'), 'resident_broadcaster', 'G7 street rep'));
SELECT pg_temp.check('P0a', 'control: A admin grants equipment_custodian to A patroller',
  pg_temp.id('a_admin'), 'ok', format('SELECT public.grant_org_capability(%L, %L)', pg_temp.id('a_pat'), 'equipment_custodian'));
SELECT pg_temp.check('P0a', 'control: B admin grants resident_broadcaster to B resident',
  pg_temp.id('b_admin'), 'ok', format('SELECT public.grant_org_capability(%L, %L)', pg_temp.id('b_res'), 'resident_broadcaster'));
SELECT pg_temp.assert('P0a', 'activity_logs row written for A grant',
  EXISTS (SELECT 1 FROM public.activity_logs l WHERE l.action = 'capability_granted'
          AND l.organization_id = pg_temp.id('org_a') AND l.details_json->>'target_user_id' = pg_temp.id('a_res')::text),
  'checked as postgres');
SELECT pg_temp.expect_rows('P0a', 'A resident reads only own grants (table)',
  pg_temp.id('a_res'), 'SELECT 1 FROM public.org_capability_grants', 1);
SELECT pg_temp.expect_rows('P0a', 'A resident cannot list_org_capability_grants',
  pg_temp.id('a_res'), 'SELECT * FROM public.list_org_capability_grants(true)', 0);
SELECT pg_temp.expect_rows('P0a', 'B admin sees 0 Org A grants (table)',
  pg_temp.id('b_admin'), format('SELECT 1 FROM public.org_capability_grants WHERE organization_id = %L', pg_temp.id('org_a')), 0);
SELECT pg_temp.expect_rows('13', 'A resident list_capability_badges([A res, A pat, B res]) -> A badges only',
  pg_temp.id('a_res'), format('SELECT * FROM public.list_capability_badges(ARRAY[%L, %L, %L]::uuid[])',
    pg_temp.id('a_res'), pg_temp.id('a_pat'), pg_temp.id('b_res')), 2);
SELECT pg_temp.check('P0a', 'A resident has_org_capability(resident_broadcaster) = true',
  pg_temp.id('a_res'), 'true', 'SELECT public.has_org_capability(''resident_broadcaster'')');
SELECT pg_temp.expect_error('P0a', 'authenticated cannot call user_has_org_capability',
  pg_temp.id('a_res'), format('SELECT public.user_has_org_capability(%L, %L, %L)', pg_temp.id('b_res'), 'resident_broadcaster', pg_temp.id('org_b')),
  'permission denied');
SELECT pg_temp.expect_error('P0a', 'A resident direct INSERT org_capability_grants -> denied',
  pg_temp.id('a_res'), format('INSERT INTO public.org_capability_grants (organization_id, user_id, capability) VALUES (%L, %L, %L)',
    pg_temp.id('org_a'), pg_temp.id('a_res'), 'resident_moderator'),
  'permission denied|row-level security');
SELECT pg_temp.expect_error('P0a', 'B admin revoke A grant -> not found',
  pg_temp.id('b_admin'), format('SELECT public.revoke_org_capability(%L)',
    (SELECT id FROM public.org_capability_grants WHERE user_id = pg_temp.id('a_res') AND revoked_at IS NULL)),
  'grant not found');
SELECT pg_temp.expect_error('P0a', 'A committee revoke A grant -> forbidden',
  pg_temp.id('a_comm'), format('SELECT public.revoke_org_capability(%L)',
    (SELECT id FROM public.org_capability_grants WHERE user_id = pg_temp.id('a_pat') AND revoked_at IS NULL)),
  'forbidden');
SELECT pg_temp.check('P0a', 'control: A admin revokes A resident grant',
  pg_temp.id('a_admin'), 'ok', format('SELECT public.revoke_org_capability(%L, %L)',
    (SELECT id FROM public.org_capability_grants WHERE user_id = pg_temp.id('a_res') AND revoked_at IS NULL), 'G7 test'));
SELECT pg_temp.assert('P0a', 'revoke stamped + activity_logs capability_revoked row',
  EXISTS (SELECT 1 FROM public.org_capability_grants WHERE user_id = pg_temp.id('a_res') AND revoked_by = pg_temp.id('a_admin'))
  AND EXISTS (SELECT 1 FROM public.activity_logs l WHERE l.action = 'capability_revoked'
          AND l.organization_id = pg_temp.id('org_a') AND l.details_json->>'target_user_id' = pg_temp.id('a_res')::text),
  'checked as postgres');
SELECT pg_temp.check('P0a', 'A resident get_my_org_capabilities() empty after revoke',
  pg_temp.id('a_res'), 'true', 'SELECT public.get_my_org_capabilities() = ''{}''::text[]');
SELECT pg_temp.expect_rows('P0a', 'A admin list_org_capability_grants(true) -> 2 A grants only',
  pg_temp.id('a_admin'), 'SELECT * FROM public.list_org_capability_grants(true)', 2);
SELECT pg_temp.assert('P0a', 'B grant untouched by A actions',
  EXISTS (SELECT 1 FROM public.org_capability_grants WHERE user_id = pg_temp.id('b_res') AND revoked_at IS NULL),
  'checked as postgres');

-- -----------------------------------------------------------------------------
-- P0b - content reports + community storage buckets. Needs migrations
-- 20261031020000_community_content_reports.sql and
-- 20261031030000_community_storage_buckets.sql applied first.
-- -----------------------------------------------------------------------------
SELECT pg_temp.check('P0b', 'control: A resident reports A notice once',
  pg_temp.id('a_res'), 'ok', format('SELECT public.report_community_content(%L, %L, %L, %L)',
    'area_broadcast', pg_temp.id('a_notice'), 'spam', 'G7 report'));
SELECT pg_temp.expect_error('P0b', 'A resident reports same notice again -> already reported',
  pg_temp.id('a_res'), format('SELECT public.report_community_content(%L, %L, %L)',
    'area_broadcast', pg_temp.id('a_notice'), 'offensive'),
  'already reported');
SELECT pg_temp.expect_error('P0b', 'B resident reports A notice -> not found',
  pg_temp.id('b_res'), format('SELECT public.report_community_content(%L, %L, %L)',
    'area_broadcast', pg_temp.id('a_notice'), 'spam'),
  'content not found');
SELECT pg_temp.expect_error('P0b', 'unsupported content type -> friendly error',
  pg_temp.id('a_res'), format('SELECT public.report_community_content(%L, %L, %L)',
    'service_listing', pg_temp.id('a_notice'), 'spam'),
  'cannot be reported yet');
SELECT pg_temp.expect_rows('P0b', 'A nw_admin (moderator) sees the A report',
  pg_temp.id('a_admin'), format('SELECT 1 FROM public.community_content_reports WHERE content_id = %L', pg_temp.id('a_notice')), 1);
SELECT pg_temp.expect_rows('P0b', 'B nw_admin sees 0 Org A reports',
  pg_temp.id('b_admin'), format('SELECT 1 FROM public.community_content_reports WHERE organization_id = %L', pg_temp.id('org_a')), 0);
SELECT pg_temp.expect_rows('P0b', 'B resident sees 0 reports',
  pg_temp.id('b_res'), 'SELECT 1 FROM public.community_content_reports', 0);
SELECT pg_temp.expect_error('P0b', 'A resident direct INSERT community_content_reports -> denied',
  pg_temp.id('a_res'), format('INSERT INTO public.community_content_reports (organization_id, content_type, content_id, reporter_user_id, reason) VALUES (%L, %L, %L, %L, %L)',
    pg_temp.id('org_a'), 'area_broadcast', pg_temp.id('a_notice'), pg_temp.id('a_res'), 'other'),
  'permission denied|row-level security');

-- Storage (metadata rows only, rolled back).
SELECT pg_temp.check('P0b', 'control: A resident upload community-media/<org A>/needs/... ok',
  pg_temp.id('a_res'), 'ok',
  format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)',
         'community-media', pg_temp.id('org_a') || '/needs/' || pg_temp.id('a_notice') || '/1_0.jpg', pg_temp.id('a_res')));
SELECT pg_temp.expect_error('P0b', 'A resident upload community-media/<org B>/... -> denied',
  pg_temp.id('a_res'),
  format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)',
         'community-media', pg_temp.id('org_b') || '/needs/x/1_0.jpg', pg_temp.id('a_res')),
  'row-level security|permission denied');
SELECT pg_temp.expect_error('P0b', 'A resident upload community-media/<not a uuid>/... -> denied',
  pg_temp.id('a_res'),
  format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)',
         'community-media', 'not-a-uuid/needs/x/1_0.jpg', pg_temp.id('a_res')),
  'row-level security|permission denied');
SELECT pg_temp.check('P0b', 'control: A patroller upload community-private/<org A>/equipment/... ok',
  pg_temp.id('a_pat'), 'ok',
  format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)',
         'community-private', pg_temp.id('org_a') || '/equipment/x/invoice/1_0.pdf', pg_temp.id('a_pat')));
SELECT pg_temp.expect_error('P0b', 'B resident upload community-private/<org A>/... -> denied',
  pg_temp.id('b_res'),
  format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L)',
         'community-private', pg_temp.id('org_a') || '/equipment/x/invoice/1_0.pdf', pg_temp.id('b_res')),
  'row-level security|permission denied');
SELECT pg_temp.expect_rows('P0b', 'B resident cannot read community-private objects (no SELECT policy yet)',
  pg_temp.id('b_res'), 'SELECT 1 FROM storage.objects WHERE bucket_id = ''community-private''', 0);

-- -----------------------------------------------------------------------------
-- Role-change fix - admin_set_user_role. Needs migration
-- 20261031040000_admin_set_user_role.sql applied first.
-- -----------------------------------------------------------------------------
SELECT pg_temp.check('ROLE', 'control: A nw_admin demotes A patroller to resident',
  pg_temp.id('a_admin'), 'ok', format('SELECT public.admin_set_user_role(%L, %L)', pg_temp.id('a_pat'), 'resident'));
SELECT pg_temp.assert('ROLE', 'A patroller saved as resident and member_role synced',
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = pg_temp.id('a_pat') AND u.role::text = 'resident')
  AND EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = pg_temp.id('a_pat')
              AND om.organization_id = pg_temp.id('org_a') AND om.member_role = 'resident'),
  'checked as postgres');
SELECT pg_temp.check('ROLE', 'same role again -> ok, no write',
  pg_temp.id('a_admin'), 'ok', format('SELECT public.admin_set_user_role(%L, %L)', pg_temp.id('a_pat'), 'resident'));
SELECT pg_temp.assert('ROLE', 'unchanged role adds no role_changed log row (exactly 1)',
  (SELECT count(*) FROM public.activity_logs l WHERE l.action = 'role_changed'
     AND l.details_json->>'subject_user_id' = pg_temp.id('a_pat')::text) = 1,
  'checked as postgres');
SELECT pg_temp.expect_error('ROLE', 'A nw_admin changes B resident -> not found',
  pg_temp.id('a_admin'), format('SELECT public.admin_set_user_role(%L, %L)', pg_temp.id('b_res'), 'patroller'),
  'not found');
SELECT pg_temp.expect_error('ROLE', 'A resident changes another A user -> forbidden',
  pg_temp.id('a_res'), format('SELECT public.admin_set_user_role(%L, %L)', pg_temp.id('a_unv'), 'patroller'),
  'forbidden');
SELECT pg_temp.expect_error('ROLE', 'A nw_admin sets admin -> refused',
  pg_temp.id('a_admin'), format('SELECT public.admin_set_user_role(%L, %L)', pg_temp.id('a_res'), 'admin'),
  'cannot be assigned');
SELECT pg_temp.expect_error('ROLE', 'A nw_admin sets city_admin -> platform staff only',
  pg_temp.id('a_admin'), format('SELECT public.admin_set_user_role(%L, %L)', pg_temp.id('a_res'), 'city_admin'),
  'only platform staff');
SELECT pg_temp.expect_error('ROLE', 'A committee appoints nw_admin -> refused (D1)',
  pg_temp.id('a_comm'), format('SELECT public.admin_set_user_role(%L, %L)', pg_temp.id('a_res'), 'nw_admin'),
  'only an NW admin');
SELECT pg_temp.expect_error('ROLE', 'A nw_admin changes own role -> refused',
  pg_temp.id('a_admin'), format('SELECT public.admin_set_user_role(%L, %L)', pg_temp.id('a_admin'), 'resident'),
  'own role');
-- -----------------------------------------------------------------------------
-- P1 - resident street reps / moderators. Needs migrations
-- 20261031050000_area_broadcast_moderators.sql and
-- 20261031060000_capability_auto_revoke_on_move.sql applied first.
-- -----------------------------------------------------------------------------
SELECT pg_temp.check('P1', 'control: A admin re-grants resident_broadcaster to A resident',
  pg_temp.id('a_admin'), 'ok', format('SELECT public.grant_org_capability(%L, %L, %L)', pg_temp.id('a_res'), 'resident_broadcaster', 'G7 street rep'));
SELECT pg_temp.check('P1', 'control: A street rep posts notice 1 of 3',
  pg_temp.id('a_res'), 'ok', 'SELECT public.post_area_broadcast(''G7 rep 1'', ''body'')');
SELECT pg_temp.check('P1', 'control: A street rep posts notice 2 of 3',
  pg_temp.id('a_res'), 'ok', 'SELECT public.post_area_broadcast(''G7 rep 2'', ''body'')');
SELECT pg_temp.check('P1', 'control: A street rep posts notice 3 of 3',
  pg_temp.id('a_res'), 'ok', 'SELECT public.post_area_broadcast(''G7 rep 3'', ''body'')');
SELECT pg_temp.expect_error('P1', 'A street rep 4th notice in 24h -> daily limit',
  pg_temp.id('a_res'), 'SELECT public.post_area_broadcast(''G7 rep 4'', ''body'')', 'daily notice limit');
SELECT pg_temp.assert('P1', 'street rep notices saved in Org A with author_badge = street_rep',
  (SELECT count(*) FROM public.area_broadcasts WHERE author_id = pg_temp.id('a_res')
     AND organization_id = pg_temp.id('org_a') AND author_badge = 'street_rep') = 3,
  'checked as postgres');
SELECT pg_temp.check('P1', 'A street rep my_area_broadcast_quota() = 0',
  pg_temp.id('a_res'), 'true', 'SELECT public.my_area_broadcast_quota() = 0');
SELECT pg_temp.check('P1', 'control: B street rep posts a notice',
  pg_temp.id('b_res'), 'ok', 'SELECT public.post_area_broadcast(''G7 B rep'', ''body'')');
SELECT pg_temp.expect_rows('2', 'B resident list_area_broadcasts sees 0 A street-rep notices',
  pg_temp.id('b_res'), format('SELECT * FROM public.list_area_broadcasts(50) WHERE author_id = %L', pg_temp.id('a_res')), 0);
SELECT pg_temp.expect_rows('2', 'B resident reads 0 A street-rep notices (table)',
  pg_temp.id('b_res'), format('SELECT 1 FROM public.area_broadcasts WHERE author_id = %L', pg_temp.id('a_res')), 0);
SELECT pg_temp.expect_error('P1', 'A street rep (no moderator) list_hidden_area_broadcasts -> forbidden',
  pg_temp.id('a_res'), 'SELECT * FROM public.list_hidden_area_broadcasts()', 'forbidden');
SELECT pg_temp.expect_error('P1', 'A street rep (no moderator) list_community_reports -> forbidden',
  pg_temp.id('a_res'), 'SELECT * FROM public.list_community_reports()', 'forbidden');
SELECT pg_temp.check('P1', 'control: A admin grants resident_moderator to A resident',
  pg_temp.id('a_admin'), 'ok', format('SELECT public.grant_org_capability(%L, %L)', pg_temp.id('a_res'), 'resident_moderator'));
SELECT pg_temp.expect_error('P1', 'A moderator hides B street-rep notice -> not found',
  pg_temp.id('a_res'), format('SELECT public.hide_area_broadcast(%L)',
    (SELECT id FROM public.area_broadcasts WHERE author_id = pg_temp.id('b_res') LIMIT 1)),
  'notice not found');
SELECT pg_temp.expect_error('P1', 'A moderator hides staff notice -> forbidden',
  pg_temp.id('a_res'), format('SELECT public.hide_area_broadcast(%L)', pg_temp.id('a_notice')), 'forbidden');
SELECT pg_temp.check('P1', 'control: A moderator hides an A street-rep notice',
  pg_temp.id('a_res'), 'ok', format('SELECT public.hide_area_broadcast(%L, %L)',
    (SELECT id FROM public.area_broadcasts WHERE author_id = pg_temp.id('a_res') AND headline = 'G7 rep 1'), 'G7 test'));
SELECT pg_temp.assert('P1', 'moderator hide logged with capability key',
  EXISTS (SELECT 1 FROM public.activity_logs l WHERE l.organization_id = pg_temp.id('org_a')
          AND l.user_id = pg_temp.id('a_res') AND l.details_json ? 'capability'),
  'checked as postgres');
SELECT pg_temp.expect_rows('P1', 'A moderator list_hidden_area_broadcasts -> 1 badge notice',
  pg_temp.id('a_res'), 'SELECT * FROM public.list_hidden_area_broadcasts()', 1);
SELECT pg_temp.expect_error('P1', 'A unverified resident list_hidden_area_broadcasts -> forbidden',
  pg_temp.id('a_unv'), 'SELECT * FROM public.list_hidden_area_broadcasts()', 'forbidden');
SELECT pg_temp.check('P1', 'A moderator list_community_reports -> 1 grouped row, reporter_ids hidden',
  pg_temp.id('a_res'), 'true',
  format('SELECT count(*) = 1 AND bool_and(reporter_ids IS NULL) FROM public.list_community_reports() WHERE content_id = %L', pg_temp.id('a_notice')));
SELECT pg_temp.check('P1', 'A nw_admin list_community_reports -> reporter_ids visible',
  pg_temp.id('a_admin'), 'true',
  format('SELECT bool_and(reporter_ids IS NOT NULL) FROM public.list_community_reports() WHERE content_id = %L', pg_temp.id('a_notice')));
SELECT pg_temp.expect_rows('P1', 'B nw_admin list_community_reports sees 0 Org A reports',
  pg_temp.id('b_admin'), format('SELECT * FROM public.list_community_reports() WHERE content_id = %L', pg_temp.id('a_notice')), 0);
SELECT pg_temp.expect_error('P1', 'B nw_admin resolve A report -> not found',
  pg_temp.id('b_admin'), format('SELECT public.resolve_community_report(%L, %L)',
    (SELECT id FROM public.community_content_reports WHERE content_id = pg_temp.id('a_notice') AND status = 'open' LIMIT 1), 'dismissed'),
  'report not found');
SELECT pg_temp.check('P1', 'control: A moderator dismisses the A report',
  pg_temp.id('a_res'), 'ok', format('SELECT public.resolve_community_report(%L, %L, %L)',
    (SELECT id FROM public.community_content_reports WHERE content_id = pg_temp.id('a_notice') AND status = 'open' LIMIT 1), 'dismissed', 'G7 test'));
SELECT pg_temp.assert('P1', 'report dismissed + content_report_resolved logged',
  NOT EXISTS (SELECT 1 FROM public.community_content_reports WHERE content_id = pg_temp.id('a_notice') AND status = 'open')
  AND EXISTS (SELECT 1 FROM public.activity_logs l WHERE l.action = 'content_report_resolved' AND l.organization_id = pg_temp.id('org_a')),
  'checked as postgres');
SELECT pg_temp.expect_error('P1', 'resolve same report again -> already handled',
  pg_temp.id('a_res'), format('SELECT public.resolve_community_report(%L, %L)',
    (SELECT id FROM public.community_content_reports WHERE content_id = pg_temp.id('a_notice') LIMIT 1), 'actioned'),
  'already handled');
SELECT pg_temp.expect_error('P1', 'authenticated cannot call revoke_capabilities_outside_org',
  pg_temp.id('a_res'), format('SELECT public.revoke_capabilities_outside_org(%L, %L)', pg_temp.id('b_res'), 'x'),
  'permission denied');
-- Auto-revoke (as postgres): A resident leaves Org A and moves to Org B.
DELETE FROM public.organization_members WHERE user_id = pg_temp.id('a_res') AND organization_id = pg_temp.id('org_a');
UPDATE public.users SET organization_id = pg_temp.id('org_b') WHERE id = pg_temp.id('a_res');
SELECT pg_temp.assert('10', 'moving A resident to Org B auto-revokes both Org A grants',
  NOT EXISTS (SELECT 1 FROM public.org_capability_grants WHERE user_id = pg_temp.id('a_res') AND revoked_at IS NULL)
  AND (SELECT count(*) FROM public.activity_logs l WHERE l.action = 'capability_revoked'
         AND l.details_json->>'target_user_id' = pg_temp.id('a_res')::text
         AND (l.details_json->>'automatic')::boolean) = 2,
  'checked as postgres');
SELECT pg_temp.assert('P1', 'B grant untouched by A move',
  EXISTS (SELECT 1 FROM public.org_capability_grants WHERE user_id = pg_temp.id('b_res') AND revoked_at IS NULL),
  'checked as postgres');
SELECT pg_temp.expect_error('P1', 'moved resident can no longer post as street rep',
  pg_temp.id('a_res'), 'SELECT public.post_area_broadcast(''G7 after move'', ''body'')', 'forbidden|daily notice');
-- -----------------------------------------------------------------------------
-- P2 - needs board (equipment wishlist). Needs migration
-- 20261031070000_equipment_wishlist.sql applied first.
-- State here: a_res moved to Org B above; a_unv (unverified) and a_pat
-- (resident + equipment_custodian) are still in Org A.
-- -----------------------------------------------------------------------------
SELECT pg_temp.check('P2', 'control: A nw_admin adds needs item (qty 2)',
  pg_temp.id('a_admin'), 'ok',
  'SELECT public.upsert_wishlist_item(NULL, ''G7 radio'', ''for patrols'', NULL, 2, 85000, ''https://example.com/radio'', ''RAD-1'')');
SELECT pg_temp.expect_error('P2', 'A committee adds needs item -> forbidden (D4)',
  pg_temp.id('a_comm'), 'SELECT public.upsert_wishlist_item(NULL, ''G7 x'')', 'forbidden');
SELECT pg_temp.expect_error('P2', 'A resident adds needs item -> forbidden',
  pg_temp.id('a_unv'), 'SELECT public.upsert_wishlist_item(NULL, ''G7 x'')', 'forbidden');
SELECT pg_temp.expect_error('4', 'A nw_admin photo path in Org B folder -> invalid photo path',
  pg_temp.id('a_admin'), format('SELECT public.upsert_wishlist_item(NULL, %L, NULL, %L)', 'G7 x', pg_temp.id('org_b') || '/needs/x/1_0.jpg'),
  'invalid photo path');
SELECT pg_temp.expect_error('P2', 'A nw_admin http:// store link -> refused',
  pg_temp.id('a_admin'), 'SELECT public.upsert_wishlist_item(NULL, ''G7 x'', NULL, NULL, 1, NULL, ''http://example.com'')',
  'https');
SELECT pg_temp.check('P2', 'control: A custodian adds a second item',
  pg_temp.id('a_pat'), 'ok', 'SELECT public.upsert_wishlist_item(NULL, ''G7 torch'')');
SELECT pg_temp.expect_rows('4', 'B resident reads 0 Org A needs items (table)',
  pg_temp.id('b_res'), format('SELECT 1 FROM public.equipment_wishlist_items WHERE organization_id = %L', pg_temp.id('org_a')), 0);
SELECT pg_temp.expect_rows('4', 'B nw_admin list_wishlist_items sees 0 Org A items',
  pg_temp.id('b_admin'), 'SELECT * FROM public.list_wishlist_items() WHERE title LIKE ''G7 %''', 0);
SELECT pg_temp.expect_rows('4', 'A resident list_wishlist_items sees both A items',
  pg_temp.id('a_unv'), 'SELECT * FROM public.list_wishlist_items() WHERE title LIKE ''G7 %''', 2);
SELECT pg_temp.expect_error('4', 'B nw_admin edits A item -> not found',
  pg_temp.id('b_admin'), format('SELECT public.upsert_wishlist_item(%L, %L)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 radio'), 'hijack'),
  'item not found');
SELECT pg_temp.expect_error('4', 'B nw_admin sets A item status -> not found',
  pg_temp.id('b_admin'), format('SELECT public.set_wishlist_item_status(%L, %L)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 radio'), 'cancelled'),
  'item not found');
SELECT pg_temp.expect_error('P2', 'A resident direct INSERT needs item -> denied',
  pg_temp.id('a_unv'), format('INSERT INTO public.equipment_wishlist_items (organization_id, title) VALUES (%L, %L)', pg_temp.id('org_a'), 'G7 forged'),
  'permission denied|row-level security');
SELECT pg_temp.expect_error('P2', 'offer note with 10-digit number -> payment details refused',
  pg_temp.id('a_unv'), format('SELECT public.create_wishlist_offer(%L, %L, NULL, %L)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 radio'), 'contribute_item', 'call 0821234567'),
  'payment details');
SELECT pg_temp.expect_error('P2', 'offer note mentioning IBAN -> payment details refused',
  pg_temp.id('a_unv'), format('SELECT public.create_wishlist_offer(%L, %L, NULL, %L)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 radio'), 'contribute_item', 'my IBAN is below'),
  'payment details');
SELECT pg_temp.check('5', 'control: unverified A resident offers to help (D7)',
  pg_temp.id('a_unv'), 'ok', format('SELECT public.create_wishlist_offer(%L, %L, 1, %L)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 radio'), 'contribute_item', 'spare radio'));
SELECT pg_temp.expect_error('P2', 'second open offer on same item -> already offered',
  pg_temp.id('a_unv'), format('SELECT public.create_wishlist_offer(%L)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 radio')),
  'already offered');
SELECT pg_temp.expect_error('5', 'B resident offers on A item -> not found',
  pg_temp.id('b_res'), format('SELECT public.create_wishlist_offer(%L)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 radio')),
  'item not found');
SELECT pg_temp.assert('P2', 'A managers got an in-app wishlist notice (nw_admin + custodian)',
  (SELECT count(DISTINCT n.user_id) FROM public.app_notifications n
   WHERE n.kind = 'wishlist' AND n.user_id IN (pg_temp.id('a_admin'), pg_temp.id('a_pat'))) = 2,
  'checked as postgres (needs default in-app prefs)');
SELECT pg_temp.expect_rows('14', 'A resident reads own offer only (table)',
  pg_temp.id('a_unv'), 'SELECT 1 FROM public.equipment_wishlist_offers', 1);
SELECT pg_temp.expect_rows('14', 'A committee (not manager) reads 0 offers (D5)',
  pg_temp.id('a_comm'), 'SELECT 1 FROM public.equipment_wishlist_offers', 0);
SELECT pg_temp.expect_rows('14', 'B nw_admin reads 0 Org A offers (table)',
  pg_temp.id('b_admin'), format('SELECT 1 FROM public.equipment_wishlist_offers WHERE organization_id = %L', pg_temp.id('org_a')), 0);
SELECT pg_temp.check('15', 'A nw_admin list_wishlist_offers -> 1 offer with offerer name',
  pg_temp.id('a_admin'), 'true', 'SELECT count(*) = 1 AND bool_and(full_name IS NOT NULL) FROM public.list_wishlist_offers()');
SELECT pg_temp.expect_error('15', 'A committee list_wishlist_offers -> forbidden',
  pg_temp.id('a_comm'), 'SELECT * FROM public.list_wishlist_offers()', 'forbidden');
SELECT pg_temp.expect_error('15', 'B nw_admin list_wishlist_offers(A item) -> not found',
  pg_temp.id('b_admin'), format('SELECT * FROM public.list_wishlist_offers(%L)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 radio')),
  'item not found');
SELECT pg_temp.expect_error('15', 'B nw_admin responds to A offer -> not found',
  pg_temp.id('b_admin'), format('SELECT public.respond_wishlist_offer(%L, %L)',
    (SELECT id FROM public.equipment_wishlist_offers WHERE user_id = pg_temp.id('a_unv') LIMIT 1), 'declined'),
  'offer not found');
SELECT pg_temp.expect_error('P2', 'B resident withdraws A offer -> not found',
  pg_temp.id('b_res'), format('SELECT public.withdraw_wishlist_offer(%L)',
    (SELECT id FROM public.equipment_wishlist_offers WHERE user_id = pg_temp.id('a_unv') LIMIT 1)),
  'offer not found');
SELECT pg_temp.check('P2', 'control: A nw_admin acknowledges the offer',
  pg_temp.id('a_admin'), 'ok', format('SELECT public.respond_wishlist_offer(%L, %L)',
    (SELECT id FROM public.equipment_wishlist_offers WHERE user_id = pg_temp.id('a_unv') LIMIT 1), 'acknowledged'));
SELECT pg_temp.check('P2', 'control: A custodian marks 2 of 2 acquired',
  pg_temp.id('a_pat'), 'ok', format('SELECT public.set_wishlist_item_status(%L, NULL, 2)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 radio')));
SELECT pg_temp.assert('P2', 'qty acquired = needed auto-flips to acquired + offerer notified',
  EXISTS (SELECT 1 FROM public.equipment_wishlist_items WHERE title = 'G7 radio' AND status = 'acquired' AND acquired_at IS NOT NULL)
  AND EXISTS (SELECT 1 FROM public.app_notifications n WHERE n.user_id = pg_temp.id('a_unv') AND n.kind = 'wishlist'),
  'checked as postgres');
SELECT pg_temp.expect_error('P2', 'offer on acquired item -> no longer needed',
  pg_temp.id('a_comm'), format('SELECT public.create_wishlist_offer(%L)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 radio')),
  'no longer needed');
SELECT pg_temp.check('P2', 'control: A nw_admin cancels the torch item',
  pg_temp.id('a_admin'), 'ok', format('SELECT public.set_wishlist_item_status(%L, %L)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 torch'), 'cancelled'));
SELECT pg_temp.expect_rows('4', 'A resident cannot see cancelled item',
  pg_temp.id('a_unv'), 'SELECT 1 FROM public.equipment_wishlist_items WHERE title = ''G7 torch''', 0);
SELECT pg_temp.expect_rows('4', 'A nw_admin still sees cancelled item',
  pg_temp.id('a_admin'), 'SELECT * FROM public.list_wishlist_items() WHERE title = ''G7 torch''', 1);
-- Rate limit (D8): five more needed items, inserted as postgres.
INSERT INTO public.equipment_wishlist_items (organization_id, title)
SELECT pg_temp.id('org_a'), 'G7 bulk ' || g FROM generate_series(1, 5) g;
SELECT pg_temp.expect_error('P2', '6th offer in 24 h -> offer limit (D8)',
  pg_temp.id('a_unv'), 'SELECT public.create_wishlist_offer(id) FROM public.equipment_wishlist_items WHERE title LIKE ''G7 bulk %'' ORDER BY title',
  'offer limit');
SELECT pg_temp.check('P2', 'control: A resident withdraws own offer',
  pg_temp.id('a_unv'), 'ok', format('SELECT public.withdraw_wishlist_offer(%L)',
    (SELECT id FROM public.equipment_wishlist_offers WHERE user_id = pg_temp.id('a_unv') LIMIT 1)));
SELECT pg_temp.expect_error('P2', 'authenticated cannot call withdraw_wishlist_offers_outside_org',
  pg_temp.id('a_unv'), format('SELECT public.withdraw_wishlist_offers_outside_org(%L)', pg_temp.id('a_pat')),
  'permission denied');
SELECT pg_temp.check('P2', 'control: A custodian offers on a bulk item',
  pg_temp.id('a_pat'), 'ok', format('SELECT public.create_wishlist_offer(%L)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 1')));
-- Move (as postgres): A custodian leaves Org A for Org B.
DELETE FROM public.organization_members WHERE user_id = pg_temp.id('a_pat') AND organization_id = pg_temp.id('org_a');
UPDATE public.users SET organization_id = pg_temp.id('org_b') WHERE id = pg_temp.id('a_pat');
SELECT pg_temp.assert('P2', 'move withdraws open Org A offers and revokes custodian grant',
  NOT EXISTS (SELECT 1 FROM public.equipment_wishlist_offers WHERE user_id = pg_temp.id('a_pat') AND status IN ('new', 'acknowledged', 'accepted'))
  AND EXISTS (SELECT 1 FROM public.equipment_wishlist_offers WHERE user_id = pg_temp.id('a_pat') AND status = 'withdrawn' AND handled_note = 'moved neighbourhood')
  AND NOT EXISTS (SELECT 1 FROM public.org_capability_grants WHERE user_id = pg_temp.id('a_pat') AND revoked_at IS NULL),
  'checked as postgres');
SELECT pg_temp.expect_error('P2', 'moved custodian edits Org A item -> not found',
  pg_temp.id('a_pat'), format('SELECT public.upsert_wishlist_item(%L, %L)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 1'), 'x'),
  'item not found');
-- -----------------------------------------------------------------------------
-- P2.1 - gallery photos (max 5, per-item path) + partial acquisition.
-- Needs 20261031071000_wishlist_multi_photos.sql. Uses the 'G7 bulk N' items above.
-- -----------------------------------------------------------------------------
SELECT pg_temp.check('P2.1', 'control: A nw_admin sets 5 gallery photos',
  pg_temp.id('a_admin'), 'ok',
  (SELECT format('SELECT public.set_wishlist_item_photos(%L, ARRAY[%L, %L, %L, %L, %L])', i.id,
     p || '1.jpg', p || '2.jpg', p || '3.jpg', p || '4.jpg', p || '5.jpg')
   FROM public.equipment_wishlist_items i,
        LATERAL (SELECT i.organization_id::text || '/needs/' || i.id::text || '/' AS p) x
   WHERE i.title = 'G7 bulk 2'));
SELECT pg_temp.assert('P2.1', 'gallery stored in order; cover = first photo',
  (SELECT cardinality(photo_paths) = 5 AND photo_path = photo_paths[1] AND photo_path LIKE '%/1.jpg'
   FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 2'),
  'checked as postgres');
SELECT pg_temp.check('P2.1', 'A resident sees 5 photos via list_wishlist_items',
  pg_temp.id('a_unv'), 'true',
  'SELECT cardinality(photo_paths) = 5 FROM public.list_wishlist_items() WHERE title = ''G7 bulk 2''');
SELECT pg_temp.expect_error('P2.1', '6 photos -> refused (max 5)',
  pg_temp.id('a_admin'),
  (SELECT format('SELECT public.set_wishlist_item_photos(%L, ARRAY[%L, %L, %L, %L, %L, %L])', i.id,
     p || '1.jpg', p || '2.jpg', p || '3.jpg', p || '4.jpg', p || '5.jpg', p || '6.jpg')
   FROM public.equipment_wishlist_items i,
        LATERAL (SELECT i.organization_id::text || '/needs/' || i.id::text || '/' AS p) x
   WHERE i.title = 'G7 bulk 2'),
  'up to 5 photos');
SELECT pg_temp.expect_error('P2.1', 'photo path in Org B folder -> invalid photo path',
  pg_temp.id('a_admin'),
  (SELECT format('SELECT public.set_wishlist_item_photos(%L, ARRAY[%L])', i.id,
     pg_temp.id('org_b')::text || '/needs/' || i.id::text || '/x.jpg')
   FROM public.equipment_wishlist_items i WHERE i.title = 'G7 bulk 2'),
  'invalid photo path');
SELECT pg_temp.expect_error('P2.1', 'photo path under another A item -> invalid photo path',
  pg_temp.id('a_admin'),
  (SELECT format('SELECT public.set_wishlist_item_photos(%L, ARRAY[%L])', i.id,
     i.organization_id::text || '/needs/' || o.id::text || '/x.jpg')
   FROM public.equipment_wishlist_items i, public.equipment_wishlist_items o
   WHERE i.title = 'G7 bulk 2' AND o.title = 'G7 bulk 3'),
  'invalid photo path');
SELECT pg_temp.expect_error('P2.1', 'photo path with .. -> invalid photo path',
  pg_temp.id('a_admin'),
  (SELECT format('SELECT public.set_wishlist_item_photos(%L, ARRAY[%L])', i.id,
     i.organization_id::text || '/needs/' || i.id::text || '/../../x.jpg')
   FROM public.equipment_wishlist_items i WHERE i.title = 'G7 bulk 2'),
  'invalid photo path');
SELECT pg_temp.expect_error('P2.1', 'B nw_admin sets photos on A item -> not found',
  pg_temp.id('b_admin'),
  format('SELECT public.set_wishlist_item_photos(%L, ARRAY[]::text[])',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 2')),
  'item not found');
SELECT pg_temp.expect_error('P2.1', 'A committee (not manager) sets photos -> forbidden',
  pg_temp.id('a_comm'),
  format('SELECT public.set_wishlist_item_photos(%L, ARRAY[]::text[])',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 2')),
  'forbidden');
-- Partial acquisition: G7 bulk 3 needs 1 by default, so make it 4 first (as postgres).
UPDATE public.equipment_wishlist_items SET quantity_needed = 4 WHERE title = 'G7 bulk 3';
SELECT pg_temp.check('P2.1', 'control: A nw_admin records 1 of 4 acquired',
  pg_temp.id('a_admin'), 'ok',
  format('SELECT public.set_wishlist_item_acquired(%L, 1)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 3')));
SELECT pg_temp.assert('P2.1', 'partial acquisition keeps the item needed',
  (SELECT status = 'needed' AND quantity_acquired = 1 FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 3'),
  'checked as postgres');
SELECT pg_temp.check('P2.1', 'control: A nw_admin records 4 of 4 acquired',
  pg_temp.id('a_admin'), 'ok',
  format('SELECT public.set_wishlist_item_acquired(%L, 4)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 3')));
SELECT pg_temp.assert('P2.1', 'full acquisition flips the item to acquired',
  (SELECT status = 'acquired' AND quantity_acquired = 4 AND acquired_at IS NOT NULL
   FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 3'),
  'checked as postgres');
SELECT pg_temp.check('P2.1', 'control: lowering to 3 of 4 reopens it as needed',
  pg_temp.id('a_admin'), 'true',
  format('SELECT status = ''needed'' FROM public.set_wishlist_item_acquired(%L, 3)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 3')));
SELECT pg_temp.expect_error('P2.1', 'acquired above quantity -> refused',
  pg_temp.id('a_admin'),
  format('SELECT public.set_wishlist_item_acquired(%L, 5)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 3')),
  'quantity acquired must be 0 to');
SELECT pg_temp.expect_error('P2.1', 'B nw_admin sets acquired on A item -> not found',
  pg_temp.id('b_admin'),
  format('SELECT public.set_wishlist_item_acquired(%L, 1)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 3')),
  'item not found');
SELECT pg_temp.expect_error('P2.1', 'A resident sets acquired -> forbidden',
  pg_temp.id('a_unv'),
  format('SELECT public.set_wishlist_item_acquired(%L, 1)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 3')),
  'forbidden');

-- -----------------------------------------------------------------------------
-- P2.2 - 'contribute_cost' offers (money arranged privately, never in the app).
-- Needs 20261031072000_wishlist_offer_contribute.sql. Uses 'G7 bulk 4' (needs 1).
-- -----------------------------------------------------------------------------
SELECT pg_temp.check('P2.2', 'control: A committee offers to contribute towards the cost',
  pg_temp.id('a_comm'), 'ok',
  format('SELECT public.create_wishlist_offer(%L, %L, 3, %L)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4'),
    'contribute_cost', 'Happy to contribute towards the cost'));
SELECT pg_temp.assert('P2.2', 'cost contribution stored with no quantity; item still needs 1, 0 acquired',
  EXISTS (SELECT 1 FROM public.equipment_wishlist_offers
          WHERE user_id = pg_temp.id('a_comm') AND kind = 'contribute_cost' AND quantity IS NULL)
  AND (SELECT status = 'needed' AND quantity_acquired = 0
       FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4'),
  'checked as postgres');
SELECT pg_temp.expect_error('P2.2', 'cost contribution note with bank account number -> payment details refused',
  pg_temp.id('a_unv'),
  format('SELECT public.create_wishlist_offer(%L, %L, NULL, %L)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4'),
    'contribute_cost', 'pay into 6212345678901'),
  'payment details');
SELECT pg_temp.check('P2.2', 'control: A nw_admin marks the cost contribution fulfilled',
  pg_temp.id('a_admin'), 'ok',
  format('SELECT public.respond_wishlist_offer(%L, %L)',
    (SELECT id FROM public.equipment_wishlist_offers WHERE user_id = pg_temp.id('a_comm') AND kind = 'contribute_cost'),
    'fulfilled'));
SELECT pg_temp.assert('P2.2', 'fulfilled cost contribution does not count as an item (still needed, 0 acquired)',
  (SELECT status = 'needed' AND quantity_acquired = 0
   FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4'),
  'checked as postgres');
SELECT pg_temp.check('P2.2', 'service_role row with contribute_cost + quantity -> CHECK refuses',
  pg_temp.id('a_admin'), 'error',
  format('INSERT INTO public.equipment_wishlist_offers (organization_id, wishlist_item_id, user_id, kind, quantity) VALUES (%L, %L, %L, %L, 2)',
    pg_temp.id('org_a'), (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 5'), pg_temp.id('a_admin'), 'contribute_cost'),
  'cost_no_qty', 'service_role');

SELECT pg_temp.check('P2.2', 'A resident: contribution contacts = Org A nw_admin names only',
  pg_temp.id('a_unv'), 'true',
  format('SELECT bool_or(full_name = %L) AND NOT bool_or(full_name = %L) FROM public.list_org_contribution_contacts(%L)',
    (SELECT trim(full_name) FROM public.users WHERE id = pg_temp.id('a_admin')),
    (SELECT trim(full_name) FROM public.users WHERE id = pg_temp.id('b_admin')),
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4')));
SELECT pg_temp.expect_rows('P2.2', 'contribution contacts never include a non-admin (committee) name',
  pg_temp.id('a_unv'),
  format('SELECT 1 FROM public.list_org_contribution_contacts(%L) WHERE full_name = %L',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4'),
    (SELECT trim(full_name) FROM public.users WHERE id = pg_temp.id('a_comm'))),
  0);
SELECT pg_temp.expect_error('P2.2', 'B resident contribution contacts for A item -> not found',
  pg_temp.id('b_res'),
  format('SELECT * FROM public.list_org_contribution_contacts(%L)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4')),
  'item not found');

-- -----------------------------------------------------------------------------
-- P2.3 - transparent contributions ledger (append-only). Uses 'G7 bulk 4'.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.raises(p_sql text, p_expect text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN others THEN
  RETURN SQLERRM ~* p_expect;
END;
$$;
SELECT pg_temp.check('P2.3', 'control: A resident offers a cost contribution and shows their name',
  pg_temp.id('a_unv'), 'ok',
  format('SELECT public.create_wishlist_offer(%L, %L, NULL, %L, true)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4'), 'contribute_cost', 'happy to contribute'));
SELECT pg_temp.check('P2.3', 'control: A nw_admin records R500 from the anonymous offer',
  pg_temp.id('a_admin'), 'ok',
  format('SELECT public.record_wishlist_contribution(%L, 50000, NULL, %L)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4'),
    (SELECT id FROM public.equipment_wishlist_offers WHERE user_id = pg_temp.id('a_comm') AND kind = 'contribute_cost')));
SELECT pg_temp.check('P2.3', 'control: A nw_admin records R100 from the named offer',
  pg_temp.id('a_admin'), 'ok',
  format('SELECT public.record_wishlist_contribution(%L, 10000, NULL, %L)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4'),
    (SELECT id FROM public.equipment_wishlist_offers WHERE user_id = pg_temp.id('a_unv') AND kind = 'contribute_cost')));
SELECT pg_temp.check('P2.3', 'control: A nw_admin records R200 unlinked contribution',
  pg_temp.id('a_admin'), 'ok',
  format('SELECT public.record_wishlist_contribution(%L, 20000, NULL, NULL, %L)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4'), 'cash at AGM'));
SELECT pg_temp.expect_rows('P2.3', 'A resident reads the ledger (3 entries)',
  pg_temp.id('a_unv'),
  format('SELECT * FROM public.list_wishlist_ledger(%L)', (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4')),
  3);
SELECT pg_temp.check('P2.3', 'anonymous hides the name; show-my-name shows it',
  pg_temp.id('a_unv'), 'true',
  format('SELECT bool_and(CASE amount_cents WHEN 10000 THEN contributor_name = %L ELSE contributor_name = %L END) AND NOT bool_or(contributor_name = %L) FROM public.list_wishlist_ledger(%L)',
    (SELECT trim(full_name) FROM public.users WHERE id = pg_temp.id('a_unv')), 'Anonymous',
    (SELECT trim(full_name) FROM public.users WHERE id = pg_temp.id('a_comm')),
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4')));
SELECT pg_temp.check('P2.3', 'ledger shows who recorded each entry',
  pg_temp.id('a_unv'), 'true',
  format('SELECT bool_and(recorded_by_name = %L) FROM public.list_wishlist_ledger(%L)',
    (SELECT trim(full_name) FROM public.users WHERE id = pg_temp.id('a_admin')),
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4')));
SELECT pg_temp.expect_error('P2.3', 'A resident reads ledger table directly -> denied',
  pg_temp.id('a_unv'), 'SELECT 1 FROM public.wishlist_ledger_entries', 'permission denied');
SELECT pg_temp.expect_error('P2.3', 'A resident inserts a ledger row directly -> denied',
  pg_temp.id('a_unv'),
  format('INSERT INTO public.wishlist_ledger_entries (organization_id, item_id, kind, amount_cents, recorded_by) VALUES (%L, %L, %L, 100, %L)',
    pg_temp.id('org_a'), (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4'), 'contribution_received', pg_temp.id('a_unv')),
  'permission denied');
SELECT pg_temp.expect_error('P2.3', 'A resident records a contribution -> forbidden',
  pg_temp.id('a_unv'),
  format('SELECT public.record_wishlist_contribution(%L, 100)', (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4')),
  'forbidden');
SELECT pg_temp.expect_error('P2.3', 'A nw_admin UPDATEs a ledger row -> blocked',
  pg_temp.id('a_admin'), 'UPDATE public.wishlist_ledger_entries SET amount_cents = 1', 'permission denied|append-only');
SELECT pg_temp.expect_error('P2.3', 'A nw_admin DELETEs a ledger row -> blocked',
  pg_temp.id('a_admin'), 'DELETE FROM public.wishlist_ledger_entries', 'permission denied|append-only');
-- Split into separate statements: TRUNCATE refuses to run while the same
-- statement still has the table open ("being used by active queries").
SELECT pg_temp.assert('P2.3', 'even the table owner cannot UPDATE / DELETE / TRUNCATE (trigger)',
  pg_temp.raises('UPDATE public.wishlist_ledger_entries SET amount_cents = 1', 'append-only')
  AND pg_temp.raises('DELETE FROM public.wishlist_ledger_entries', 'append-only')
  AND pg_temp.raises('TRUNCATE public.wishlist_ledger_entries', 'append-only'),
  'checked as postgres');
SELECT pg_temp.assert('P2.3', 'ledger rows intact after blocked owner UPDATE / DELETE / TRUNCATE',
  (SELECT count(*) = 3 FROM public.wishlist_ledger_entries l
     JOIN public.equipment_wishlist_items i ON i.id = l.item_id WHERE i.title = 'G7 bulk 4'),
  'checked as postgres');
SELECT pg_temp.expect_error('P2.3', 'B nw_admin reads A ledger -> not found',
  pg_temp.id('b_admin'),
  format('SELECT * FROM public.list_wishlist_ledger(%L)', (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4')),
  'item not found');
SELECT pg_temp.expect_error('P2.3', 'B nw_admin records contribution on A item -> not found',
  pg_temp.id('b_admin'),
  format('SELECT public.record_wishlist_contribution(%L, 100)', (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4')),
  'item not found');
SELECT pg_temp.expect_error('P2.3', 'B nw_admin corrects A entry -> not found',
  pg_temp.id('b_admin'),
  format('SELECT public.record_wishlist_correction(%L, 100, %L)',
    (SELECT l.id FROM public.wishlist_ledger_entries l WHERE l.amount_cents = 20000 AND l.kind = 'contribution_received'
       AND l.organization_id = pg_temp.id('org_a') LIMIT 1), 'x'),
  'entry not found');
SELECT pg_temp.expect_rows('P2.3', 'B nw_admin ledger totals show 0 Org A items',
  pg_temp.id('b_admin'),
  format('SELECT 1 FROM public.list_wishlist_ledger_totals() WHERE item_id = %L', (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4')),
  0);
SELECT pg_temp.expect_error('P2.3', 'correction without a reason -> refused',
  pg_temp.id('a_admin'),
  format('SELECT public.record_wishlist_correction(%L, 100, %L)',
    (SELECT l.id FROM public.wishlist_ledger_entries l JOIN public.equipment_wishlist_items i ON i.id = l.item_id
     WHERE i.title = 'G7 bulk 4' AND l.amount_cents = 20000), ' '),
  'reason is required');
SELECT pg_temp.expect_error('P2.3', 'correction larger than the entry -> refused',
  pg_temp.id('a_admin'),
  format('SELECT public.record_wishlist_correction(%L, 20001, %L)',
    (SELECT l.id FROM public.wishlist_ledger_entries l JOIN public.equipment_wishlist_items i ON i.id = l.item_id
     WHERE i.title = 'G7 bulk 4' AND l.amount_cents = 20000), 'typo'),
  'exceeds');
SELECT pg_temp.check('P2.3', 'control: A nw_admin corrects the R200 entry (counted twice)',
  pg_temp.id('a_admin'), 'ok',
  format('SELECT public.record_wishlist_correction(%L, 20000, %L)',
    (SELECT l.id FROM public.wishlist_ledger_entries l JOIN public.equipment_wishlist_items i ON i.id = l.item_id
     WHERE i.title = 'G7 bulk 4' AND l.amount_cents = 20000 AND l.kind = 'contribution_received'), 'counted twice'));
SELECT pg_temp.check('P2.3', 'correction reflected: covered = R600 (500 + 100 + 200 - 200)',
  pg_temp.id('a_unv'), 'true',
  format('SELECT covered_cents = 60000 AND received_cents = 60000 FROM public.list_wishlist_ledger_totals() WHERE item_id = %L',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4')));
SELECT pg_temp.expect_error('P2.3', 'purchase receipt under another item -> invalid receipt path',
  pg_temp.id('a_admin'),
  (SELECT format('SELECT public.record_wishlist_purchase(%L, 45000, NULL, NULL, %L)', i.id,
     i.organization_id::text || '/needs/' || o.id::text || '/receipts/r.jpg')
   FROM public.equipment_wishlist_items i, public.equipment_wishlist_items o
   WHERE i.title = 'G7 bulk 4' AND o.title = 'G7 bulk 5'),
  'invalid receipt path');
SELECT pg_temp.check('P2.3', 'control: A nw_admin records R450 purchase with receipt',
  pg_temp.id('a_admin'), 'ok',
  (SELECT format('SELECT public.record_wishlist_purchase(%L, 45000, NULL, %L, %L)', i.id, 'Makro',
     i.organization_id::text || '/needs/' || i.id::text || '/receipts/r.jpg')
   FROM public.equipment_wishlist_items i WHERE i.title = 'G7 bulk 4'));
SELECT pg_temp.check('P2.3', 'balance = received - spent (600 - 450 = 150)',
  pg_temp.id('a_unv'), 'true',
  format('SELECT spent_cents = 45000 AND balance_cents = 15000 FROM public.list_wishlist_ledger_totals() WHERE item_id = %L',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 4')));
SELECT pg_temp.assert('P2.3', 'every ledger entry was written to activity_logs',
  (SELECT count(*) FROM public.activity_logs a
   WHERE a.action IN ('wishlist_ledger_contribution', 'wishlist_ledger_purchase', 'wishlist_ledger_correction')
     AND a.organization_id = pg_temp.id('org_a')) >= 5,
  'checked as postgres');

-- -----------------------------------------------------------------------------
-- P2.4 - optional pledge on a cost contribution (managers + offerer only; never counted).
-- Needs 20261031073000_wishlist_offer_pledge.sql. Uses 'G7 bulk 5'.
-- -----------------------------------------------------------------------------
SELECT pg_temp.check('P2.4', 'control: A committee pledges R500 on a cost contribution',
  pg_temp.id('a_comm'), 'ok',
  format('SELECT public.create_wishlist_offer(%L, %L, NULL, %L, false, 50000)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 5'), 'contribute_cost', 'can contribute'));
SELECT pg_temp.expect_error('P2.4', 'pledge on a non-cost offer -> refused',
  pg_temp.id('a_unv'),
  format('SELECT public.create_wishlist_offer(%L, %L, NULL, NULL, false, 50000)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 5'), 'contribute_item'),
  'only allowed on a cost contribution');
SELECT pg_temp.expect_error('P2.4', 'pledge above R1,000,000 -> refused',
  pg_temp.id('a_unv'),
  format('SELECT public.create_wishlist_offer(%L, %L, NULL, NULL, false, 100000100)',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 5'), 'contribute_cost'),
  'whole rands');
SELECT pg_temp.check('P2.4', 'offerer reads own pledge',
  pg_temp.id('a_comm'), 'true',
  'SELECT pledged_amount_cents = 50000 FROM public.equipment_wishlist_offers WHERE pledged_amount_cents IS NOT NULL');
SELECT pg_temp.expect_rows('P2.4', 'another A resident cannot see the pledge',
  pg_temp.id('a_unv'), 'SELECT 1 FROM public.equipment_wishlist_offers WHERE pledged_amount_cents IS NOT NULL', 0);
SELECT pg_temp.check('P2.4', 'A nw_admin sees the pledge in list_wishlist_offers',
  pg_temp.id('a_admin'), 'true',
  'SELECT bool_or(pledged_amount_cents = 50000 AND kind = ''contribute_cost'') FROM public.list_wishlist_offers(NULL, true)');
SELECT pg_temp.expect_rows('P2.4', 'pledge is not counted in ledger totals',
  pg_temp.id('a_unv'),
  format('SELECT 1 FROM public.list_wishlist_ledger_totals() WHERE item_id = %L',
    (SELECT id FROM public.equipment_wishlist_items WHERE title = 'G7 bulk 5')),
  0);

-- -----------------------------------------------------------------------------
-- P2.5 - managers are alerted about new offers (in-app; push via edge function).
-- Needs 20261031074000_wishlist_offer_notify.sql. Uses the P2.4 R500 pledge on 'G7 bulk 5'.
-- -----------------------------------------------------------------------------
SELECT pg_temp.check('P2.5', 'A nw_admin got the in-app pledge alert',
  pg_temp.id('a_admin'), 'true',
  'SELECT EXISTS (SELECT 1 FROM public.list_my_app_notifications(80) WHERE kind = ''wishlist'' AND title = ''New pledge: R 500 towards G7 bulk 5'')');
SELECT pg_temp.check('P2.5', 'another A resident got no pledge alert',
  pg_temp.id('a_unv'), 'true',
  'SELECT NOT EXISTS (SELECT 1 FROM public.list_my_app_notifications(80) WHERE title LIKE ''New pledge:%'')');
SELECT pg_temp.expect_error('P2.5', 'resident cannot list alert recipients',
  pg_temp.id('a_unv'),
  format('SELECT public.wishlist_offer_notify_ids(%L)', pg_temp.id('org_a')),
  'permission denied');
SELECT pg_temp.check('P2.5', 'format_rands groups thousands',
  pg_temp.id('a_unv'), 'true',
  'SELECT public.format_rands(100000) = ''R 1 000'' AND public.format_rands(50000) = ''R 500''');

-- -----------------------------------------------------------------------------
-- WS - Share to WhatsApp (patrol share refs). Needs 20261101010000_patrol_share.sql.
-- Fresh Org A patroller 'ws_pat' + resident 'ws_res' (a_pat / a_res moved to
-- Org B earlier). The active patrol is a postgres fixture row.
-- -----------------------------------------------------------------------------
DO $ws_fx$
DECLARE
  sfx text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  r record;
BEGIN
  INSERT INTO g7_ids VALUES ('ws_pat', gen_random_uuid()), ('ws_res', gen_random_uuid());
  FOR r IN SELECT * FROM (VALUES ('ws_pat', 'patroller'), ('ws_res', 'resident')) t(k, role)
  LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    VALUES (pg_temp.id(r.k), '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'g7-' || r.k || '-' || sfx || '@example.invalid', now(), now());
    EXECUTE format(
      'INSERT INTO public.users (id, email, full_name, role, organization_id, verified, status)
       VALUES (%L, %L, %L, %L, %L, true, %L)
       ON CONFLICT (id) DO UPDATE
         SET role = EXCLUDED.role, organization_id = EXCLUDED.organization_id,
             full_name = EXCLUDED.full_name, verified = true, status = EXCLUDED.status',
      pg_temp.id(r.k), 'g7-' || r.k || '-' || sfx || '@example.invalid',
      'G7 ' || r.k, r.role, pg_temp.id('org_a'), 'active');
    INSERT INTO public.organization_members (organization_id, user_id, member_role, status)
    VALUES (pg_temp.id('org_a'), pg_temp.id(r.k), r.role, 'active')
    ON CONFLICT (organization_id, user_id) DO NOTHING;
  END LOOP;
END
$ws_fx$;

INSERT INTO public.active_patrols (user_id, user_name, vehicle_type, vehicle_make_model, vehicle_reg,
                                   vehicle_color, start_time, zone, organization_id, share_ref, start_shared_at)
VALUES (pg_temp.id('ws_pat'), 'G7 ws_pat', 'car', 'G7 Test Bakkie', 'G7 123 EC', 'gray',
        now() - interval '90 minutes', 'G7 Zone', pg_temp.id('org_a'), 'PT-AAAA', now());
CREATE TEMP TABLE g7_ws (k text PRIMARY KEY, v text) ON COMMIT DROP;
INSERT INTO g7_ws SELECT 'ref', share_ref FROM public.active_patrols WHERE user_id::text = pg_temp.id('ws_pat')::text;

SELECT pg_temp.assert('WS', 'sign-on gets a server ref PT-xxxx (client ref + shared time ignored)',
  (SELECT ap.share_ref ~ '^PT-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$' AND ap.share_tracked AND ap.start_shared_at IS NULL
   FROM public.active_patrols ap WHERE ap.user_id::text = pg_temp.id('ws_pat')::text),
  'checked as postgres');
SELECT pg_temp.assert('WS', '300 generated refs use only the 31-char alphabet',
  (SELECT bool_and(r ~ '^PT-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$') FROM (SELECT public.random_patrol_share_ref() AS r FROM generate_series(1, 300)) g),
  'checked as postgres');
SELECT pg_temp.assert('WS', 'share_ref unique per org (both tables indexed)',
  (SELECT count(*) = 2 FROM pg_indexes WHERE schemaname = 'public'
     AND indexname IN ('active_patrols_org_share_ref_uniq', 'patrol_logs_org_share_ref_uniq')),
  'checked as postgres');
SELECT pg_temp.expect_error('WS', 'resident cannot call the ref generator',
  pg_temp.id('ws_res'), 'SELECT public.next_patrol_share_ref(NULL)', 'permission denied');
SELECT pg_temp.expect_error('WS', 'bad kind -> invalid kind',
  pg_temp.id('ws_pat'), format('SELECT public.mark_patrol_shared(%L, %L)', (SELECT v FROM g7_ws WHERE k = 'ref'), 'middle'), 'invalid kind');
SELECT pg_temp.expect_error('WS', 'B nw_admin marks A sign-on -> not found',
  pg_temp.id('b_admin'), format('SELECT public.mark_patrol_shared(%L, %L)', (SELECT v FROM g7_ws WHERE k = 'ref'), 'start'), 'patrol not found');
SELECT pg_temp.expect_error('WS', 'A resident (not owner, not staff) marks sign-on -> forbidden',
  pg_temp.id('ws_res'), format('SELECT public.mark_patrol_shared(%L, %L)', (SELECT v FROM g7_ws WHERE k = 'ref'), 'start'), 'forbidden');
SELECT pg_temp.expect_error('WS', 'sign-off mark before the patrol ends -> not found',
  pg_temp.id('ws_pat'), format('SELECT public.mark_patrol_shared(%L, %L)', (SELECT v FROM g7_ws WHERE k = 'ref'), 'end'), 'patrol not found');
SELECT pg_temp.check('WS', 'control: owner marks sign-on shared',
  pg_temp.id('ws_pat'), 'true', format('SELECT public.mark_patrol_shared(%L, %L) IS NOT NULL', (SELECT v FROM g7_ws WHERE k = 'ref'), 'start'));
-- Pin the first share time in the past, then prove a second mark keeps it.
SELECT set_config('app.patrol_share_write', 'on', true);
UPDATE public.active_patrols SET start_shared_at = '2026-01-01 08:00:00+02'
WHERE user_id::text = pg_temp.id('ws_pat')::text;
SELECT set_config('app.patrol_share_write', 'off', true);
SELECT pg_temp.check('WS', 'mark is idempotent (A nw_admin re-mark keeps the first time)',
  pg_temp.id('a_admin'), 'true',
  format('SELECT public.mark_patrol_shared(%L, %L) = %L::timestamptz', (SELECT v FROM g7_ws WHERE k = 'ref'), 'start', '2026-01-01 08:00:00+02'));
SELECT pg_temp.check('WS', 'client UPDATE cannot clear start_shared_at (guard trigger)',
  pg_temp.id('ws_pat'), 'ok',
  format('UPDATE public.active_patrols SET start_shared_at = NULL, share_ref = %L WHERE user_id::text = %L', 'PT-ZZZZ', pg_temp.id('ws_pat')));
SELECT pg_temp.assert('WS', 'share fields unchanged after client UPDATE',
  (SELECT ap.start_shared_at = '2026-01-01 08:00:00+02'::timestamptz AND ap.share_ref = (SELECT v FROM g7_ws WHERE k = 'ref')
   FROM public.active_patrols ap WHERE ap.user_id::text = pg_temp.id('ws_pat')::text),
  'checked as postgres');
SELECT pg_temp.check('WS', 'control room: A nw_admin reads the sign-on share',
  pg_temp.id('a_admin'), 'true',
  format('SELECT source = %L AND start_shared_at IS NOT NULL FROM public.get_patrol_share(%L)', 'active', (SELECT v FROM g7_ws WHERE k = 'ref')));
SELECT pg_temp.expect_rows('WS', 'B nw_admin cannot read A share',
  pg_temp.id('b_admin'), format('SELECT 1 FROM public.get_patrol_share(%L)', (SELECT v FROM g7_ws WHERE k = 'ref')), 0);
SELECT pg_temp.expect_rows('WS', 'A resident cannot read another patroller share',
  pg_temp.id('ws_res'), format('SELECT 1 FROM public.get_patrol_share(%L)', (SELECT v FROM g7_ws WHERE k = 'ref')), 0);
SELECT pg_temp.check('WS', 'control: owner ends the patrol (end_patrol unchanged)',
  pg_temp.id('ws_pat'), 'ok', format('SELECT public.end_patrol(%L::uuid, false)', pg_temp.id('ws_pat')));
SELECT pg_temp.assert('WS', 'log carries ref, sign-on share time and vehicle type',
  (SELECT count(*) = 1 AND bool_and(pl.share_tracked AND pl.start_shared_at IS NOT NULL AND pl.end_shared_at IS NULL
                                     AND pl.vehicle_type = 'car' AND pl.vehicle_reg = 'G7 123 EC')
   FROM public.patrol_logs pl WHERE pl.share_ref = (SELECT v FROM g7_ws WHERE k = 'ref') AND pl.organization_id = pg_temp.id('org_a')),
  'checked as postgres');
SELECT pg_temp.check('WS', 'owner sees the unshared sign-off as pending',
  pg_temp.id('ws_pat'), 'true',
  format('SELECT EXISTS (SELECT 1 FROM public.list_my_pending_patrol_shares() WHERE source = %L AND share_ref = %L)', 'log', (SELECT v FROM g7_ws WHERE k = 'ref')));
SELECT pg_temp.check('WS', 'control: owner marks sign-off shared',
  pg_temp.id('ws_pat'), 'true', format('SELECT public.mark_patrol_shared(%L, %L) IS NOT NULL', (SELECT v FROM g7_ws WHERE k = 'ref'), 'end'));
SELECT pg_temp.check('WS', 'sign-off no longer pending',
  pg_temp.id('ws_pat'), 'true',
  format('SELECT NOT EXISTS (SELECT 1 FROM public.list_my_pending_patrol_shares() WHERE share_ref = %L)', (SELECT v FROM g7_ws WHERE k = 'ref')));
SELECT pg_temp.check('WS', 'second end_patrol is still a no-op (idempotent)',
  pg_temp.id('ws_pat'), 'ok', format('SELECT public.end_patrol(%L::uuid, false)', pg_temp.id('ws_pat')));
SELECT pg_temp.assert('WS', 'still exactly one log for the ref after the second end',
  (SELECT count(*) = 1 FROM public.patrol_logs WHERE share_ref = (SELECT v FROM g7_ws WHERE k = 'ref')
     AND organization_id = pg_temp.id('org_a')),
  'checked as postgres');

-- TODO by later phase (rows from NEW_FEATURES_BLUEPRINT section 14)
--   P0 capabilities: rows 10, 11
--   P1 broadcasts by street reps (realtime/push fan-out): row 2
--   P3 equipment: rows 16-23
--   P4 local services + community-media storage: rows 6, 7, 8, 9
--   Row 12 (City Hub/Hotspots stay city-wide): add when P0 touches them
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- Report (psql shows this table; the SQL editor shows the ERROR below)
-- -----------------------------------------------------------------------------
SELECT n, matrix_row, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, test, detail
FROM g7_results ORDER BY n;

DO $rep$
DECLARE
  total int; failed int; msg text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT ok) INTO total, failed FROM g7_results;
  IF failed = 0 THEN
    msg := format('G7 ISOLATION: ALL %s CHECKS PASSED (rolled back, nothing saved)', total);
  ELSE
    SELECT format('G7 ISOLATION: %s of %s CHECKS FAILED (rolled back, nothing saved): %s',
                  failed, total,
                  string_agg(format('#%s [%s] %s -> %s', n, matrix_row, test, detail), ' | ' ORDER BY n))
    INTO msg FROM g7_results WHERE NOT ok;
  END IF;
  -- Intentional: aborting guarantees nothing above can be committed.
  RAISE EXCEPTION '%', msg;
END
$rep$;

ROLLBACK;
