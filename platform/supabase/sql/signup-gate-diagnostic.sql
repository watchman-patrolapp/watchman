-- Signup admin gate: READ-ONLY diagnostic.
-- Lists function names/arguments and column presence only. It reads no table
-- rows and prints no user data or secrets. Safe to run any time; changes nothing.
WITH wanted_fn(fn) AS (
  VALUES ('apply_signup_profile_for_user'), ('apply_signup_profile_for_user_core'),
         ('apply_my_signup_profile'), ('trg_apply_signup_profile'), ('apply_security_company_signup'),
         ('normalize_emergency_contact_relationship'), ('is_global_app_staff'), ('is_platform_staff'),
         ('working_organization_id'), ('default_city_id'), ('current_org_ids'), ('is_org_nw_admin'),
         ('city_admin_communities'), ('can_view_criminal_intelligence'), ('can_view_city_hub_suspect_alert'),
         ('org_access_blocked'), ('approve_organization'), ('reject_organization'),
         ('list_organization_requests'), ('my_organization_requests')
),
fns AS (
  SELECT
    'function'::text AS section,
    p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS item,
    concat_ws(' · ',
      CASE WHEN p.prosecdef THEN 'security definer' ELSE 'invoker' END,
      'returns ' || pg_get_function_result(p.oid),
      CASE WHEN p.proname = 'apply_signup_profile_for_user'
        THEN CASE WHEN position('apply_signup_profile_for_user_core' IN pg_get_functiondef(p.oid)) > 0
                  THEN 'is the thin wrapper (calls the core)' ELSE 'holds the sign-up logic itself' END END,
      CASE WHEN p.proname = 'apply_signup_profile_for_user_core' OR (p.proname = 'apply_signup_profile_for_user'
                AND position('apply_signup_profile_for_user_core' IN pg_get_functiondef(p.oid)) = 0)
        THEN CASE WHEN position('apply_security_company_signup' IN pg_get_functiondef(p.oid)) > 0
                  THEN 'logic version 20260815060000 or later' ELSE 'logic older than 20260815060000' END END
    ) AS detail
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (p.proname LIKE '%signup%' OR p.proname IN (SELECT fn FROM wanted_fn))
),
missing_fns AS (
  SELECT 'function'::text, w.fn || ' (any arguments)', 'MISSING'
  FROM wanted_fn w
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = w.fn
  )
),
callers AS (
  SELECT 'caller of apply_signup_profile_for_user'::text,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'calls it by name'
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname NOT IN ('apply_signup_profile_for_user', 'apply_signup_profile_for_user_core')
    AND p.prokind = 'f'
    AND position('apply_signup_profile_for_user(' IN pg_get_functiondef(p.oid)) > 0
),
triggers AS (
  SELECT 'trigger'::text, t.tgname || ' on ' || c.relname, 'runs ' || pr.proname || '()'
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc pr ON pr.oid = t.tgfoid
  WHERE NOT t.tgisinternal
    AND n.nspname IN ('public', 'auth')
    AND (pr.proname LIKE '%signup%' OR c.relname = 'organizations')
),
wanted_col(s, tbl, col) AS (
  VALUES ('auth', 'users', 'raw_user_meta_data'),
         ('public', 'users', 'role'), ('public', 'users', 'platform_role'), ('public', 'users', 'organization_id'),
         ('public', 'users', 'active_organization_id'), ('public', 'users', 'full_name'), ('public', 'users', 'email'),
         ('public', 'users', 'phone'), ('public', 'users', 'signup_track'), ('public', 'users', 'emergency_contact_relationship'),
         ('public', 'organizations', 'status'), ('public', 'organizations', 'settings_json'), ('public', 'organizations', 'city_id'),
         ('public', 'organizations', 'created_at'), ('public', 'organization_members', 'member_role'),
         ('public', 'organization_members', 'status'), ('public', 'organization_members', 'joined_at'),
         ('public', 'cities', 'name')
),
cols AS (
  SELECT 'column'::text, w.s || '.' || w.tbl || '.' || w.col,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns c
           WHERE c.table_schema = w.s AND c.table_name = w.tbl AND c.column_name = w.col
         ) THEN 'present' ELSE 'MISSING' END
  FROM wanted_col w
),
migrations AS (
  SELECT 'migration recorded'::text, v.version,
         CASE
           WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 'no migration history table'
           WHEN (xpath('/row/n/text()', query_to_xml(format(
                  'select count(*) as n from supabase_migrations.schema_migrations where version = %L', v.version),
                  false, true, '')))[1]::text::int > 0 THEN 'yes'
           ELSE 'no'
         END
  FROM (VALUES ('20260815031000'), ('20260815039000'), ('20260815060000'), ('20260815061000'),
               ('20260818063000'), ('20260818064000'), ('20261003002000'), ('20261123010000')) AS v(version)
)
SELECT * FROM fns
UNION ALL SELECT * FROM missing_fns
UNION ALL SELECT * FROM callers
UNION ALL SELECT * FROM triggers
UNION ALL SELECT * FROM cols
UNION ALL SELECT * FROM migrations
ORDER BY 1, 2;
