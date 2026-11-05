# Migration version repair

Checked from `platform/supabase` on 2026-11-05 against commit `5537497`.

## What was checked

`supabase` is not on `PATH`. There is no `platform/supabase/.temp` link, no project ref file, and no `SUPABASE_ACCESS_TOKEN` or database URL in the environment. Docker is not installed, so `supabase db reset` was not run. `pg_policies` was not queried.

**Every migration file that already existed is treated as applied.** None of those files were renamed or edited. The only new migration is `20261105120000_storage_policies_consolidated.sql`.

## Duplicate version prefixes

Supabase stores `schema_migrations.version`, not the filename. Two files with the same 14-digit prefix are one version. Current CLI builds reject that before SQL runs, so a fresh `supabase db reset` or `supabase db push` can fail until the pairs below are split. They were not split here, because a rename of an applied file makes the next push run that SQL again.

| Version | Files (lexical order) | Neighbours |
|---------|----------------------|------------|
| `20260329240000` | `incident_section_updates_target_evidence`, `profile_associates_update_delete` | after `20260329230000`, before `20260329250000` |
| `20260329250000` | `criminal_profiles_legal_status`, `incident_section_updates_section_key_check_expand` | before `20260329260000` |
| `20260815031000` | `city_hub_share_rls`, `role_based_signup` | after `20260815030000`, before `20260815032000` |
| `20260815076000` | `emergency_directory_media`, `neighbourhood_activity_feed_windows` | after `20260815075000`, before `20260816002000` |

`platform/scripts/check-migration-versions.mjs` allowlists these four versions at count 2. A new collision fails CI. A third file on one of these prefixes fails CI.

### Repair, only after `supabase migration list`

Link from `platform/supabase` (`supabase link --project-ref pfjcxewlsqmfajrogvdo`) and run:

```bash
supabase migration list
```

The Remote column is the source of truth. Do this per duplicate version:

1. **Remote column is empty for that version.** Neither file is recorded. Rename both to unused 14-digit timestamps that still sort between the neighbours in the table above. Suggested suffixes if those minutes are still free: `…240100` for the associates file, `…250100` for the section-key file, `…310100` for `role_based_signup`, `…760100` for the activity-feed file. Keep the other file on the original version. Remove the version from `ALLOWLIST` in the same commit. Do not run `migration repair` for a version that was never recorded.

2. **Remote column shows the version.** It is applied. Do not rename. Confirm both files' effects are present (queries below). The history row cannot be split without a maintenance window: renaming one file to a new version makes `db push` apply it a second time. `20260329240000_profile_associates_update_delete.sql` is `CREATE POLICY` with no `DROP POLICY IF EXISTS`, so a second apply errors with "policy already exists". Leave the pair on the allowlist.

3. **Remote shows a version whose file you already renamed** (history drift after a confirmed rename). Only then:

```bash
supabase migration repair <old_version> --status reverted
supabase migration repair <new_version> --status applied
```

`repair --status applied` records the version. It does not run the SQL. Use it only when that SQL has already run. `repair --status reverted` deletes the history row. The next `db push` will run the file. Do not mark a version reverted if production still depends on it and the file is gone.

### Proof queries (read-only)

`20260329240000` — both concerns, if both files ran:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'incident_section_updates'
  AND column_name = 'target_evidence_id';

SELECT policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'profile_associates'
  AND policyname IN (
    'Enable update for authenticated users',
    'Enable delete for authenticated users'
  );
```

`20260329250000`:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'criminal_profiles'
  AND column_name IN ('conviction_history_summary', 'criminal_justice_status');

SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'incident_section_updates_section_key_check';
```

`20260815031000`:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'users'
  AND column_name = 'signup_track';

SELECT proname
FROM pg_proc
WHERE proname = 'publish_incident_to_city_hub';
```

`signup_track` is the durable mark of `role_based_signup`. `city_hub_share_rls` creates `publish_incident_to_city_hub` and replaces `city_hub_posts_write`. `20260815032000` drops that policy again, so a missing `city_hub_posts_write` does not mean `31000` never ran. A later migration may also have replaced the function body; the name only shows that some version of it was created.

`20260815076000`:

```sql
SELECT id, public FROM storage.buckets WHERE id = 'emergency-directory';

