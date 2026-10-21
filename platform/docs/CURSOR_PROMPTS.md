# Watchman — Cursor Agent Prompt Pack

*Companion to [`NEW_FEATURES_BLUEPRINT.md`](NEW_FEATURES_BLUEPRINT.md) (v3) · Updated 14 October 2026 · Owner: Theescombe Fibre*

> **v3 (14 Oct 2026):** money features removed by owner decision. The former money-related prompts were removed; Feature 2 is now the money-free **needs board** (prompt 11). The pack has 21 prompts, renumbered.

## How to use

1. **One prompt = one PR.** Paste a whole prompt (everything inside its fenced block) into a **new Cursor Agent chat** in the repo root (`F:\Projects\Neighborhood Watch Platform`). Don't combine prompts.
2. **Go in order.** Later prompts assume earlier helpers exist (`is_org_nw_admin`, `try_uuid`, `has_org_capability`, `should_notify` …). If you must skip one, read its "Depends on" line first.
3. **Before you paste:**
   - `git status` should be clean, apart from your own pending items (currently `platform/web/src/pages/Dashboard.jsx` and the untracked `20260827010000_end_patrol_idempotent.sql`; commit or stash them yourself first).
   - Create a branch: `git checkout -b g1-broadcast-hide`.
4. **Change the date prefix** of the migration file name to the day you run it, and keep the order. Never reuse a timestamp, and never edit an applied migration.
5. **The agent stops and shows you the diff.** Review it, then apply the migration to a **staging** Supabase project first (SQL editor). Run the manual checks, then commit and push yourself.
6. **After each phase:**
   - run `platform/supabase/sql/isolation_tests_community.sql` (created in G7) on staging;
   - tick the box below;
   - add the migration to the "Apply on Supabase" table in `platform/docs/SCALE_ROADMAP.md`.
7. **If the agent says a function body differs from the blueprint**, trust the repo. The blueprint SQL is a draft; the agent must copy the **latest** definition (found with `rg`) and apply only the described change.

### Standing rules (every prompt repeats them)

- Follow existing patterns:
  - SQL: `text + CHECK` instead of enums; `SECURITY DEFINER` + `SET search_path = public`; role normalisation `replace(lower(trim(role::text)),'-','_')`; `DROP POLICY IF EXISTS` before `CREATE POLICY`; SAST via `timezone('Africa/Johannesburg', now())`.
  - React: lazy pages in `App.jsx`, `PageHeader` + `homeBackNav()`, Tailwind card styles, `isRpcNotFoundError` graceful fallbacks, react-query or the `loadGen` stale-guard.
- **Grant convention:** every function gets `REVOKE ALL … FROM PUBLIC, anon`. Client RPCs get `GRANT EXECUTE … TO authenticated, service_role`. Internal/trigger/cron helpers are service_role only. Tables written through RPCs: `REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated`.
- **Org isolation:** derive the org from the row; check `IN (SELECT public.current_org_ids())`; cross-org errors say "not found".
- **Don't break Theescombe:** existing routes, roles and data keep working; new columns are nullable or defaulted; graceful UI before the migration is applied.
- No new dependencies unless the prompt names them. No unrelated refactors. Don't touch `Dashboard.jsx`, applied migrations, or `20260827010000_end_patrol_idempotent.sql`.
- Never commit, push, or apply SQL to production. **Stop and show the diff.**

## Progress checklist

| ✓ | # | Prompt | Migration / output | Depends on |
|---|---|---|---|---|
| [ ] | 1 | G1 — Area broadcasts: hide, restore, edit-own, realtime UPDATE | `20261003001000_area_broadcast_hide_restore.sql` | — |
| [ ] | 2 | G2 — Audit log hardening + org audit viewer | `20261003002000_audit_log_hardening.sql` | — |
| [ ] | 3 | G3 — Emergency directory org scope | `20261003003000_emergency_directory_org_scope.sql` | G2 |
| [ ] | 4 | G4 — Storage write lockdown + safe path helpers | `20261003004000_storage_write_hardening.sql` | G3 |
| [ ] | 5 | G5 — Users privilege guard + SQL grant convention doc | `20261003005000_users_privilege_guard.sql` | G1, G2 |
| [ ] | 6 | G6 — Notification preferences | `20261003006000_notification_prefs.sql` | — |
| [ ] | 7 | G7 — Two-org isolation test script | `platform/supabase/sql/isolation_tests_community.sql` | G1–G6 |
| [ ] | 8 | P0a — Capability grants (backend) | `20261003010000_org_capability_grants.sql` | G2 |
| [ ] | 9 | P0b — Capability frontend + content reports + community buckets | `20261003012000_…`, `20261003020000_…` | P0a, G4 |
| [ ] | 10 | P1 — Resident moderators & street reps | `20261003011000_…`, `20261003013000_…` | P0b, G1 |
| [ ] | 11 | P2 — Equipment wishlist / needs board (no money) | `20261003030000_equipment_wishlist.sql` | P0b |
| [ ] | 12 | P3a — Equipment catalogue, units, QR labels, custody ledger | `20261003035000_equipment_catalogue.sql` | P0b (P2 optional) |
| [ ] | 13 | P3b — Equipment bookings, checkout & return handshake | `20261003036000_equipment_loans_transfers_ledger.sql` (part 1) | P3a |
| [ ] | 14 | P3c — Equipment transfers, incidents, maintenance, overdue cron | `20261003036000_…` (part 2) + `20261003037000_…` | P3b, G6 |
| [ ] | 15 | P3d — Equipment dashboards, stocktake, exports, offline queue | `20261003038000_equipment_reporting.sql` | P3c |
| [ ] | 16 | P4a — Local services: taxonomy, listings, search | `20261003040000_…`, `20261003041000_…` | P1 |
| [ ] | 17 | P4b — Local services: reviews, reports, moderation | `20261003042000_local_services_reviews.sql` | P4a |
| [ ] | 18 | P5 — Outage notices + daily digest | `20261003060000_…`, `20261003062000_…` | P1, G6 |
| [ ] | 19 | P6a — Community events & RSVP | `20261003070000_community_events.sql` | P0b |
| [ ] | 20 | P6b — Polls + lost & found / pets | `20261003071000_…`, `20261003072000_…` | P0b |
| [ ] | 21 | P7 — Onboarding checklist, volunteer tasks, camera footage requests | `20261003090000_…`–`092000_…` | P0b |

> P3 is split so that `036000` is written across two prompts. P3b creates the file with bookings/loans. P3c **appends** transfers to the same file only if it hasn't been applied yet; otherwise P3c creates `20261003036500_equipment_transfers.sql`. The agent must check which applies.

---
## 1. G1 — Area broadcasts: hide, restore, edit-own, realtime UPDATE

