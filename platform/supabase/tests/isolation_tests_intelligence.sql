-- G7 / Prompt 2 - Intelligence + section-update + feedback isolation
-- Sibling of platform/supabase/tests/isolation_tests_community.sql (same harness style).
-- NOT a migration. Run AFTER applying
-- 20261104100000_rls_tenant_isolation_intelligence.sql on a non-prod DB.
--
--   BEGIN ... ROLLBACK. Ends with RAISE EXCEPTION so nothing can commit.
--   Expected final message:
--     "P2 INTEL ISOLATION: ALL n CHECKS PASSED (rolled back, nothing saved)"

BEGIN;

CREATE TEMP TABLE g7_results (
  n serial PRIMARY KEY,
  matrix_row text,
  test text,
  ok boolean,
  detail text
);

CREATE TEMP TABLE g7_ids (
  k text PRIMARY KEY,
  id uuid NOT NULL
);

CREATE OR REPLACE FUNCTION pg_temp.id(p_k text)
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM g7_ids WHERE k = p_k
$$;

-- Match isolation_tests_community.sql: JWT claims + SET LOCAL ROLE so RLS applies.
CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid, p_role text DEFAULT 'authenticated')
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p::text, 'role', p_role)::text,
    true
  );
  PERFORM set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.as_postgres()
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.check(
  p_row text, p_test text, p_user uuid, p_mode text, p_sql text,
  p_expect text DEFAULT NULL, p_role text DEFAULT 'authenticated'
)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_n bigint := 0;
  v_ok boolean := false;
  v_detail text := '';
BEGIN
  BEGIN
    PERFORM pg_temp.as_user(p_user, p_role);
    IF p_mode = 'rows' THEN
      EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO v_n;
      v_ok := v_n = p_expect::bigint;
      v_detail := format('got %s rows, expected %s', v_n, p_expect);
    ELSIF p_mode = 'ok' THEN
      EXECUTE p_sql;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_ok := true;
      v_detail := format('ok (%s rows)', v_n);
    ELSIF p_mode IN ('error', 'blocked') THEN
      EXECUTE p_sql;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF p_mode = 'blocked' AND v_n = 0 THEN
        v_ok := true;
        v_detail := 'blocked (0 rows)';
      ELSE
        v_ok := false;
        v_detail := format('expected error ~ "%s" but it succeeded (%s rows)', p_expect, v_n);
      END IF;
    ELSE
      v_ok := false;
      v_detail := format('unknown mode %s', p_mode);
    END IF;
    RESET ROLE;
  EXCEPTION WHEN others THEN
    IF p_mode IN ('error', 'blocked') THEN
      v_ok := SQLERRM ~* p_expect;
      v_detail := CASE WHEN v_ok THEN 'raised: ' ELSE 'wrong error: ' END || SQLERRM;
    ELSE
      v_ok := false;
      v_detail := 'unexpected error: ' || SQLERRM;
    END IF;
  END;
  INSERT INTO g7_results(matrix_row, test, ok, detail)
  VALUES (p_row, p_test, v_ok, v_detail);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_row text, p_test text, p_user uuid, p_sql text, p_like text)
