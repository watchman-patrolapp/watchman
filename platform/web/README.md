# Neighbourhood Watch — Web app (`platform/web`)

Vite + React SPA deployed on **Vercel** with **Root Directory** = `platform/web`.

## Node.js

- **Local / CI:** Node **22 LTS**. `.nvmrc` is `22.23.4` (`nvm use`). GitHub Actions reads that file via `actions/setup-node`.
- **Vercel:** `package.json` `engines.node` is `22.x`, so the Vite build stays on a Node release Vite supports (20.19+ or 22.12+). Node 20.18 is too old for the rolldown binding Vite 8 ships.

## Security headers

`vercel.json` sends HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and `X-Frame-Options: DENY` on every response. `Content-Security-Policy-Report-Only` covers the app origin plus Supabase (https and wss), Firebase/Google APIs, Sentry, OpenStreetMap tiles, CARTO, ArcGIS imagery, Nominatim, Photon, and Open-Meteo. Images may also be `blob:` or `data:`.

Hashed `/assets/*`, `/fonts/*`, `/sounds/*`, and `/icons/*` are cached for one year, immutable. `no-cache` is limited to `/`, `/index.html`, service workers, the web manifest, and extensionless app routes (those rewrite to the HTML shell).

Promote the policy from report-only to enforcing after about a week of clean reports:

1. In the browser console (or a report endpoint, if you add one), confirm there are no unexpected `Content-Security-Policy-Report-Only` violations on login, patrol map, incident photos, chat, and SOS.
2. In `platform/web/vercel.json`, rename the header key `Content-Security-Policy-Report-Only` to `Content-Security-Policy`. Leave the value as it is unless a report showed a host that still needs to be allowed.
3. Redeploy and recheck those same flows. `frame-ancestors 'none'` and `X-Frame-Options: DENY` both stay.

## Install and build

```bash
npm ci
npm run build
```

`npm run build` runs the `prebuild` hook (`check-no-secrets-in-env`, `check-sound-assets`, `generate-firebase-messaging-sw`, `check-asset-budget`) before `vite build`. Vercel uses the same path via `vercel.json` (`installCommand`: `npm ci`, `buildCommand`: `npm run build`).

On Vercel, set all `VITE_FIREBASE_*` variables listed in `.env.example` so the build generates `dist/firebase-messaging-sw.js` for web push.

**Production builds, including Vercel, run `vite-plugin-pwa`** (Workbox precache of the app shell, served as `/sw.js`). Only `vite build --mode capacitor` (the Android bundle) turns it off. The shell opens with no signal; see [`../docs/OFFLINE_SHELL.md`](../docs/OFFLINE_SHELL.md). The two export libraries (`exceljs`, `html2pdf`) are not precached; they are cached the first time an export runs. FCM uses `/firebase-messaging-sw.js` separately. Test the PWA locally with `npm run build && npm run preview`.

## Deploy

Prefer git push + Vercel Git integration. Optional CLI helpers: `./deploy.sh` / `deploy.bat` (run from this directory after `vercel link`).

See also `AGENTS.md` in this folder for deployment checklists and env var names.

## Known peer-dependency issues

`platform/web/.npmrc` sets `legacy-peer-deps=true`. Removing that setting and running `npm install` fails with `ERESOLVE` and does not update `package-lock.json`. npm stops on the first conflict:

- `eslint-plugin-react-hooks@7.0.1` declares `peer eslint@"^3.0.0 || ^4.0.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0-0 || ^9.0.0"`. The app depends on `eslint@^10.1.0` (locked at `10.1.0`). npm's suggested conflicting peer was `eslint@9.39.5`.

The lockfile records a second required peer mismatch. npm did not print it because resolution stopped on the eslint plugin:

- `vite-plugin-pwa@0.19.8` declares `peer vite@"^3.1.0 || ^4.0.0 || ^5.0.0"`. The app depends on `vite@^8.0.3` (locked at `8.0.3`).

`legacy-peer-deps=true` stays in place so `npm ci` can install this tree.