**Depends on:** none · **Migration:** `platform/supabase/migrations/20261003001000_area_broadcast_hide_restore.sql`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: G1 — Area broadcasts: hide, restore, edit-own, realtime UPDATE.

GOAL
Let notice authors and watch staff take down (hide) or quickly fix an area broadcast, and make open screens update live.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§4.1 G1, §3.2 Area broadcasts row)
- @platform/supabase/migrations/20260816002000_away_broadcasts_civic.sql
- @platform/supabase/migrations/20260818030000_area_broadcast_home_windows.sql
- @platform/supabase/migrations/20260819020100_watch_staff_activity_triggers.sql
- @platform/web/src/pages/AreaBroadcast.jsx
- @platform/web/src/utils/areaBroadcasts.js
- @platform/web/src/pages/ResidentDashboard.jsx
- @platform/web/src/auth/roleMatrix.js

SCOPE
SQL: hidden_at/hidden_by/hidden_reason/edited_at columns, is_area_broadcast_staff(), hide_area_broadcast, restore_area_broadcast, edit_area_broadcast (author, 15 min), list_area_broadcasts excludes hidden, SELECT policy hides hidden rows from non-staff. UI: Hide (reason dialog), Restore + 'Hidden' filter for staff, Edit within 15 min, realtime UPDATE handling. OUT of scope: capabilities/moderators (P1), changing who can post.

STEPS
1. Find every definition of area_broadcasts policies, list_area_broadcasts and post_area_broadcast; note the latest.
2. Write the migration per §4.1: columns, partial index, is_area_broadcast_staff(), hide/restore/edit RPCs with org checks and write_staff_activity + notify_app_user to the author when hidden by someone else.
3. DROP + re-create list_area_broadcasts from 20260818030000 adding AND hidden_at IS NULL and edited_at in the output.
4. Re-create the SELECT policy so hidden rows are visible only to staff and the author.
5. utils/areaBroadcasts.js: add hideAreaBroadcast, restoreAreaBroadcast, editAreaBroadcast; subscribeAreaBroadcasts listens to INSERT and UPDATE.
6. AreaBroadcast.jsx: Hide/Restore/Edit actions, hidden filter for staff, 'edited' label. Resident home lists drop hidden notices on UPDATE.
7. Grants per convention.

MIGRATION FILE
platform/supabase/migrations/20261003001000_area_broadcast_hide_restore.sql

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- Author can hide own notice; NW admin/committee/global staff can hide any notice in their org; residents cannot hide others' notices.
- Hidden notices disappear from resident home and /admin/broadcast list without reload (realtime UPDATE); staff can restore.
- Edit works only for the author within 15 minutes; no new push on edit.
- Every hide/restore writes an activity_logs row.
- Org B staff cannot hide Org A notice ('notice not found').

TESTS / MANUAL CHECKS TO RUN
- Apply on staging; post a notice as NW admin; hide as author; restore as staff.
- Two browsers (resident + admin): hide on one, it vanishes on the other.
- Try edit after 16 minutes → error message toast.
- npm run lint in platform/web.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

## 2. G2 — Audit log hardening + org audit viewer

**Depends on:** none · **Migration:** `platform/supabase/migrations/20261003002000_audit_log_hardening.sql`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: G2 — Audit log hardening + org audit viewer.

GOAL
Stop forged audit rows and resident access to the staff log, log every privilege change, and give NW admins an audit view of their own org.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§4.2 G2, §12.5, §12.7)
- @platform/supabase/migrations/20260815010000_scale_multitenant_foundation.sql (activity_logs + policies)
- @platform/supabase/migrations/20260819020000_watch_staff_activity_log.sql
- @platform/supabase/migrations/20260819020100_watch_staff_activity_triggers.sql
- @platform/supabase/migrations/20260819020200_watch_staff_activity_list.sql
- @platform/supabase/migrations/20260815032000_city_hub_post_manage.sql
- @platform/supabase/functions/admin-delete-user/index.ts
- @platform/supabase/functions/delete-my-account/index.ts
- @platform/web/src/pages/AdminWatchStaffActivity.jsx
- @platform/web/src/components/admin/AdminToolsMenu.jsx

SCOPE
SQL: drop activity_logs_insert_actor; revoke client writes; append-only trigger with retention GUC; drop the two activity_logs FKs (verify names); SELECT policy = global/platform staff or is_org_nw_admin(org); create is_org_nw_admin(uuid) and user_in_org(uuid,uuid) (bodies in §5.4); list_org_audit_log(); widen list_watch_staff_activity; log all role/platform_role/verified changes; City Hub delete/archive triggers. Edge: admin-delete-user and delete-my-account write an audit row before deletion. UI: 'Audit log' tab for NW admins with filters + CSV export (exceljs is installed). OUT: retention cron job (document only).

STEPS
1. rg all activity_logs policies/triggers; confirm no client code inserts into activity_logs (rg "activity_logs" platform/web/src).
2. Write the migration per §4.2, including is_org_nw_admin and user_in_org (user_in_org: service_role only).
3. Re-create trg_log_watch_staff_user_changes from 20260819020100 to log ANY role change, platform_role change, verified flips; trigger AFTER UPDATE OF role, platform_role, organization_id, verified.
4. Re-create list_watch_staff_activity from 20260819020200 with the widened actor filter.
5. City Hub: AFTER DELETE trigger and archive/status-change trigger (use the real column names).
6. Edge functions: insert an audit row with the service-role client before deleting (initials only for the subject).
7. AdminWatchStaffActivity.jsx: add an 'Audit log' tab using list_org_audit_log (NW admin sees own org; global staff the working org), action filter, load-more by created_at, CSV export.
8. AdminToolsMenu: ensure NW admins can reach it.

MIGRATION FILE
platform/supabase/migrations/20261003002000_audit_log_hardening.sql

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- A resident/patroller selecting activity_logs gets 0 rows; inserting gets permission denied.
- UPDATE/DELETE on activity_logs fails for everyone except the retention path.
- resident → patroller promotion appears in the log.
- NW admin sees own-org audit only; switching working area as global staff switches the log.
- Deleting a user via admin-delete-user leaves a 'user_deleted' row; the deletion itself still succeeds (no FK error).

TESTS / MANUAL CHECKS TO RUN
- Staging: as resident run select count(*) from activity_logs via the JS client in devtools → 0.
- Promote a test resident in /admin/residents → row appears.
- Delete a test user → row appears, user gone.
- npm run lint.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

## 3. G3 — Emergency directory org scope

**Depends on:** G2 (is_org_nw_admin) · **Migration:** `platform/supabase/migrations/20261003003000_emergency_directory_org_scope.sql`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: G3 — Emergency directory org scope.

