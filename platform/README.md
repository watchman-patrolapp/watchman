# Watchman platform (application source)

This folder holds everything that ships as the product:

| Path | Purpose |
|------|--------|
| `web/` | Vite + React PWA (`npm run dev` / `npm run build`). Capacitor config lives here; `webDir` is `dist`. |
| `android/` | **Capacitor Android project** (native shell, bundled web assets, plugins). Built with Gradle from this folder; `capacitor.config.json` in `web/` sets `"android": { "path": "../android" }`. |
| `supabase/` | Database migrations, Edge Functions, and Supabase project config. |
| `docs/` | Privacy, user guides, operational runbooks, and [`SCALE_ROADMAP.md`](docs/SCALE_ROADMAP.md) (where we are / pending / next). |
| `scripts/` | Maintenance scripts, including `check-migration-versions.mjs` (duplicate migration versions). |

**Vercel:** set the project **Root Directory** to `platform/web` (not the repository root).

**Android debug APK:** from `platform/web`, run `npm run android:sync` then `npm run android:apk:debug` (or open `platform/android` in Android Studio). On macOS or Linux the Gradle wrapper is `npm run android:apk:debug:unix`.

`applicationId` is `com.watchman.app`. Do not change it. `versionCode` / `versionName` default to **6** / **1.0.5** from [`android/version.properties`](android/version.properties). Override for one build with `-Pwatchman.versionCode` / `-Pwatchman.versionName` or `WATCHMAN_VERSION_CODE` / `WATCHMAN_VERSION_NAME` (flags, then env, then the file). Bump the file with:

```bash
node platform/android/scripts/bump-version.mjs --bump-code --name 1.0.6
# or set both explicitly
node platform/android/scripts/bump-version.mjs --code 7 --name 1.0.6
```

Play needs a higher `versionCode` on every upload. Confirm the printed values with `cd platform/android && ./gradlew printWatchmanVersion`.

### Android release signing

Release builds are minified (`minifyEnabled`, `shrinkResources`) and must be signed with the upload key. The debug keystore is not used. No keystore, `keystore.properties`, or `google-services.json` belongs in git.

1. Create the upload key **outside the repo** (passwords go in a password manager). Enroll the app in Play App Signing; this keystore is the upload key, and Google holds the app signing key.

   ```bash
   mkdir -p "$HOME/keys"
   keytool -genkeypair -v \
     -keystore "$HOME/keys/watchman-upload.jks" \
     -alias watchman-upload \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Point Gradle at it. Either copy [`android/keystore.properties.example`](android/keystore.properties.example) to `platform/android/keystore.properties` (gitignored) and fill `storeFile`, `storePassword`, `keyAlias`, `keyPassword`, or export the same values as `WATCHMAN_UPLOAD_STORE_FILE`, `WATCHMAN_UPLOAD_STORE_PASSWORD`, `WATCHMAN_UPLOAD_KEY_ALIAS`, and `WATCHMAN_UPLOAD_KEY_PASSWORD`. A non-blank properties entry overrides the matching env var. `storeFile` may be absolute or relative to `platform/android/`.

3. Build the signed Play App Bundle from `platform/android`:

   ```bash
   ./gradlew bundleRelease
   ```

   Windows: `gradlew.bat bundleRelease`. From `platform/web`: `npm run android:bundle:release:unix` (or `android:bundle:release` on Windows). The AAB is `platform/android/app/build/outputs/bundle/release/app-release.aab`. `assembleRelease` / `bundleRelease` fail immediately, naming the missing key, when signing is not configured.

`google-services.json` stays gitignored. Copy [`android/app/google-services.json.example`](android/app/google-services.json.example) (`package_name` `com.watchman.app`) only on a machine that should receive FCM. Without that file the Google Services plugin is not applied.

Cleartext HTTP is off (`usesCleartextTraffic` and `network_security_config`). `allowBackup` is false, so Auto Backup does not export shared preferences or WebView storage. WebView remote debugging is on only when the build is debuggable. `cap sync` writes `res/xml/config.xml` with no Cordova `<access origin="*">` (`cordova.accessOrigins` is `[]` in `web/capacitor.config.json`). Nothing in this app reads that whitelist; Capacitor does not use it for the WebView.

Background tracking during a signed-on patrol is implemented for Android. See [`docs/ANDROID_BACKGROUND_TRACKING.md`](docs/ANDROID_BACKGROUND_TRACKING.md) and the Play Console text in [`docs/PLAY_BACKGROUND_LOCATION.md`](docs/PLAY_BACKGROUND_LOCATION.md). Web stays foreground-only.

**Release smoke test** (no device in CI): `./gradlew assembleRelease` with the upload key set. Then confirm `app/build/outputs/apk/release/app-release.apk` is signed, `application-debuggable` is absent, `versionCode` is 6 and `versionName` is `1.0.5` unless you overrode them, and `android.permission.ACCESS_BACKGROUND_LOCATION` is present (used only during a signed-on patrol):

```bash
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
aapt dump badging app/build/outputs/apk/release/app-release.apk | head
```

On a phone: install that APK, sign in, start a patrol, confirm the map still follows you, then put the app in the background and confirm a release build does not show a WebView debug socket (`chrome://inspect` stays empty).


**Supabase CLI:** run commands from `platform/supabase`. `config.toml` is the local stack. Do not `supabase config push` it to production. Layout:

| Path | Purpose |
|------|---------|
| `supabase/migrations/` | Applied history. Do not edit a file that may already be on production. New work is a new timestamped file. |
| `supabase/tests/` | Isolation scripts (`isolation_tests_community.sql`, `isolation_tests_intelligence.sql`). Not migrations. |
| `supabase/archive/` | Old SQL Editor scripts. Not migrations. Do not re-run them to "fix" drift. |
| `supabase/seed.sql` | Local `db reset` only. Sample security companies stay in migration `20260815059000`. |

`npm run check:migrations` (repo root) fails when a new migration reuses a version prefix. Four historical pairs are allowlisted. See [`docs/SQL_CONVENTIONS.md`](docs/SQL_CONVENTIONS.md) and [`docs/MIGRATION_VERSION_REPAIR.md`](docs/MIGRATION_VERSION_REPAIR.md). Storage URL follow-up: [`docs/STORAGE_PRIVACY_PLAN.md`](docs/STORAGE_PRIVACY_PLAN.md).

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
