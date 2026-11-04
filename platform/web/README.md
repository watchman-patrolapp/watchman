# Neighbourhood Watch — Web app (`platform/web`)

Vite + React SPA deployed on **Vercel** with **Root Directory** = `platform/web`.

## Node.js

- **Local:** use Node **20 LTS** (`nvm use` reads `.nvmrc`, currently `20.18.3`).
- **CI / Vercel:** `package.json` `engines.node` is `>=20` (matches Vercel’s Node 20 runtime).

## Install and build

```bash
npm ci
npm run build
```

`npm run build` runs the `prebuild` hook (`check-no-secrets-in-env`, `check-sound-assets`, `generate-firebase-messaging-sw`, `check-asset-budget`) before `vite build`. Vercel uses the same path via `vercel.json` (`installCommand`: `npm ci`, `buildCommand`: `npm run build`).

On Vercel, set all `VITE_FIREBASE_*` variables listed in `.env.example` so the build generates `dist/firebase-messaging-sw.js` for web push.

**Production on Vercel** intentionally skips `vite-plugin-pwa` (no Workbox precache / generated manifest there). The app is **online-first**; FCM uses `/firebase-messaging-sw.js` only. Non-Vercel production builds (e.g. `npm run build && npm run preview`) still enable the PWA plugin locally.

## Deploy

Prefer git push + Vercel Git integration. Optional CLI helpers: `./deploy.sh` / `deploy.bat` (run from this directory after `vercel link`).

See also `AGENTS.md` in this folder for deployment checklists and env var names.

## Known peer-dependency issues

`platform/web/.npmrc` sets `legacy-peer-deps=true`. Removing that setting and running `npm install` fails with `ERESOLVE` and does not update `package-lock.json`. npm stops on the first conflict:

- `eslint-plugin-react-hooks@7.0.1` declares `peer eslint@"^3.0.0 || ^4.0.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0-0 || ^9.0.0"`. The app depends on `eslint@^10.1.0` (locked at `10.1.0`). npm's suggested conflicting peer was `eslint@9.39.5`.

The lockfile records a second required peer mismatch. npm did not print it because resolution stopped on the eslint plugin:

- `vite-plugin-pwa@0.19.8` declares `peer vite@"^3.1.0 || ^4.0.0 || ^5.0.0"`. The app depends on `vite@^8.0.3` (locked at `8.0.3`).

`legacy-peer-deps=true` stays in place so `npm ci` can install this tree.