GOAL
Stop any NW admin from editing city-wide emergency numbers; let each watch keep its own local contacts.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§4.3 G3, D12)
- @platform/supabase/migrations/20260815074000_branding_banner_and_emergency_directory.sql
- @platform/supabase/migrations/20260815075000_emergency_directory_manage.sql
- @platform/supabase/migrations/20260815076000_emergency_directory_media.sql
- @platform/web/src/pages/EmergencyContacts.jsx
- @platform/web/src/utils/emergencyDirectory.js
- @platform/web/src/auth/roleMatrix.js

SCOPE
SQL: nullable organization_id + index; can_manage_emergency_entry(org); list_emergency_directory returns city-wide + caller-org rows (local first); upsert gets p_scope ('org'|'global'), old 12-arg signature dropped; any delete path gets the same check. UI: scope switch (City-wide only for global staff), Local/City chip, upload path change is in G4 (not here).

STEPS
1. rg every emergency_directory_entries write path (RPCs, policies, direct table writes in the web app).
2. Write the migration per §4.3. Existing rows stay NULL (city-wide).
3. DROP the old upsert signature in the same migration; create the new one with p_scope DEFAULT 'org'.
4. Ensure table write policies (if any) don't allow bypassing the RPC; revoke direct writes if the app doesn't use them.
5. emergencyDirectory.js: pass p_scope; EmergencyContacts.jsx: scope switch + chips; sort local first.

MIGRATION FILE
platform/supabase/migrations/20261003003000_emergency_directory_org_scope.sql

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- NW admin creates a contact → only their org sees it.
- NW admin cannot edit a city-wide row or another org's row ('Not allowed').
- Global staff can create city-wide rows; all orgs see them.
- Resident views on /resident/contacts and /intelligence/contacts still work.

TESTS / MANUAL CHECKS TO RUN
- Staging with two orgs: create local contact in A, check B doesn't see it.
- Try editing a city-wide police entry as NW admin → error toast.
- npm run lint.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

## 4. G4 — Storage write lockdown + safe path helpers

**Depends on:** G3 (can_manage_emergency_entry) · **Migration:** `platform/supabase/migrations/20261003004000_storage_write_hardening.sql`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: G4 — Storage write lockdown + safe path helpers.

GOAL
Close the hole where any signed-in user can overwrite or delete files in incident-photos, city-hub-photos, security-branding and emergency-directory; add path helpers used by later phases.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§4.4 G4, §12.3)
- @platform/supabase/migrations/20260328163000_storage_incident_photos_bucket.sql
- @platform/supabase/migrations/20260815034000_city_hub_photos.sql
- @platform/supabase/migrations/20260815035000_city_hub_pdf_attachments.sql
- @platform/supabase/migrations/20260815074000_branding_banner_and_emergency_directory.sql
- @platform/supabase/migrations/20260815076000_emergency_directory_media.sql
- @platform/supabase/migrations/20260820090000_storage_public_buckets_no_listing.sql
- @platform/supabase/migrations/20260820060000_org_isolation_hardening.sql (incident_in_caller_orgs, can_moderate_incidents)
- @platform/supabase/migrations/20260815032000_city_hub_post_manage.sql (can_manage_city_hub_post)
- @platform/supabase/migrations/20260815038000_partner_city_dashboards.sql (my_security_company_ids)
- @platform/web/src/pages/IncidentForm.jsx
- @platform/web/src/pages/ResidentActivityReport.jsx
- @platform/web/src/utils/deleteIncident.js
- @platform/web/src/utils/cityHubPhotos.js
- @platform/web/src/pages/CityHub.jsx
- @platform/web/src/utils/emergencyDirectory.js
- @platform/web/src/pages/SecurityBranding.jsx

SCOPE
SQL: try_uuid, storage_path_org_id, storage_path_in_caller_org, storage_incident_writable, storage_city_hub_post_manageable; replace bucket-only INSERT/UPDATE/DELETE policies of the 4 buckets with entity-scoped ones; reads unchanged. Web: emergency-directory upload path → {org}/… or global/…. Report on criminal-photos policies (search code + migrations) but do not change it unless policies exist in the repo.

STEPS
1. List every storage.objects policy in the repo with names and buckets (rg -n "ON storage.objects").
2. Write the migration per §4.4; drop the old write policies by exact name; keep public URL reads working.
3. Verify upload order: IncidentForm and ResidentActivityReport insert the incident first and upload to {incident_id}/…; CityHub inserts the post first (uploadCityHubPhotos(inserted.id…)).
4. deleteIncident.js must still work for moderators (delete policy allows can_moderate_incidents + incident in org).
5. Update uploadEmergencyDirectoryImage to the new path (needs activeOrganizationId + scope from the caller).
6. Print a 'live check' SQL snippet (pg_policies on storage.objects) in your summary for me to run first.

MIGRATION FILE
platform/supabase/migrations/20261003004000_storage_write_hardening.sql

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- A resident can still attach photos to their own incident report; a patroller can still add incident photos.
- A user cannot upload into incident-photos/<incident of another org>/… nor overwrite another user's object.
- City Hub author/NW admin can upload/delete their post's photos; others cannot.
- Security company admin can replace own logo, not another company's.
- Existing image URLs everywhere still load.

TESTS / MANUAL CHECKS TO RUN
- Staging: report an incident with photo as resident (works); try supabase.storage.from('security-branding').upload('<other company id>/x.png', file) in devtools → 403.
- Delete an incident as moderator → photos removed.
- npm run lint.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

## 5. G5 — Users privilege guard + SQL grant convention doc

**Depends on:** G1 (is_area_broadcast_staff), G2 (user_in_org, is_org_nw_admin) · **Migration:** `platform/supabase/migrations/20261003005000_users_privilege_guard.sql`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: G5 — Users privilege guard + SQL grant convention doc.

GOAL
Make it impossible for a user to promote themselves or for local staff to mint global roles or edit users of another org, regardless of the dashboard-only users RLS.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§4.5 G5 + grant convention, D1)
- @platform/supabase/migrations/20260815033000_preserve_privileged_roles_on_signup.sql
- @platform/supabase/migrations/20260820080000_advisor_rpc_harden.sql
- @platform/web/src/pages/AdminResidents.jsx
- @platform/web/src/pages/Profile.jsx
- @platform/web/src/auth/AuthProvider.jsx
- @platform/web/src/auth/roleMatrix.js

SCOPE
SQL: trg_users_privilege_guard BEFORE UPDATE on public.users (rules in §4.5; only enforced when current_user is authenticated/anon). Docs: create platform/docs/SQL_CONVENTIONS.md with the grant convention + SECURITY DEFINER checklist (§4.5 and §12.7). OUT: changing AdminResidents UX.