SELECT proname
FROM pg_proc
WHERE proname = 'list_resident_neighbourhood_activity';
```

## Sample data left in a migration

`20260815059000_sample_gqeberha_security_companies.sql` inserts named security companies (`settings_json.sample_listed = true`), updates rows with the same name, and points Tacnet at the Theescombe suburb. It is treated as applied, so production is presumed to already have those rows. The file was not edited and the inserts were not copied into `seed.sql`.

`platform/supabase/seed.sql` exists because `config.toml` `[db.seed] sql_paths` already pointed at it and the file was missing. It inserts nothing. `supabase db reset` is the only CLI path that loads it. A hosted session that has `supabase.project_ref` set hits the guard and returns.

A later local-only demo belongs in `seed.sql`, with `WHERE NOT EXISTS` or `ON CONFLICT`, not in a new migration.

## Two creators of `resident_report_events`

`20260815025000_resident_reporting_experience.sql` creates the table, indexes, the SELECT policy, and two INSERT policies.

`20260815051000_resident_activity_list_access.sql` runs `CREATE TABLE IF NOT EXISTS` with the same columns. On a database where `25000` ran, the second create does nothing. It then replaces `resident_report_events_select_scope` (the comparison is `::text` on both sides). It does not drop the INSERT policies.

`20260815052000_resident_report_timeline_events.sql` replaces both INSERT policies and backfills rows.

No new migration was added. The second `CREATE TABLE` is a no-op when the first file ran, which is the assumption while these files are treated as applied.

## Concatenated statements

`20261031071000_wishlist_multi_photos.sql` puts two statements on one line near the grants: the `GRANT` on `list_wishlist_items` and the `REVOKE` on `set_wishlist_item_acquired`. Postgres accepts it. The file was not edited. New migrations keep one statement per line (`SQL_CONVENTIONS.md`).

## `config.toml` is local

`platform/supabase/config.toml` is the local stack (`project_id = "web"`, ports 54321–54324). `supabase functions deploy` reads the `[functions.*]` blocks. `verify_jwt = false` on the cron and webhook functions is intentional: those handlers check `x-cron-secret` or a webhook secret, and the browser functions check the user JWT after CORS preflight.

`supabase config push` would also publish the auth settings. Do not push this file to project `pfjcxewlsqmfajrogvdo`. Settings that are right for local signup and wrong as production auth config:

| Setting | Local value | Why it must not be pushed |
|---------|-------------|---------------------------|
| `site_url` | `http://127.0.0.1:3000` | Production redirects would target localhost. |
| `additional_redirect_urls` | `https://127.0.0.1:3000` | Same, and the app does not serve TLS on that host. |
| `[auth.email] enable_confirmations` | `false` | Local mail catcher (`[local_smtp]`) is how you read mail. Production should keep its own confirmation setting. |
| `secure_password_change` | `false` | Skips a recent-login check. |
| `minimum_password_length` | `6` | Floor the hosted project should not inherit from this file. |
| `password_requirements` | empty | No character-class rule. |
| `[auth.email] max_frequency` | `1s` | Lets signup mail fire every second. |
| `[db.network_restrictions] allowed_cidrs` | `0.0.0.0/0` | Inert while `enabled = false`. Turning the section on without narrowing the list opens the database. |
| `[storage.s3_protocol] enabled` | `true` | Local S3 gateway. |
| `[edge_runtime] inspector_port` | `8083` | Local debugger. |

Nothing in that table was flipped. Changing `enable_confirmations` here would change local signup, not production, until somebody pushes the file.

## What was not verified

- `supabase migration list` against the hosted project.
- `supabase db reset` (no Docker, no CLI). Duplicate prefixes may still stop a fresh database before `20261105120000` runs.
- `platform/supabase/tests/isolation_tests_*.sql` against a live database.
- `pg_policies` after the new migration. The policy text was copied from the latest migration that creates each policy.
