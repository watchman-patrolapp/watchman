# Watchman platform (application source)

This folder holds everything that ships as the product:

| Path | Purpose |
|------|--------|
| `web/` | Vite + React PWA (`npm run dev` / `npm run build`). Capacitor config lives here; `webDir` is `dist`. |
| `android/` | **Capacitor Android project** (native shell, bundled web assets, plugins). Built with Gradle from this folder; `capacitor.config.json` in `web/` sets `"android": { "path": "../android" }`. |
| `supabase/` | Database migrations, Edge Functions, and Supabase project config. |
| `docs/` | Privacy, user guides, and operational runbooks. |
| `scripts/` | Small maintenance scripts (e.g. scheduled location cleanup helper). |

**Vercel:** set the project **Root Directory** to `platform/web` (not the repository root).

**Android APK:** from `platform/web`, run `npm run android:sync` then `npm run android:apk:debug` (or open `platform/android` in Android Studio).

**Supabase CLI:** run commands from the repo root or `platform/supabase` as you did before; config paths are under `platform/supabase`.