STEPS
1. rg every client-side supabase.from('users').update( call and list which columns each writes; make sure none is blocked unintentionally (Profile edits, household mode, active_organization_id switch, patroller_request_status).
2. rg signup/handle_new_user/assign/move functions: confirm they are SECURITY DEFINER (they bypass the guard). List any INVOKER ones in your summary.
3. Write the trigger per §4.5 using GLOBAL_APP_ROLES from roleMatrix.js plus security_admin/city_admin as non-local roles.
4. Create platform/docs/SQL_CONVENTIONS.md.
5. Output the live-check SQL (pg_policies for users) for me to run before applying.

MIGRATION FILE
platform/supabase/migrations/20261003005000_users_privilege_guard.sql

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- Resident cannot change own role/verified/organization_id via the JS client.
- NW admin can still promote resident → patroller in /admin/residents; cannot set admin/technical_support; cannot edit users of another org.
- Committee cannot appoint nw_admin.
- Profile edits, household switch and working-area switch still work.

TESTS / MANUAL CHECKS TO RUN
- Staging devtools as resident: await supabase.from('users').update({role:'nw_admin'}).eq('id', me) → error.
- Promote via /admin/residents as NW admin → works.
- Switch working area as a multi-org member → works.
- npm run lint.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

## 6. G6 — Notification preferences

**Depends on:** none · **Migration:** `platform/supabase/migrations/20261003006000_notification_prefs.sql`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: G6 — Notification preferences.

GOAL
Let people mute non-critical notification kinds (push and/or in-app) with quiet hours, while SOS and safety alerts can never be muted.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§4.6 G6, D24)
- @platform/web/src/utils/appNotifications.js
- @platform/web/src/components/layout/AppNotificationBell.jsx
- @platform/web/src/pages/Profile.jsx
- @platform/supabase/functions/notify-resident-event/index.ts
- @platform/supabase/functions/notify-chat-message/index.ts
- @platform/supabase/functions/notify-incident-status/index.ts
- @platform/supabase/migrations/20260820080000_advisor_rpc_harden.sql (notify_app_user grants)

SCOPE
SQL: user_notification_prefs (own-row RLS), is_mandatory_notification_kind, should_notify (service_role), notify_app_user early-return. Edge functions filter recipients with should_notify before FCM. UI: Profile → Notifications section + web/src/utils/notificationKinds.js (labels, mandatory list in sync with SQL).

STEPS
1. rg notify_app_user latest definition and every kind string used in SQL + edge functions; build the kinds list.
2. Write the migration per §4.6.
3. Re-create notify_app_user with the in-app check (keep signature + grants).
4. Each push edge function: batch-call should_notify via service-role rpc per recipient (or a set-returning helper filter_notify_recipients(uuid[], kind) you add, service_role only).
5. components/profile/NotificationPrefs.jsx + mount in Profile.jsx; lock icon for mandatory kinds.

MIGRATION FILE
platform/supabase/migrations/20261003006000_notification_prefs.sql

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- Muting 'broadcast' push stops broadcast pushes but in-app still arrives (unless in-app muted).
- SOS cannot be muted (toggle disabled; server ignores prefs).
- Quiet hours 22:00–06:00 SAST suppress push only.
- Users can only read/write their own prefs.

TESTS / MANUAL CHECKS TO RUN
- Staging: mute broadcast push on a test phone, post a notice → no push, bell shows it.
- Trigger an SOS → push arrives.
- npm run lint.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

## 7. G7 — Two-org isolation test script

**Depends on:** G1–G6 · **Migration:** `platform/supabase/sql/isolation_tests_community.sql (not a migration)`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: G7 — Two-org isolation test script.

GOAL
Turn the manual 'Isolation proof' into a repeatable SQL script for staging that impersonates users and asserts isolation, rolling back at the end.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§4.7 G7, §14 matrix)
- @platform/docs/SCALE_ROADMAP.md
- @platform/supabase/migrations/20260815028000_intelligence_org_isolation.sql

SCOPE
Create platform/supabase/sql/isolation_tests_community.sql with helpers pg_temp.as_user(uuid), pg_temp.expect_error(sql, like), pg_temp.expect_rows(sql, n); psql variables for test user ids; assertions for §14 rows that exist after G1–G6 (rows 3, 24–33). Add a short README block at the top. OUT: CI integration.

STEPS
1. Write the script per §4.7, wrapped in BEGIN … ROLLBACK.
2. Implement assertions for G1–G6 rows from §14; leave clearly marked TODO sections per later phase.
3. Document how to run: psql "$STAGING_DB_URL" -v a_res=… -v a_admin=… -v b_res=… -v b_admin=… -f …

MIGRATION FILE
platform/supabase/sql/isolation_tests_community.sql (not a migration)

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- Script runs end-to-end on staging with all assertions passing and leaves no data behind.
- A deliberately broken policy (e.g. temporarily re-adding activity_logs_insert_actor in a scratch DB) makes it fail.

TESTS / MANUAL CHECKS TO RUN
- Run on staging; paste output in the PR description.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

## 8. P0a — Capability grants (backend)

**Depends on:** G2 · **Migration:** `platform/supabase/migrations/20261003010000_org_capability_grants.sql`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: P0a — Capability grants (backend).

GOAL
Add per-organization capabilities (resident_broadcaster, resident_moderator, equipment_custodian) with audited grant/revoke RPCs.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§5.1, §5.4, D1, D3, D17)
- @platform/supabase/migrations/20260815028000_intelligence_org_isolation.sql
- @platform/supabase/migrations/20260815042000_resident_neighbour_activity_and_verification_log.sql (is_verified_household, resident_street_label)
- @platform/supabase/migrations/20260819020000_watch_staff_activity_log.sql

SCOPE
SQL only: org_capability_grants table + RLS (own rows or managers), user_has_org_capability (service_role), has_org_capability, can_manage_org_capabilities, grant/revoke RPCs (user_in_org check, verified check for resident caps, equipment_custodian needs a watch role), get_my_org_capabilities, list_org_capability_grants, list_capability_badges. Notifications + audit on grant/revoke. OUT: UI (P0b).

STEPS
1. Write the migration per §5.4 exactly (it already contains the v2 security fixes); re-check every function against the definer checklist in §12.7.
2. Partial unique index: one active grant per (org, user, capability).
3. Grants per convention; internal helpers service_role only.

MIGRATION FILE
platform/supabase/migrations/20261003010000_org_capability_grants.sql

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- NW admin of A can grant/revoke in A only; committee cannot (D1).
- Unverified resident cannot receive resident capabilities (D3).
- B admin granting to an A user → 'user is not in this neighbourhood'.
- Residents can read only their own grants; badges via list_capability_badges only.

TESTS / MANUAL CHECKS TO RUN
- Staging SQL: run §14 rows 1 and 13 via the G7 script (add them).
- Check activity_logs rows for grant/revoke.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

