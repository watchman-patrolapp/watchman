-- Local seed for `supabase db reset` only.
-- config.toml [db.seed] sql_paths points here. `supabase db push` does not run this file.
--
-- Sample Gqeberha security companies are NOT copied here. They already live in
-- 20260815059000_sample_gqeberha_security_companies.sql, which is treated as
-- applied (see platform/docs/MIGRATION_VERSION_REPAIR.md). That migration also
-- UPDATEs matching organization rows. Repeating it from seed.sql would run
-- those updates again on every local reset after the migration had already
-- inserted the rows.
--
-- Guard: if this file is pasted into the hosted SQL editor by mistake, do nothing.
-- Local CLI Postgres does not set `supabase.project_ref`. Hosted sessions that
-- do set it return before any insert. There is no insert in this file either way.

DO $$
BEGIN
  IF coalesce(current_setting('supabase.project_ref', true), '') <> '' THEN
    RAISE NOTICE 'seed.sql skipped: hosted project %', current_setting('supabase.project_ref', true);
    RETURN;
  END IF;

  RAISE NOTICE 'seed.sql: local reset, no extra rows. Sample companies stay in migration 20260815059000.';
END $$;
