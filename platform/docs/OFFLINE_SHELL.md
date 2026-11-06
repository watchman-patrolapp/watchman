# Offline shell

When the phone has no signal, Watchman still opens. The person sees the app shell, a clear offline banner, and the last saved copy of the screens they use on a shift. Those copies are read-only. Patrol points and equipment actions that already queue keep sending later. Every other save says **You’re offline, try again when connected.** Raw database and network errors stay off the screen.

This covers the web app on Vercel and the Capacitor Android shell. It does not add a new service-worker cache of Supabase data.

## What the person sees

The banner from the design system stays as it is: “You’re offline. Some actions will wait until you reconnect.” It lives in `platform/web/src/components/layout/OfflineBanner.jsx` and is mounted once in `App.jsx`.

These screens keep a last-good copy:

| Screen | Cache name | What is saved |
| --- | --- | --- |
| Dashboard counts | `dashboard` | Pending incident and feedback counts |
| Your patrol and who else is out | `patrol-status` | Your active patrol, and the on-duty list |
| Incident list | `incidents` | The loaded approved page |
| Equipment catalogue | `equipment` | Catalogue cards |
| City Hub feed | `city-hub` | The latest posts |

A cached screen shows **Last updated** with a time (just now, minutes ago, or the clock in Africa/Johannesburg). Fresh data hides that line.

The first visit with no signal, before anything has been saved, cannot invent a feed. The screen says to try again when connected. After one successful visit, the next offline open uses the saved copy.

## App shell

### Web (Vercel)

`vite-plugin-pwa` runs for every web build, including `VERCEL=1`. It stays off for `vite build --mode capacitor` and for the Vite dev server.

Workbox precaches the built shell and the hashed assets (`js`, `css`, fonts, icons, `offline.html`, `index.html`). Client-side routes (`/dashboard`, `/incidents`, `/equipment`, `/city-hub`, and the rest) are navigations. If the network is down they are served from that precached `index.html`, and React Router draws the screen.

`/sw.js` is `Cache-Control: no-cache` in `vercel.json`. A new deploy changes that file. The worker uses `skipWaiting`, `clientsClaim`, and `cleanupOutdatedCaches`. `public/registerSW.js` is the script the built page loads (Vite 8 drops the plugin’s own copy of that file). It reloads the open tab only when a new worker replaces one that was already in control, so the first install does not refresh twice. While the device is offline the update check fails and the installed shell stays. That decision is `shellUpdateAction` in `src/offline/policy.js`: same revision means current, a new revision while offline means keep the installed shell, a new revision while online means activate and reload.

Dev (`localhost:5173`) still runs `public/dev-sw-reset.js`, which drops stale workers so HMR is not stuck on an old shell. Preview and production keep the worker.

### Android (Capacitor)

The Android app loads the built files from the device (`vite build --mode capacitor`, base `./`). There is no service worker in that build. The shell is the packaged files, so airplane mode still opens the UI. The same read cache, banner, and write guard run in the WebView. Cached screens are also mirrored into Capacitor Preferences.

Do not ship an APK from this change. Install a build that includes this web bundle, then follow the test steps below.

## What is not cached by the service worker

The service worker only precaches same-origin build files. It has no runtime route for Supabase.

`serviceWorkerMayCache` refuses:

- anything on `supabase.co` (REST, RPC, realtime)
- `/auth/v1/` (session, refresh, logout)
- storage sign URLs (`/storage/v1/object/sign/` and any storage URL that carries a `token`)

Signed photo URLs already live in memory for about an hour (`src/utils/privateMedia.js`, `src/utils/criminalPhotos.js`) and are dropped when they expire. The screen cache redacts them again on save and on read. A token with no readable expiry is dropped. `access_token`, `refresh_token`, and passwords are never written. Sign-out clears both memory maps.

Map tiles are left to the browser. They are not part of this shell.

## Read cache

Storage key: `wm-offline-shell-v{version}:{userId}:{organizationId}:{screen}`.

Version is `OFFLINE_CACHE_VERSION` (currently 1). On startup, keys from any other version are deleted (`purgeStaleOfflineCache`).

The neighbourhood id is part of the key. Switching area reads that area’s copy and does not show the previous area’s incidents, gear, patrol list, or City Hub posts. Profile and the area list use the scope `account`, because they belong to the person, not to one neighbourhood.

On sign-out (`clearOfflineSession`):