## 9. P0b — Capability frontend + content reports + community storage buckets

**Depends on:** P0a, G4 · **Migration:** `platform/supabase/migrations/20261003012000_community_content_reports.sql + 20261003020000_community_storage_buckets.sql`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: P0b — Capability frontend + content reports + community storage buckets.

GOAL
Expose capabilities to the React app, add the generic content-report table/RPC, and create the org-scoped community-media/community-private buckets.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§5.2, §5.3, §5.5, §5.6, §5.7)
- @platform/web/src/components/RequireRole.jsx
- @platform/web/src/auth/roleMatrix.js
- @platform/web/src/auth/AuthProvider.jsx
- @platform/web/src/utils/organizationScope.js
- @platform/web/src/App.jsx

SCOPE
Web: hooks/useOrgCapabilities.js, auth/capabilities.js, components/RequireCapability.jsx. SQL: community_content_reports + can_moderate_resident_content + report_community_content (broadcast branch only for now); buckets + media policies + community-private INSERT (SELECT policy ships in P3a). Uses storage helpers from G4.

STEPS
1. Write 20261003012000 per §5.5 and 20261003020000 per §5.6 (helpers come from G4; don't redefine).
2. Frontend files per §5.7; RequireCapability redirects to homePathForRole() on deny.
3. No route changes yet except a dev-only smoke usage if needed.

MIGRATION FILE
platform/supabase/migrations/20261003012000_community_content_reports.sql + 20261003020000_community_storage_buckets.sql

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- useOrgCapabilities returns [] gracefully before SQL is applied.
- Reporting a broadcast creates one row per reporter (duplicate → friendly error).
- Upload to community-media/{other org}/… → 403.

TESTS / MANUAL CHECKS TO RUN
- Staging: report a notice twice; upload test via devtools to own and other org paths.
- npm run lint.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

## 10. P1 — Resident moderators & street reps

**Depends on:** P0b, G1 · **Migration:** `platform/supabase/migrations/20261003011000_area_broadcast_moderators.sql + 20261003013000_capability_auto_revoke_on_move.sql`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: P1 — Resident moderators & street reps.

GOAL
Let NW admins appoint verified residents as street reps (post notices) and moderators (hide resident notices, handle reports), shown with a badge.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§6 whole section, D1–D3)
- @platform/web/src/pages/AdminResidents.jsx
- @platform/web/src/pages/AreaBroadcast.jsx
- @platform/web/src/utils/areaBroadcasts.js
- @platform/web/src/pages/ResidentDashboard.jsx
- @platform/web/src/pages/Profile.jsx
- @platform/web/src/components/admin/AdminToolsMenu.jsx
- @platform/web/src/App.jsx
- @platform/supabase/functions/notify-resident-event/index.ts

SCOPE
SQL: 20261003011000 (author_badge, can_post_area_broadcast with capability, quota D2, hide/restore with moderator clause, broadcast audit trigger) + 20261003013000 (auto-revoke grants when users.organization_id changes). Web: assign/revoke UI on /admin/residents, badge on Profile + notices, /resident/broadcast (RequireCapability), /resident/moderate queue, AreaBroadcast route guard becomes capability-aware. Push: notify-resident-event accepts capability holders for type broadcast (server-side check).

STEPS
1. Write both migrations per §6.5 (+ §12.7 fixes).
2. Implement routes/components per §6.3–6.4.
3. notify-resident-event: verify caller can_post_area_broadcast via service-role query before fan-out.
4. Add the moderation queue reading community_content_reports for the working org.

MIGRATION FILE
platform/supabase/migrations/20261003011000_area_broadcast_moderators.sql + 20261003013000_capability_auto_revoke_on_move.sql

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- Street rep posts max 3 notices / 24 h; they reach only their org.
- Moderator can hide capability-authored notices, not staff notices.
- Moving a resident to another org revokes their grants.
- All §6.10 acceptance items pass.

TESTS / MANUAL CHECKS TO RUN
- Staging walkthrough of §6.10 with two orgs.
- npm run lint.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

## 11. P2 — Equipment wishlist / needs board (no money)

**Depends on:** P0b · **Migration:** `platform/supabase/migrations/20261003030000_equipment_wishlist.sql`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: P2 — Equipment wishlist / needs board (no money).

GOAL
NW admins and equipment custodians list equipment the watch needs (photo, name, quantity, estimated price, reason, store link, product code, status needed/acquired/cancelled); residents browse it and can send a simple 'offer to help / contribute item' interest note. No money, amounts or payment details anywhere in the app.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§7 whole section, D4–D9, D16)
- @platform/web/src/pages/ResidentDashboard.jsx
- @platform/web/src/App.jsx
- @platform/web/src/components/admin/AdminToolsMenu.jsx
- @platform/web/src/utils/communityMedia.js (if created in P0b)

SCOPE
SQL: can_manage_wishlist (NW admin + equipment_custodian + global staff), equipment_wishlist_items, equipment_wishlist_offers (own or manager SELECT), RPCs upsert_wishlist_item, set_wishlist_item_status, create_wishlist_offer (rate limit 5/24h, rejects notes with 9+ digit runs or payment wording), withdraw_wishlist_offer, respond_wishlist_offer, list_wishlist_items, list_wishlist_offers; notifications kind 'wishlist'; P1 move trigger withdraws open offers. Web: /resident/needs (+ /needs for watch members), /resident/needs/:id, /admin/needs (editor + offers inbox), conditional home tile (D16), OfferDialog with the 'no payment details' hint. Photos under community-media/{org}/needs/{id}/…. OUT: converting to inventory (P3a adds create_equipment_from_wishlist and the 'Add to inventory' button).

STEPS
1. Write the migration per §7.6; check every RPC against the definer checklist in §12.7.
2. Store links: https only, opened externally with rel=noopener noreferrer.
3. Build pages/components per §7.4–7.5; estimated price shown as 'est.' information only.
4. Extend the P1 move trigger (new CREATE OR REPLACE in this migration) to withdraw the mover's open offers.

MIGRATION FILE
platform/supabase/migrations/20261003030000_equipment_wishlist.sql

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- Residents of the same org see needed/acquired items; Org B sees nothing; cancelled items only for managers.
- Offers are visible only to the offerer and managers; managers see offerer contact via list_wishlist_offers.
- A note with a 10-digit number is rejected with the friendly message.
- Marking quantity acquired = needed flips status to acquired and notifies offerers.
- Check the diff: no payment or amount-collection UI anywhere.

TESTS / MANUAL CHECKS TO RUN
- Staging: create item as NW admin, offer as resident in A, check B can't see it; respond to the offer.
- npm run lint.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

## 12. P3a — Equipment catalogue, units, QR labels, custody ledger

