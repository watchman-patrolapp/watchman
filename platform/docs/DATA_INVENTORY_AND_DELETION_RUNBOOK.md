# Data inventory & deletion runbook (draft)

Internal document for **Kyzn / operators** and **legal counsel**. Update when the schema or subprocessors change. This is not legal advice.

## 1. Purpose

- Map where **personal information** lives (database, auth, storage, third parties).
- Record what **self-service** and **admin** deletion covers today.
- List **known gaps** to close with engineering + lawyer sign-off.

## 2. Hosting & processors (confirm in dashboards)

| System | Role | Region / notes | DPA |
|--------|------|----------------|-----|
| Supabase | DB, Auth, Storage, Edge Functions | Confirm: Dashboard → Project → **Ireland (eu-west-1)** or as configured | Supabase DPA |
| Vercel | Frontend | As per project | Vercel DPA |
| Resend | Transactional email | US | Resend DPA |
| Google FCM | Push | US | Google DPA |
| Stripe | Payments (when live) | Per Stripe | Stripe DPA |
| Sentry | Errors (when `VITE_SENTRY_DSN` set) | US/EU per project | Sentry DPA |

## 3. Data categories & locations

| Category | Primary location | Retention (policy target) | Notes |
|----------|------------------|---------------------------|--------|
| Account / identity | `auth.users`, `auth.users.raw_user_meta_data`, `public.users` | Until deletion + 90 days | Profile page edits `public.users` + metadata sync |
| Phone / address / name | Same + optional columns | Same | |
| Vehicles | `public.user_vehicles` | Removed on account delete | |
| Patrol activity | `active_patrols`, `patrol_locations`, `patrol_routes`, `patrol_logs`, `patrol_slots` | 90d locations (policy); cleanup job | |
| Emergency chat | `chat_messages`, reactions, read state | 24h volunteer view (expires_at); **180d hard delete** (admin log) | `run_chat_messages_retention_purge()` + optional pg_cron (see §8) |
| Incidents | `incidents` and related tables, storage buckets | 5 years (policy) | `submitted_by` nulled on user delete |
| Witness link | `incidents.witness_user_id` | SET NULL on user delete (FK) | |
| Criminal intelligence | `criminal_profiles` and linked tables | 1y + annual review (policy) | Profiles **created by** user deleted on self-service delete |
| Push tokens | `user_push_tokens` | CASCADE from `auth.users` delete | Also cleared on sign-out in app |
| Avatars | Storage bucket `avatars` | Orphan files may remain | **Gap:** no automated purge of object storage on delete |
| Incident media | Storage (e.g. incident photos) | Per incident retention | Not tied to user delete in code |
| Audit / logs | Supabase logs, Vercel logs, Sentry | Per vendor | |

## 4. Deletion mechanisms

### 4.1 Self-service (member)

- **UI:** Profile → **Delete account** (password re-check + confirmation).
- **Edge Function:** `delete-my-account` (deploy with Supabase CLI).
- **Steps:** Client calls `signInWithPassword` then `supabase.functions.invoke('delete-my-account', { body: { confirm: true } })`.
- **Covers:** Same table cleanup as admin path for the **current user**, plus `criminal_profiles` where `created_by` = that user’s id (text).
- **OAuth-only accounts:** No password → UI directs user to email `VITE_PRIVACY_CONTACT_EMAIL` (set in Vercel env).

### 4.2 Admin

- **Edge Function:** `admin-delete-user` (admin role only, cannot delete self).
- **UI:** User management (admin).

### 4.3 Manual / ticket

- Email requests when automation cannot verify identity or for partial erasure (e.g. remove name from an incident narrative). **Process:** [define SLA, verification, template reply].

## 5. Known gaps (review with lawyer)

1. **Storage:** Avatar and other uploads may remain in buckets after account deletion; define purge policy or periodic job.
2. **Incidents / evidence:** Submitting user unlinked; narrative text may still identify people — **correction** may require manual edit, not only delete account.
3. **Intelligence:** Profiles **not** created by the user but referencing them in free text are **not** removed by account deletion.
4. **Chat / admin logs:** SQL purge is in place (180 days); confirm **pg_cron** or another scheduler runs `run_chat_messages_retention_purge()` in production (see §8).
5. **Backups:** Supabase backups — document retention (e.g. 90d) and inability to erase a single user from cold backups.
6. **`created_by` type:** `criminal_profiles.created_by` is `text`; self-delete uses string match on auth uuid.

## 6. Deployment checklist (delete-my-account)

- [ ] `supabase functions deploy delete-my-account`
- [ ] `supabase/config.toml` includes `[functions.delete-my-account]` (verify_jwt false for CORS; JWT checked in code).
- [ ] Production: set `VITE_PRIVACY_CONTACT_EMAIL` on Vercel for OAuth users.

## 7. Post-deletion

- User receives success toast and is signed out; session cleared.
- Log deletion requests (optional `deletion_audit` table) if counsel requires proof of processing.

## 8. Automated retention & migrations (repo)

| Item | What was added |
|------|----------------|
| Chat 6-month purge | Migration `supabase/migrations/20260401141000_chat_messages_retention_purge.sql` defines `public.run_chat_messages_retention_purge()`. |
| Schedule chat purge | Run `supabase/sql/schedule_chat_retention_cron.sql` once in the **SQL Editor** after enabling **pg_cron** (Dashboard → Database → Extensions), or call the function from an external cron. |
| Patrol schema / RLS | Migration `20260401142000_patrol_locations_consolidated.sql` (canonical chain). Old copies under `web/supabase/migrations/*.sql` were **removed**; see `web/supabase/migrations/README.txt`. |
| `location-cleanup` Edge Function | If env **`CRON_SECRET`** is set, callers must send header **`x-cron-secret: <same value>`**. Register in `supabase/config.toml` as `[functions.location-cleanup]`. |

## 9. What you still do manually (operations / legal)

- **`supabase db push`** (or Dashboard SQL) on **production** to apply new migrations.
- **Chat:** Enable **pg_cron** and run `schedule_chat_retention_cron.sql`, *or* schedule `SELECT public.run_chat_messages_retention_purge();` another way.
- **`location-cleanup`:** Deploy `supabase functions deploy location-cleanup`, set **`CRON_SECRET`** in function secrets, add a **scheduled invocation** (Supabase **Scheduled Functions** / external cron) with the secret header.
- **Sentry:** Create project, set **`VITE_SENTRY_DSN`** on Vercel, sign DPA, list Sentry in the privacy policy.
- **Supabase region:** Screenshot **Dashboard → Infrastructure** for Ireland / your region (compliance file).
- **Legal:** Information Officer, lawyer review, publish privacy/terms URL, DPAs, POI annual review process, storage purge policy.

---

*Last updated: 2026-04-01 — align with `docs/PRIVACY_POLICY_AND_TERMS_OF_SERVICE.md`.*
