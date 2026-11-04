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

`npm run build` runs the `prebuild` hook (`check-sound-assets`, `generate-firebase-messaging-sw`) before `vite build`. Vercel uses the same path via `vercel.json` (`installCommand`: `npm ci`, `buildCommand`: `npm run build`).

On Vercel, set all `VITE_FIREBASE_*` variables listed in `.env.example` so the build generates `dist/firebase-messaging-sw.js` for web push.

**Production on Vercel** intentionally skips `vite-plugin-pwa` (no Workbox precache / generated manifest there). The app is **online-first**; FCM uses `/firebase-messaging-sw.js` only. Non-Vercel production builds (e.g. `npm run build && npm run preview`) still enable the PWA plugin locally.

## Deploy

Prefer git push + Vercel Git integration. Optional CLI helpers: `./deploy.sh` / `deploy.bat` (run from this directory after `vercel link`).

See also `AGENTS.md` in this folder for deployment checklists and env var names.