**Depends on:** P0b (P2 optional for the needs-board link) · **Migration:** `platform/supabase/migrations/20261003035000_equipment_catalogue.sql`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: P3a — Equipment catalogue, units, QR labels, custody ledger.

GOAL
Custodians list the watch's gear (items and individual units with asset tags, serials, purchase/funding info, warranty, kit contents, battery) and print QR labels; members browse the catalogue; every unit change starts the append-only ledger.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§10.1–10.5, §10.6 ledger block, §10.8–10.9, D17, D19)
- @platform/web/src/pages/Vehicles.jsx (card/list pattern)
- @platform/web/src/pages/PatrolSchedule.jsx
- @platform/web/src/auth/roleMatrix.js (PATROL_MEMBER_ROLES)
- @platform/web/src/components/admin/AdminToolsMenu.jsx
- @platform/web/src/App.jsx
- @platform/web/package.json

SCOPE
SQL: is_patrol_role, is_equipment_member, can_manage_equipment, categories/items/units/certifications with column-level grants (price/serial/qr_token hidden from members), units guard trigger, ledger table + immutable triggers + equipment_ledger_append (moved here from §10.6), equipment_transition_allowed, equipment_set_unit_status, catalogue RPCs (ensure defaults, upsert item, add unit, update details, rotate QR, get admin, resolve QR, certifications, create_equipment_from_wishlist if equipment_wishlist_items exists else a TODO), community-private SELECT policy with the equipment branch (§5.6/§10.5). Web: /equipment catalogue, item page, unit page with custody timeline, /equipment/u/:qrToken, /equipment/admin/items editor, /equipment/admin/labels (A4 QR sheet), /equipment/admin/certifications. New package: qrcode. OUT: bookings/loans (P3b).

STEPS
1. Write the migration per §10.5 plus the ledger/state-machine block from §10.6.
2. If equipment_wishlist_items does not exist yet, create wishlist_item_id as plain uuid and leave a comment for the FK. funding_source values: watch_funds, contributed_item, sponsor, grant, loaned_by_member, other. Add an 'Add to inventory' button on /admin/needs for acquired items.
3. utils/equipment.js with wrappers + EQUIPMENT_STATUS_META (greyed flag).
4. Pages/components per §10.8–10.9 (catalogue, item, unit, labels, editor, certifications). Members see holder first name + initial only.
5. Menu entries: patrol navigation 'Equipment', AdminToolsMenu 'Equipment inventory' (custodians). Don't touch Dashboard.jsx.

MIGRATION FILE
platform/supabase/migrations/20261003035000_equipment_catalogue.sql

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- Residents can't reach /equipment and RPCs say not found.
- Members can't select purchase_price_cents/qr_token/serial (column grants).
- Asset tag unique per org; QR label prints and scanning/opening the URL lands on the unit page.
- Ledger rows are created for unit_added; UPDATE/DELETE on the ledger fails even as service_role.

TESTS / MANUAL CHECKS TO RUN
- Staging: add item + 3 units, print labels, open a QR URL on a phone.
- Try ledger UPDATE in SQL editor → error.
- npm run lint && npm run build.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

## 13. P3b — Equipment bookings, checkout & return handshake

**Depends on:** P3a · **Migration:** `platform/supabase/migrations/20261003036000_equipment_loans_transfers_ledger.sql (bookings + loans part)`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: P3b — Equipment bookings, checkout & return handshake.

GOAL
Members book gear for a patrol shift or time window (with waitlist); custodians approve; checkout and return need two confirmations (custodian code + borrower acknowledgement) with condition, battery, kit and photo.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§10.3 flows A/B/D, §10.6 bookings + loans + eligibility, D18, D20)
- @platform/web/src/pages/PatrolSchedule.jsx
- @platform/web/src/utils/equipment.js
- @platform/web/src/chat/hooks/useNetworkStatus.js

SCOPE
SQL: btree_gist, equipment_reservations (exclusion constraint), equipment_loans (+ current_loan FK), equipment_ineligible_reason (service_role) + check_my_equipment_eligibility, booking RPCs (request/decide/cancel), checkout RPCs (start → code; confirm with code + ack), extension RPCs, return RPCs (start/confirm, faulty → under_repair), read RPCs (list_my_equipment, get_equipment_unit). Web: booking calendar on item page, 'Book gear for this shift' link from PatrolSchedule, /equipment/my, /equipment/admin/requests (approvals, checkout desk with HandshakeCode, returns desk), ConditionCapture, ResponsibilityAck, CodeEntry. Photos to community-private/{org}/equipment/{unit}/{event}/…. OUT: transfers/incidents (P3c).

STEPS
1. Write the bookings/loans part of 036000 per §10.6 (leave transfers for P3c, or include the table only).
2. Codes: 6 digits from gen_random_bytes, stored as sha256(code||':'||id), 15-min expiry, 5 attempts.
3. Separation of duties: custodian can't confirm own loan/return.
4. Shift link computes window start−2h…end+2h SAST, capped by max_loan_hours.
5. Build the UI pieces listed; reuse Vehicles-style cards.

MIGRATION FILE
platform/supabase/migrations/20261003036000_equipment_loans_transfers_ledger.sql (bookings + loans part)

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- Double booking impossible (exclusion); second request is waitlisted.
- Checkout only completes after both confirmations; ledger has both events; unit shows holder.
- Ineligible users get a clear reason (suspended, 2 loans, overdue, missing certification).
- Return OK → available; faulty → under_repair.

TESTS / MANUAL CHECKS TO RUN
- Staging with custodian + 2 patrollers through flows A, B, D.
- npm run lint && npm run build.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

## 14. P3c — Equipment transfers, incidents, maintenance, overdue cron

**Depends on:** P3b, G6 · **Migration:** `platform/supabase/migrations/20261003037000_equipment_incidents_maintenance_stocktake.sql (+ transfers in 036000 or 036500) + platform/supabase/sql/schedule_equipment_cron.sql`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: P3c — Equipment transfers, incidents, maintenance, overdue cron.

GOAL
Patroller-to-patroller handover with request → accept → two-party code handshake and timeouts; incident reports (damage/theft/malfunction/lost with SAPS CAS no.) that grey the unit out; resolution, liability, maintenance log; overdue escalation via pg_cron.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§10.3 flows C/E/F, §10.4 state machine, §10.6 transfers, §10.7, §10.10, §10.12, D18, D21, D22)
- @platform/supabase/sql/schedule_chat_retention_cron.sql
- @platform/supabase/functions/notify-resident-event/index.ts
- @platform/web/src/components/layout/AppNotificationBell.jsx
- @platform/web/src/utils/equipment.js

