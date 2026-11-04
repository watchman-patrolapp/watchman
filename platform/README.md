# Watchman platform (application source)

This folder holds everything that ships as the product:

| Path | Purpose |
|------|--------|
| `web/` | Vite + React PWA (`npm run dev` / `npm run build`). Capacitor config lives here; `webDir` is `dist`. |
| `android/` | **Capacitor Android project** (native shell, bundled web assets, plugins). Built with Gradle from this folder; `capacitor.config.json` in `web/` sets `"android": { "path": "../android" }`. |
| `supabase/` | Database migrations, Edge Functions, and Supabase project config. |
| `docs/` | Privacy, user guides, operational runbooks, and [`SCALE_ROADMAP.md`](docs/SCALE_ROADMAP.md) (where we are / pending / next). |
| `scripts/` | Small maintenance scripts (e.g. scheduled location cleanup helper). |

**Vercel:** set the project **Root Directory** to `platform/web` (not the repository root).

**Android APK:** from `platform/web`, run `npm run android:sync` then `npm run android:apk:debug` (or open `platform/android` in Android Studio).

**Supabase CLI:** run commands from the repo root or `platform/supabase` as you did before; config paths are under `platform/supabase`.

## Edge Function secrets

Set these in the Supabase project (Dashboard → Edge Functions → Secrets, or CLI). Project ref: `pfjcxewlsqmfajrogvdo`.

```bash
# Cron-only functions (auto-end-patrols, location-cleanup)
npx supabase secrets set CRON_SECRET="<long-random>" --project-ref pfjcxewlsqmfajrogvdo

# Database webhook notify functions
npx supabase secrets set CHAT_NOTIFY_WEBHOOK_SECRET="<long-random>" --project-ref pfjcxewlsqmfajrogvdo
npx supabase secrets set INCIDENT_STATUS_WEBHOOK_SECRET="<long-random>" --project-ref pfjcxewlsqmfajrogvdo

# FCM (already required by notify-*)
# FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY
```

Also add the same values where callers live:

| Secret | Where else |
|--------|------------|
| `CRON_SECRET` | GitHub Actions repo secret (workflow `.github/workflows/daily-cleanup.yml` sends header `x-cron-secret`). Local test: `platform/scripts/test-location-cleanup.ps1`. |
| `CHAT_NOTIFY_WEBHOOK_SECRET` | Database Webhook HTTP header `x-chat-notify-secret`. |
| `INCIDENT_STATUS_WEBHOOK_SECRET` | Database Webhook HTTP header `x-incident-status-secret`. |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | GitHub Actions secrets for the cleanup workflow (anon key is gateway `apikey` only — never put the service role key in the workflow). |

`SUPABASE_SERVICE_ROLE_KEY` (or legacy `SERVICE_ROLE_KEY`) is injected into edge functions by Supabase; do not put it in GitHub Actions.