- every screen key for that user id is removed, including every neighbourhood and the profile
- unsent patrol points for that user are removed from `watchman_patrol_location_queue_v1`
- the equipment offline queue and its read cache are removed, because those keys are not split by user and must not flush as the next person
- in-memory signed media URLs are cleared

The profile row is saved when `public.users` loads. If the next open has no signal, that saved role opens the shell instead of the full-screen “you are offline” access wall. Coming back online fetches the profile again. A person with no saved profile still sees the access recovery screen.

Incident pages are large. The cache strips evidence media first, then evidence and section notes, so a page still fits on device. The list of reports remains.

## Writes

`src/supabase/client.js` sends Supabase HTTP through `offlineAwareFetch`.

| Call | Offline behaviour |
| --- | --- |
| `/auth/v1/` | Left alone. A failure is not replaced, so a token refresh is not turned into a fake success. |
| Signed media URL creation | Not cached. Offline, the person gets the friendly write message. |
| `POST /rest/v1/patrol_locations` | Left alone. `src/geo/patrolLocationSync.js` already queues the point and flushes it on `online` (and when the Android app resumes). Android uploads with Capacitor HTTP, which does not use this wrapper. |
| Equipment RPCs that already queue (`request_equipment_return`, `report_equipment_issue`, `confirm_equipment_handover_giver`, `count_equipment_unit`, `confirm_equipment_still_held`, `submit_equipment_paper_claim`) | Left alone. `runEquipmentAction` stores them when `navigator.onLine` is false. |
| Any other insert, update, delete, or RPC | Not sent. The caller receives “You’re offline, try again when connected.” |

A read that fails in transit becomes “Couldn’t refresh just now…” or the offline sentence, never `Failed to fetch` or a Postgres body. Screens that already have a saved copy show that copy instead of an error card.

Check-in and check-out are normal writes. They do not join the patrol-point queue. Offline, the toast is the friendly sentence.

## Service workers side by side

Two workers, two scopes:

| Worker | URL | Scope | Job |
| --- | --- | --- | --- |
| App shell | `/sw.js` | `/` | Precache and navigation fallback |
| Web push | `/firebase-messaging-sw.js` | `/firebase-cloud-messaging-push-scope` | Firebase background messages only |

A service worker script at the site root may use a narrower scope. Push uses that narrow scope, so it does not become the page controller and does not replace the shell. `getToken` is given that registration (`src/chat/services/fcmRegistration.js`).

On load, a Firebase worker that is still registered at `/` is unregistered and registered again on the push scope. `/sw.js` is not unregistered. The old hand-written `/sw.js` from the earlier migration is the same URL as the shell worker, so the browser updates it in place when the file changes. Dev still deletes workers on port 5173.

Android does not register either worker. Native push is the Capacitor plugin.

## Manual checks

### Web

1. Sign in, open Dashboard, Incidents, Equipment, and City Hub once while online.
2. DevTools → Network → Offline (or the OS airplane mode). Reload.
3. The shell opens. The amber banner is visible. Each of those screens shows its last copy and a Last updated line. No red error with a status code or `Failed to fetch`.
4. Start a save that is not a queued one (City Hub publish, patrol check-in). The toast is “You’re offline, try again when connected.”
5. With a patrol already active, confirm a new point does not throw. It stays in the patrol location queue and leaves after you go back online.
6. Sign out while offline. Sign in as someone else (or the same person after a refresh). The previous person’s incidents, patrol list, and gear are gone.
7. As a platform operator, switch neighbourhood while offline. The lists follow the selected area’s own saved copy, or they are empty if that area was never opened. They do not keep the previous area’s rows.
8. Go online. Deploy a new build (or `npm run build && npm run preview` and reload). The tab picks up the new shell without staying on the old hashed files. Offline, an older preview stays on the shell it already installed.

### Android

1. Install a debug build that contains this web bundle. Do not treat an old APK as a test of this change.
2. Sign in and open the same four screens plus the patrol card once on a network.
3. Turn on airplane mode. Kill the app. Open it again.
4. The packaged shell opens. The banner shows. The saved screens are readable and labelled with Last updated. Writes that are not the patrol-point queue or the equipment queue show the offline sentence.
5. Start a patrol while online, then enable airplane mode and walk. Points queue. Disable airplane mode and leave the app open. The queue drains. Sign out in airplane mode and confirm the next account does not upload the previous account’s points.