SCOPE
SQL: equipment_transfers + transfer RPCs (request, respond, confirm giver, confirm receiver, force-complete, cancel, counterpart contact), incidents/maintenance tables + RPCs (report, add CAS, resolve, approve write-off four-eyes, decide liability NW-admin-only, log maintenance), run_equipment_housekeeping + platform/supabase/sql/schedule_equipment_cron.sql P1 move-trigger extended for open loans. Web: /equipment/handover/:transferId, request handover on unit page, incident form + greyed cards, /equipment/admin/incidents, notification kinds equipment/equipment_overdue_escalation (icons + prefs list). OUT: dashboards/stocktake (P3d).

STEPS
1. If 036000 is not applied yet, append transfers there; otherwise create 20261003036500_equipment_transfers.sql.
2. Write 037000 per §10.7 (incidents, maintenance, cron function).
3. Both-confirmations completion inside one row lock; order-independent.
4. Escalation levels: borrower → +2h custodians → +24h NW admins (mandatory kind).
5. Add the two new kinds to notificationKinds.js and the SQL mandatory list where specified.

MIGRATION FILE
platform/supabase/migrations/20261003037000_equipment_incidents_maintenance_stocktake.sql (+ transfers in 036000 or 036500) + platform/supabase/sql/schedule_equipment_cron.sql

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- Transfer A→B produces 4 ledger events, closes A's loan as transferred and opens B's.
- Timeouts revert correctly (12 h accept, 6 h handover).
- Stolen requires CAS or pending with 48 h reminders; unit greys out with last holder + reason; open loan frozen.
- Write-off ≥ R2 000 needs a second approver; liability only by NW admin; no charges created.
- Overdue escalation reaches NW admins after 24 h.

TESTS / MANUAL CHECKS TO RUN
- Staging: run flows C, E, F; call select public.run_equipment_housekeeping() manually with backdated rows.
- npm run lint && npm run build.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

## 15. P3d — Equipment dashboards, stocktake, exports, offline queue

**Depends on:** P3c · **Migration:** `platform/supabase/migrations/20261003038000_equipment_reporting.sql`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: P3d — Equipment dashboards, stocktake, exports, offline queue.

GOAL
Custodian dashboard (who holds what, overdue, utilisation, loss rate), year-end stocktake mode, ledger exports (CSV/XLSX/PDF), ledger verification, and offline-tolerant actions on Android.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§10.3 flow G, §10.7 stocktake/dashboard/export RPCs, §10.11, §10.13–10.15)
- @platform/web/src/chat/hooks/useNetworkStatus.js
- @platform/web/src/chat/components/OfflineBanner.jsx
- @platform/web/package.json (exceljs, html2pdf.js, recharts, @capacitor/preferences)
- @platform/supabase/migrations/20260820050000_chat_messages_client_message_id.sql (idempotency pattern)

SCOPE
SQL: stocktake RPCs (start, count by unit or QR, holder 'still have it', finalise with missing→lost), equipment_dashboard, export_equipment_ledger, verify_equipment_ledger, record_paper_handover. Web: /equipment/admin dashboard (recharts), /equipment/admin/stocktake scan loop, exports, utils/equipmentOfflineQueue.js (Preferences queue with client_event_id, flush on reconnect, 'Needs attention' list), react-query persistence for catalogue/my gear. New package: @capacitor-mlkit/barcode-scanning (v8.x) + hooks/useQrScanner.js with BarcodeDetector fallback and manual entry.

STEPS
1. Create 20261003038000_equipment_reporting.sql for the reporting/stocktake RPCs.
2. Offline queue covers: start return, report incident (photos cached), confirm handover giver, stocktake counts; NOT code confirmations.
3. Clamp occurred_at to [now−72h, now+5min] server-side.
4. Android: add CAMERA permission notes; run npx cap sync in instructions (don't run it yourself if it modifies native projects without asking).

MIGRATION FILE
platform/supabase/migrations/20261003038000_equipment_reporting.sql

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- Stocktake finalises with a summary and creates lost incidents for missing units on request.
- Exports row count equals ledger rows for the period; PDF renders.
- verify_equipment_ledger returns ok on staging.
- Airplane-mode incident report syncs exactly once on reconnect.

TESTS / MANUAL CHECKS TO RUN
- Staging + Android device: scan QR, go offline, report incident, reconnect.
- npm run lint && npm run build.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

## 16. P4a — Local services: taxonomy, listings, search

**Depends on:** P1 · **Migration:** `platform/supabase/migrations/20261003040000_local_services_taxonomy.sql + 20261003041000_local_services_listings_search.sql`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: P4a — Local services: taxonomy, listings, search.

GOAL
Add a Local services tab in Contacts where residents list trades/businesses and anyone in the neighbourhood can search with synonyms, full-text and fuzzy matching.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§9.1–9.6, D13, D14)
- @platform/web/src/pages/EmergencyContacts.jsx
- @platform/web/src/utils/emergencyDirectory.js
- @platform/web/src/App.jsx

SCOPE
SQL: categories + synonyms (seed incl. Afrikaans/isiXhosa terms), listings (org-scoped, pending for unverified), search_local_services RPC (FTS + pg_trgm + synonyms, limit ≤ 50). Web: tabs on the contacts page (?tab=services), listing form, my listings, photos under community-media/{org}/services/…. OUT: reviews (P4b).

STEPS
1. Write 040000 and 041000 per §9.5–9.6.
2. Tabs without breaking the three existing contacts routes.
3. Extend the P1 move trigger to pause listings when a resident moves org.

MIGRATION FILE
platform/supabase/migrations/20261003040000_local_services_taxonomy.sql + 20261003041000_local_services_listings_search.sql

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- 'sparky', 'loodgieter', typos find the right listings; Org B never sees Org A listings.
- Unverified listing stays pending until approved.

TESTS / MANUAL CHECKS TO RUN
- Staging search tests from §9.12.
- npm run lint.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

## 17. P4b — Local services: reviews, reports, moderation

**Depends on:** P4a · **Migration:** `platform/supabase/migrations/20261003042000_local_services_reviews.sql`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: P4b — Local services: reviews, reports, moderation.

GOAL
Verified neighbours rate and review listings; reports go to resident moderators; hidden content updates aggregates.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§9.7–9.12)
- @platform/web/src/pages/EmergencyContacts.jsx

SCOPE
SQL: reviews table, upsert_service_review (verified only, not own listing, one per resident), aggregates trigger, hide RPCs, extend report_community_content with listing/review branches. Web: review UI, report buttons, moderator filters on /resident/moderate and /admin/contacts?tab=services.

STEPS
1. Write 042000 per §9.7.
2. Re-create report_community_content from its latest definition adding the new branches only.

MIGRATION FILE
platform/supabase/migrations/20261003042000_local_services_reviews.sql

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- All §9.12 acceptance items pass.

TESTS / MANUAL CHECKS TO RUN
- Staging walkthrough.
- npm run lint.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

