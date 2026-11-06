# Archived SQL Editor scripts

These files used to live in `platform/supabase/sql/`. They are not migrations. None of them is a byte-for-byte copy of a migration, so they were moved here instead of deleted.

Do not run them against production to "catch up". The migrations already applied the schema. Re-running a script can recreate a function with an older body (`list_patrollers_for_sightings`) or install a webhook with the placeholders still in it.

| File | Why it is here |
|------|----------------|
| `criminal_profiles_legal_status_columns.sql` | Dashboard copy of `20260329250000_criminal_profiles_legal_status.sql` (extra header, same columns and checks). |
| `criminal_profiles_location_columns.sql` | Dashboard copy of `20260329270000_criminal_profiles_location_presence_residence.sql`. |
| `criminal_profiles_sightings_log.sql` | Overlaps `20260329290000_criminal_profiles_sightings_log.sql`. Later migrations may have replaced `list_patrollers_for_sightings`. |
| `profile_incidents_connection_apprehended.sql` | Overlaps `20260329280000` and the later `apprehended_released` check. Not the same file. |
| `incident_section_updates_constraints.sql` | Combines the section-key check, `target_evidence_id`, and `NOTIFY pgrst`. The pieces are in `20260329230000`, `20260329240000`, and `20260329250000`. |
| `user_push_tokens_full.sql` | Dashboard copy of `20260329123000_user_push_tokens.sql` plus deploy notes. |
| `schedule_chat_retention_cron.sql` | One-shot `pg_cron` schedule for `run_chat_messages_retention_purge`. Still the script to run in the SQL Editor after enabling `pg_cron`. The applied migration `20260401141000` comment still says `supabase/sql/`; that file was not edited. |
| `schedule_equipment_cron.sql` | One-shot `pg_cron` schedule for `run_equipment_housekeeping` (every 15 minutes). Run after `20261106180200` if the migration could not schedule the job itself. |
| `chat_messages_push_webhook_template.sql` | Template with `__PROJECT_REF__` and `__CHAT_NOTIFY_WEBHOOK_SECRET__`. Not safe to execute as-is. |

Isolation tests moved to `platform/supabase/tests/`, not here.
