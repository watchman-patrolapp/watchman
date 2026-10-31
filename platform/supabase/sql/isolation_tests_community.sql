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
             verified = true, status = %L',
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
      WHEN pg_temp.id('a_admin') THEN u.full_name = 'G7 a_admin'
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
             verified = EXCLUDED.verified, status = EXCLUDED.status',
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

-- TODO by later phase (rows from NEW_FEATURES_BLUEPRINT section 14)
--   P0 capabilities: rows 10, 11
--   P1 broadcasts by street reps (realtime/push fan-out): row 2
--   P2 needs board / wishlist: rows 4, 5, 14, 15
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