RETURNS void LANGUAGE sql AS $$ SELECT pg_temp.check(p_row, p_test, p_user, 'error', p_sql, p_like) $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_rows(p_row text, p_test text, p_user uuid, p_sql text, p_n int)
RETURNS void LANGUAGE sql AS $$ SELECT pg_temp.check(p_row, p_test, p_user, 'rows', p_sql, p_n::text) $$;
CREATE OR REPLACE FUNCTION pg_temp.assert(p_row text, p_test text, p_cond boolean, p_detail text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO g7_results (matrix_row, test, ok, detail)
  VALUES (p_row, p_test, coalesce(p_cond, false), p_detail);
END;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (postgres role; rolled back at end)
-- ---------------------------------------------------------------------------
DO $fx$
DECLARE
  sfx text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  r record;
BEGIN
  INSERT INTO g7_ids VALUES
    ('org_a', gen_random_uuid()), ('org_b', gen_random_uuid()),
    ('a_res', gen_random_uuid()), ('a_admin', gen_random_uuid()),
    ('a_pat', gen_random_uuid()), ('b_pat', gen_random_uuid()),
    ('b_res', gen_random_uuid()), ('b_admin', gen_random_uuid()),
    ('cp_a1', gen_random_uuid()), ('cp_a2', gen_random_uuid()),
    ('cp_b1', gen_random_uuid()), ('cp_b2', gen_random_uuid()),
    ('assoc_a', gen_random_uuid()), ('assoc_b', gen_random_uuid()),
    ('geo_a', gen_random_uuid()), ('geo_b', gen_random_uuid()),
    ('intel_a', gen_random_uuid()), ('intel_b', gen_random_uuid()),
    ('mo_a', gen_random_uuid()), ('mo_b', gen_random_uuid()),
    ('mq_a', gen_random_uuid()), ('mq_b', gen_random_uuid()),
    ('inc_a', gen_random_uuid()), ('inc_b', gen_random_uuid()),
    ('su_a', gen_random_uuid()), ('su_b', gen_random_uuid()),
    ('fb_a', gen_random_uuid()), ('fb_b', gen_random_uuid());

  INSERT INTO public.organizations (id, name, type, status)
  VALUES (pg_temp.id('org_a'), 'p2-intel-A-' || sfx, 'nw_group', 'active'),
         (pg_temp.id('org_b'), 'p2-intel-B-' || sfx, 'nw_group', 'active');

  FOR r IN SELECT * FROM (VALUES
      ('a_res',   'org_a', 'resident'),
      ('a_admin', 'org_a', 'nw_admin'),
      ('a_pat',   'org_a', 'patroller'),
      ('b_pat',   'org_b', 'patroller'),
      ('b_res',   'org_b', 'resident'),
      ('b_admin', 'org_b', 'nw_admin')) t(k, org, role)
  LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    VALUES (pg_temp.id(r.k), '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'p2-' || r.k || '-' || sfx || '@example.invalid', now(), now());

    EXECUTE format(
      'INSERT INTO public.users (id, email, full_name, role, organization_id, verified, status)
       VALUES (%L, %L, %L, %L, %L, true, %L)
       ON CONFLICT (id) DO UPDATE
         SET role = EXCLUDED.role, organization_id = EXCLUDED.organization_id,
             full_name = EXCLUDED.full_name, verified = true, status = %L',
      pg_temp.id(r.k), 'p2-' || r.k || '-' || sfx || '@example.invalid',
      'P2 ' || r.k, r.role, pg_temp.id(r.org), 'active', 'active');

    INSERT INTO public.organization_members (organization_id, user_id, member_role, status)
    VALUES (pg_temp.id(r.org), pg_temp.id(r.k), r.role, 'active')
    ON CONFLICT (organization_id, user_id) DO NOTHING;
  END LOOP;

  INSERT INTO public.criminal_profiles (id, primary_name, organization_id, created_by)
  VALUES
    (pg_temp.id('cp_a1'), 'P2 A Subject', pg_temp.id('org_a'), pg_temp.id('a_admin')::text),
    (pg_temp.id('cp_a2'), 'P2 A Associate', pg_temp.id('org_a'), pg_temp.id('a_admin')::text),
    (pg_temp.id('cp_b1'), 'P2 B Subject', pg_temp.id('org_b'), pg_temp.id('b_admin')::text),
    (pg_temp.id('cp_b2'), 'P2 B Associate', pg_temp.id('org_b'), pg_temp.id('b_admin')::text);

  INSERT INTO public.profile_associates (id, profile_id, associate_profile_id, relationship_type, relationship_strength)
  VALUES
    (pg_temp.id('assoc_a'), pg_temp.id('cp_a1'), pg_temp.id('cp_a2'), 'associate', 'suspected'),
    (pg_temp.id('assoc_b'), pg_temp.id('cp_b1'), pg_temp.id('cp_b2'), 'associate', 'suspected');

  INSERT INTO public.profile_geography (id, profile_id, location_name, location_type)
  VALUES
    (pg_temp.id('geo_a'), pg_temp.id('cp_a1'), 'P2 A spot', 'sighting'),
    (pg_temp.id('geo_b'), pg_temp.id('cp_b1'), 'P2 B spot', 'sighting');

  INSERT INTO public.profile_intelligence (id, profile_id, source_type, intelligence_type, content)
  VALUES
    (pg_temp.id('intel_a'), pg_temp.id('cp_a1'), 'humint', 'observation', 'P2 A note'),
    (pg_temp.id('intel_b'), pg_temp.id('cp_b1'), 'humint', 'observation', 'P2 B note');

  INSERT INTO public.mo_pattern_history (id, profile_id, pattern_type, pattern_value)
  VALUES
    (pg_temp.id('mo_a'), pg_temp.id('cp_a1'), 'entry_method', 'window'),
    (pg_temp.id('mo_b'), pg_temp.id('cp_b1'), 'entry_method', 'door');

  INSERT INTO public.profile_match_queue (id, source_type, suggested_profile_id, organization_id, status, match_confidence)
  VALUES
    (pg_temp.id('mq_a'), 'manual_review', pg_temp.id('cp_a1'), pg_temp.id('org_a'), 'pending', 0.80),
    (pg_temp.id('mq_b'), 'manual_review', pg_temp.id('cp_b1'), pg_temp.id('org_b'), 'pending', 0.80);

  INSERT INTO public.incidents (
    id, organization_id, type, description, location, status,
    reporter_id, submitted_by, submitted_by_name, submitted_at
  ) VALUES
    (pg_temp.id('inc_a'), pg_temp.id('org_a'), 'theft', 'P2 A incident', 'Street A', 'pending',
     pg_temp.id('a_res'), pg_temp.id('a_res'), 'P2 a_res', now()),
    (pg_temp.id('inc_b'), pg_temp.id('org_b'), 'theft', 'P2 B incident', 'Street B', 'pending',
     pg_temp.id('b_res'), pg_temp.id('b_res'), 'P2 b_res', now());

  INSERT INTO public.incident_section_updates (
    id, incident_id, section_key, body, created_by, author_name, author_role
  ) VALUES
    (pg_temp.id('su_a'), pg_temp.id('inc_a'), 'description', 'P2 A section note',
     pg_temp.id('a_pat'), 'P2 a_pat', 'patroller'),
    (pg_temp.id('su_b'), pg_temp.id('inc_b'), 'description', 'P2 B section note',
     pg_temp.id('b_admin'), 'P2 b_admin', 'nw_admin');

  INSERT INTO public.feedback (id, name, email, message, submitter_user_id, organization_id)
  VALUES
    (pg_temp.id('fb_a'), 'P2 A', 'a@example.invalid', 'org A feedback',
     pg_temp.id('a_res'), pg_temp.id('org_a')),
    (pg_temp.id('fb_b'), 'P2 B', 'b@example.invalid', 'org B feedback',
     pg_temp.id('b_res'), pg_temp.id('org_b'));
END
$fx$;

-- ---------------------------------------------------------------------------
-- profile_associates
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect_rows('P2-assoc', 'B admin cannot SELECT A associate edge',
  pg_temp.id('b_admin'), format('SELECT 1 FROM public.profile_associates WHERE id = %L', pg_temp.id('assoc_a')), 0);
SELECT pg_temp.expect_rows('P2-assoc', 'control: A admin SELECT A associate edge',
  pg_temp.id('a_admin'), format('SELECT 1 FROM public.profile_associates WHERE id = %L', pg_temp.id('assoc_a')), 1);
SELECT pg_temp.check('P2-assoc', 'B admin UPDATE A associate -> blocked',
  pg_temp.id('b_admin'), 'blocked',
  format('UPDATE public.profile_associates SET relationship_type = %L WHERE id = %L', 'friend', pg_temp.id('assoc_a')),
  '0');
SELECT pg_temp.check('P2-assoc', 'B admin DELETE A associate -> blocked',
  pg_temp.id('b_admin'), 'blocked',
  format('DELETE FROM public.profile_associates WHERE id = %L', pg_temp.id('assoc_a')),
  '0');
SELECT pg_temp.expect_error('P2-assoc', 'B admin INSERT associate under A profile -> denied',
  pg_temp.id('b_admin'),
  format('INSERT INTO public.profile_associates (profile_id, associate_profile_id, relationship_type) VALUES (%L, %L, %L)',
    pg_temp.id('cp_a1'), pg_temp.id('cp_a2'), 'friend'),
  'policy|violates|permission denied|new row');
SELECT pg_temp.check('P2-assoc', 'control: A patroller can INSERT associate in A',
  pg_temp.id('a_pat'), 'ok',
  format('INSERT INTO public.profile_associates (profile_id, associate_profile_id, relationship_type, relationship_strength) VALUES (%L, %L, %L, %L)',
    pg_temp.id('cp_a2'), pg_temp.id('cp_a1'), 'friend', 'suspected'));

-- ---------------------------------------------------------------------------
-- profile_geography
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect_rows('P2-geo', 'B admin cannot SELECT A geography',
  pg_temp.id('b_admin'), format('SELECT 1 FROM public.profile_geography WHERE id = %L', pg_temp.id('geo_a')), 0);
SELECT pg_temp.expect_rows('P2-geo', 'control: A admin SELECT A geography',
  pg_temp.id('a_admin'), format('SELECT 1 FROM public.profile_geography WHERE id = %L', pg_temp.id('geo_a')), 1);
SELECT pg_temp.expect_error('P2-geo', 'B admin INSERT geography on A profile -> denied',
  pg_temp.id('b_admin'),
  format('INSERT INTO public.profile_geography (profile_id, location_name, location_type) VALUES (%L, %L, %L)',
    pg_temp.id('cp_a1'), 'leak', 'sighting'),
  'policy|violates|permission denied|new row');
SELECT pg_temp.check('P2-geo', 'control: A patroller INSERT geography on A profile',
  pg_temp.id('a_pat'), 'ok',
  format('INSERT INTO public.profile_geography (profile_id, location_name, location_type) VALUES (%L, %L, %L)',
    pg_temp.id('cp_a1'), 'A patrol sighting', 'sighting'));

-- ---------------------------------------------------------------------------
-- profile_intelligence
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect_rows('P2-intel', 'B admin cannot SELECT A intelligence note',
  pg_temp.id('b_admin'), format('SELECT 1 FROM public.profile_intelligence WHERE id = %L', pg_temp.id('intel_a')), 0);
SELECT pg_temp.expect_rows('P2-intel', 'control: A admin SELECT A intelligence note',
  pg_temp.id('a_admin'), format('SELECT 1 FROM public.profile_intelligence WHERE id = %L', pg_temp.id('intel_a')), 1);
SELECT pg_temp.expect_error('P2-intel', 'B admin INSERT intel on A profile -> denied',
  pg_temp.id('b_admin'),
  format('INSERT INTO public.profile_intelligence (profile_id, source_type, intelligence_type, content) VALUES (%L, %L, %L, %L)',
    pg_temp.id('cp_a1'), 'humint', 'observation', 'leak'),
  'policy|violates|permission denied|new row');

-- ---------------------------------------------------------------------------
-- mo_pattern_history
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect_rows('P2-mo', 'B admin cannot SELECT A MO row',
  pg_temp.id('b_admin'), format('SELECT 1 FROM public.mo_pattern_history WHERE id = %L', pg_temp.id('mo_a')), 0);
SELECT pg_temp.expect_rows('P2-mo', 'control: A admin SELECT A MO row',
  pg_temp.id('a_admin'), format('SELECT 1 FROM public.mo_pattern_history WHERE id = %L', pg_temp.id('mo_a')), 1);
SELECT pg_temp.expect_error('P2-mo', 'B admin INSERT MO on A profile -> denied',
  pg_temp.id('b_admin'),
  format('INSERT INTO public.mo_pattern_history (profile_id, pattern_type, pattern_value) VALUES (%L, %L, %L)',
    pg_temp.id('cp_a1'), 'weapon_used', 'knife'),
  'policy|violates|permission denied|new row');

-- ---------------------------------------------------------------------------
-- profile_match_queue (already org-scoped; regression)
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect_rows('P2-mq', 'B admin cannot SELECT A match queue row',
  pg_temp.id('b_admin'), format('SELECT 1 FROM public.profile_match_queue WHERE id = %L', pg_temp.id('mq_a')), 0);
SELECT pg_temp.expect_rows('P2-mq', 'control: A admin SELECT A match queue row',
  pg_temp.id('a_admin'), format('SELECT 1 FROM public.profile_match_queue WHERE id = %L', pg_temp.id('mq_a')), 1);
SELECT pg_temp.check('P2-mq', 'B admin UPDATE A match queue -> blocked',
  pg_temp.id('b_admin'), 'blocked',
  format('UPDATE public.profile_match_queue SET status = %L WHERE id = %L', 'rejected', pg_temp.id('mq_a')),
  '0');

-- ---------------------------------------------------------------------------
-- incident_section_updates
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect_rows('P2-su', 'B admin cannot SELECT A section update',
  pg_temp.id('b_admin'), format('SELECT 1 FROM public.incident_section_updates WHERE id = %L', pg_temp.id('su_a')), 0);
SELECT pg_temp.expect_rows('P2-su', 'control: A admin SELECT A section update',
  pg_temp.id('a_admin'), format('SELECT 1 FROM public.incident_section_updates WHERE id = %L', pg_temp.id('su_a')), 1);
SELECT pg_temp.expect_rows('P2-su', 'A resident (reporter) can SELECT own incident section update',
  pg_temp.id('a_res'), format('SELECT 1 FROM public.incident_section_updates WHERE id = %L', pg_temp.id('su_a')), 1);
SELECT pg_temp.expect_error('P2-su', 'B patroller INSERT on A incident -> denied (org)',
  pg_temp.id('b_pat'),
  format('INSERT INTO public.incident_section_updates (incident_id, section_key, body, created_by) VALUES (%L, %L, %L, %L)',
    pg_temp.id('inc_a'), 'description', 'cross-tenant', pg_temp.id('b_pat')),
  'policy|violates|permission denied|new row');
SELECT pg_temp.expect_error('P2-su', 'A resident INSERT section update -> denied (role)',
  pg_temp.id('a_res'),
  format('INSERT INTO public.incident_section_updates (incident_id, section_key, body, created_by) VALUES (%L, %L, %L, %L)',
    pg_temp.id('inc_a'), 'description', 'resident note', pg_temp.id('a_res')),
  'policy|violates|permission denied|new row');
SELECT pg_temp.check('P2-su', 'control: A patroller INSERT section update on A incident',
  pg_temp.id('a_pat'), 'ok',
  format('INSERT INTO public.incident_section_updates (incident_id, section_key, body, created_by) VALUES (%L, %L, %L, %L)',
    pg_temp.id('inc_a'), 'location', 'Patroller follow-up', pg_temp.id('a_pat')));

-- ---------------------------------------------------------------------------
-- feedback INSERT
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect_error('P2-fb', 'A resident INSERT feedback for Org B -> denied',
  pg_temp.id('a_res'),
  format('INSERT INTO public.feedback (name, email, message, submitter_user_id, organization_id) VALUES (%L, %L, %L, %L, %L)',
    'leak', 'a@example.invalid', 'cross', pg_temp.id('a_res'), pg_temp.id('org_b')),
  'policy|violates|permission denied|new row');
-- Stamp trigger removed on feedback: NULL org must be denied (not auto-filled).
SELECT pg_temp.expect_error('P2-fb', 'A resident INSERT feedback with NULL org -> denied',
  pg_temp.id('a_res'),
  format('INSERT INTO public.feedback (name, email, message, submitter_user_id, organization_id) VALUES (%L, %L, %L, %L, NULL)',
    'nullorg', 'a@example.invalid', 'null org', pg_temp.id('a_res')),
  'policy|violates|permission denied|new row|check constraint|organization_id|not-null');
SELECT pg_temp.expect_error('P2-fb', 'A resident INSERT feedback as someone else -> denied',
  pg_temp.id('a_res'),
  format('INSERT INTO public.feedback (name, email, message, submitter_user_id, organization_id) VALUES (%L, %L, %L, %L, %L)',
    'spoof', 'a@example.invalid', 'spoof', pg_temp.id('b_res'), pg_temp.id('org_a')),
  'policy|violates|permission denied|new row');
SELECT pg_temp.check('P2-fb', 'control: A resident INSERT feedback for own org as self',
  pg_temp.id('a_res'), 'ok',
  format('INSERT INTO public.feedback (name, email, message, submitter_user_id, organization_id) VALUES (%L, %L, %L, %L, %L)',
    'ok', 'a@example.invalid', 'own org', pg_temp.id('a_res'), pg_temp.id('org_a')));

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
SELECT n, matrix_row, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, test, detail
FROM g7_results ORDER BY n;

DO $rep$
DECLARE
  total int; failed int; msg text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT ok) INTO total, failed FROM g7_results;
  IF failed = 0 THEN
    msg := format('P2 INTEL ISOLATION: ALL %s CHECKS PASSED (rolled back, nothing saved)', total);
  ELSE
    SELECT format('P2 INTEL ISOLATION: %s of %s CHECKS FAILED (rolled back, nothing saved): %s',
                  failed, total,
                  string_agg(format('#%s [%s] %s -> %s', n, matrix_row, test, detail), ' | ' ORDER BY n))
    INTO msg FROM g7_results WHERE NOT ok;
  END IF;
  RAISE EXCEPTION '%', msg;
END
$rep$;

ROLLBACK;