## 18. P5 — Outage notices + daily digest

**Depends on:** P1, G6 · **Migration:** `platform/supabase/migrations/20261003060000_area_broadcast_categories.sql, 20261003062000_daily_digest.sql`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: P5 — Outage notices + daily digest.

GOAL
Structured outage/service notices (power, water, roads) and an opt-in daily digest built on G6 preferences.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§11.1, §11.3)
- @platform/web/src/pages/AreaBroadcast.jsx
- @platform/web/src/utils/areaBroadcasts.js
- @platform/web/src/pages/ResidentDashboard.jsx

SCOPE
SQL: area_broadcasts.category + structured fields (affected area, start/end), digest function + cron SQL. Web: category picker + chips, digest toggle in Notifications prefs.

STEPS
1. One migration per sub-feature (060000, 062000).
2. Keep broadcasts backwards compatible (category default 'general').

MIGRATION FILE
platform/supabase/migrations/20261003060000_area_broadcast_categories.sql, 20261003062000_daily_digest.sql

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- Old notices still render; new ones show category.
- Digest respects prefs and quiet hours and includes new needs-board items.

TESTS / MANUAL CHECKS TO RUN
- Staging checks per sub-feature.
- npm run lint.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

## 19. P6a — Community events & RSVP

**Depends on:** P0b · **Migration:** `platform/supabase/migrations/20261003070000_community_events.sql`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: P6a — Community events & RSVP.

GOAL
Staff and resident moderators create events (AGM, clean-ups, socials) with RSVP, reminders and minutes.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§11.4, D15)
- @platform/web/src/App.jsx
- @platform/web/src/pages/ResidentDashboard.jsx

SCOPE
SQL: community_events + rsvps (org-scoped, RPC writes), reminder via housekeeping/cron. Web: events list/detail/RSVP, create/edit for staff + moderators, conditional home tile.

STEPS
1. Write 070000 per §11.4 using the P0/P1 helpers.

MIGRATION FILE
platform/supabase/migrations/20261003070000_community_events.sql

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- Only staff + moderators create; RSVP once per user; org isolation holds.

TESTS / MANUAL CHECKS TO RUN
- Staging walkthrough.
- npm run lint.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

## 20. P6b — Polls + lost & found / pets

**Depends on:** P0b · **Migration:** `platform/supabase/migrations/20261003071000_polls.sql + 20261003072000_lost_and_found.sql`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: P6b — Polls + lost & found / pets.

GOAL
Verified-household polls/committee votes and a photo-led lost & found / pets board with moderation.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§11.5, §11.6)
- @platform/web/src/App.jsx

SCOPE
SQL: polls + options + votes (one vote per verified household, results visibility rules), lost_found_posts (no exact coordinates, auto-expire, report branch). Web: polls page, lost & found board, report buttons.

STEPS
1. Two migrations (071000, 072000).
2. Extend report_community_content with the lost & found branch.

MIGRATION FILE
platform/supabase/migrations/20261003071000_polls.sql + 20261003072000_lost_and_found.sql

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- One vote per household; results hidden until close if configured.
- Lost & found posts expire and can be reported/hidden.

TESTS / MANUAL CHECKS TO RUN
- Staging walkthrough.
- npm run lint.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

## 21. P7 — Onboarding checklist, volunteer tasks, camera footage requests

**Depends on:** P0b · **Migration:** `platform/supabase/migrations/20261003090000_onboarding_checklist.sql, 20261003091000_volunteer_tasks.sql, 20261003092000_camera_footage_requests.sql`

````text
You are working in the Watchman repo (React 19 + Vite + Capacitor 8 web app in platform/web, Supabase backend in platform/supabase). Task: P7 — Onboarding checklist, volunteer tasks, camera footage requests.

GOAL
New-resident onboarding checklist, non-patrol volunteer task sign-up, and a private camera registry with footage requests.

READ FIRST (context)
- @platform/docs/NEW_FEATURES_BLUEPRINT.md (§11.7–11.9)
- @platform/web/src/pages/ResidentDashboard.jsx
- @platform/web/src/pages/Profile.jsx

SCOPE
SQL: onboarding progress, volunteer tasks + signups, private cameras (approximate location only) + footage requests with consent and expiry. Web: checklist card, tasks page, camera registry + request flow.

STEPS
1. Three migrations (090000, 091000, 092000), one sub-feature each; you may split into three PRs if the diff is large.

MIGRATION FILE
platform/supabase/migrations/20261003090000_onboarding_checklist.sql, 20261003091000_volunteer_tasks.sql, 20261003092000_camera_footage_requests.sql

CONSTRAINTS (apply to everything you write):
- Follow existing patterns in the files above: text + CHECK (no enums), SECURITY DEFINER + SET search_path = public, role normalisation replace(lower(trim(role::text)),'-','_'), DROP POLICY IF EXISTS before CREATE POLICY, SAST via timezone('Africa/Johannesburg', now()). React: lazy pages in App.jsx, PageHeader + homeBackNav(), existing Tailwind card classes, isRpcNotFoundError fallbacks ("Run the … SQL in Supabase first").
- Grant convention: every new/replaced function → REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; client RPCs → GRANT EXECUTE … TO authenticated, service_role; internal/trigger/cron helpers → service_role only. Tables written via RPCs → REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated.
- Org isolation: derive organization_id from the row being acted on, check IN (SELECT public.current_org_ids()); cross-org failures raise 'not found' (never 'forbidden').
- Before replacing any existing function or policy, rg for its LATEST definition across platform/supabase/migrations and copy that body; change only what this prompt describes. Never edit an applied migration; create the new file named below (adjust the date prefix to today, keep the order, never reuse a timestamp).
- Don't break Theescombe: existing routes/roles/data keep working; new columns nullable or defaulted; UI degrades gracefully before the SQL is applied.
- No new npm packages unless named here. No unrelated refactors. Do NOT touch platform/web/src/pages/Dashboard.jsx or platform/supabase/migrations/20260827010000_end_patrol_idempotent.sql.
- Do not run SQL against any Supabase project, do not commit, do not push.
- STOP AND SHOW ME THE DIFF BEFORE COMMITTING. End with: files changed, SQL to apply (staging first), manual test steps, and anything you could not verify.

ACCEPTANCE CRITERIA
- Each sub-feature works independently and passes the isolation script additions.

TESTS / MANUAL CHECKS TO RUN
- Staging walkthroughs.
- npm run lint.
- Add/extend the matching assertions in platform/supabase/sql/isolation_tests_community.sql (if it exists).

When done: STOP AND SHOW ME THE DIFF BEFORE COMMITTING. Do not commit, push or apply SQL.
````

---

*End of prompt pack. Tick each box in the progress checklist when its PR is merged and its SQL is applied on production.*
