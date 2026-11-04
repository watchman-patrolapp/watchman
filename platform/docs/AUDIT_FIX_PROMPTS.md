# Build audit — fix plan and Cursor prompts (Nov 2026)

How to use: open a **new Cursor chat per prompt**, paste the block, let the agent finish, review the diff, merge, then move on. Each prompt creates its own branch so work stays reviewable. Run them roughly in the order below; the "Depends on" line says when order matters.

Audit basis: `npm run lint` (17 errors, 19 warnings), `npm run test:unit` (50/50 pass), `npm run build` (succeeds), plus a static review of `platform/web`, `platform/supabase`, `platform/android` and the deploy config. Line numbers can drift, so every prompt tells the agent to re-verify before changing anything.

Repo facts every prompt relies on:
- App: `platform/web` (Vite 8, React 19, Tailwind 3, Supabase, Capacitor 8). Backend: `platform/supabase` (migrations, edge functions). Android: `platform/android` (Capacitor, not TWA). Vercel Root Directory = `platform/web`.
- Git remote `origin` = watchman-patrolapp/watchman. Default branch is `main`.

## Plan at a glance

| # | Prompt | Severity | Depends on |
|---|--------|----------|-----------|
| 1 | Lock down edge functions and the cleanup cron | Critical | none |
| 2 | Close cross-tenant RLS holes | Critical | none |
| 3 | Fix the Vercel build and push (FCM) pipeline | Critical | none |
| 4 | Remove the 32 MB favicon and slim static assets | High | 3 |
| 5 | Add CI, fix repo and doc hygiene | High | 3 |
| 6 | Auth and routing robustness | High | none |
| 7 | SOS reliability and accessibility | High | none |
| 8 | Realtime and geolocation consolidation | High | none |
| 9 | Data loading and bundle performance | Medium | none |
| 10 | Lint errors, dead code, dependency pruning | Medium | none |
| 11 | PWA identity, icons and headers | Medium | 3, 4 |
| 12 | Android release hardening | Medium | none |
| 13 | Migration and storage hygiene | Medium | 2 |
| 14 | UX and visual design pass | Medium | 10 |
| 15 | Split oversized files (optional) | Low | 10 |

---

## Prompt 1 — Lock down edge functions and the cleanup cron (Critical)

```text
You are working in the repo at the workspace root (Neighbourhood Watch / "Watchman" platform). Backend lives in platform/supabase (edge functions in platform/supabase/functions, config in platform/supabase/config.toml). Create a branch `fix/edge-function-auth`.

PROBLEM (re-verify each item in the current code before changing it; line numbers may have drifted):
1. functions/auto-end-patrols/index.ts: config.toml sets verify_jwt=false and the handler has NO auth check at all, yet it uses the service-role key to end patrols and write patrol_logs. Anyone who can POST the URL can trigger it. It also reads only Deno.env 'SERVICE_ROLE_KEY' (other functions use SUPABASE_SERVICE_ROLE_KEY with SERVICE_ROLE_KEY fallback) and returns the raw error object in 500 responses.
2. functions/location-cleanup/index.ts: auth is skipped when CRON_SECRET is unset/empty (fails open). The secret is compared with `!==`. Access-Control-Allow-Origin is '*'. A stale duplicate functions/location-cleanup/index.js exists with no auth at all (config.toml entrypoint is index.ts).
3. functions/notify-resident-event/index.ts: derives the caller from a base64-decoded JWT payload (decodeJwtSub) instead of verifying it, while verify_jwt=false. A forged `sub` could trigger org-wide FCM as service role. admin-delete-user/index.ts (around lines 82-90) shows the correct pattern (supabase.auth.getUser(token)).
4. functions/notify-chat-message and notify-incident-status compare webhook secrets with `!==`. notify-incident-status has no [functions.*] block in config.toml.
5. notify-chat-message and notify-resident-event treat a failed `filter_notify_recipients` RPC as "send to everyone" (fail open, ignores mute/quiet hours).
6. .github workflow platform/web/.github/workflows/daily-cleanup.yml is in a nested .github folder (GitHub never runs it) and it sends the Supabase SERVICE ROLE key as the Bearer token to a public function URL.

DO:
- Add a small shared helper (e.g. functions/_shared/auth.ts) with: `timingSafeEqual(a,b)` for secrets (use constant-time comparison over equal-length byte arrays), `requireCronSecret(req)` that FAILS CLOSED (401/500 when CRON_SECRET env is missing or header x-cron-secret mismatches), and `getServiceRoleKey()` that reads SUPABASE_SERVICE_ROLE_KEY with SERVICE_ROLE_KEY fallback. Check how Supabase handles `_shared` folders in config.toml/import maps and make it work with the existing deno.json/import_map setup.
- auto-end-patrols and location-cleanup: require the cron secret via the helper; use getServiceRoleKey(); return generic error messages (log details server-side only); restrict CORS on cron-only functions (they do not need browser CORS at all; keep only what is needed).
- notify-resident-event: verify the caller with supabase.auth.getUser(token) as admin-delete-user does; remove decodeJwtSub; confirm that the authenticated user is actually allowed to broadcast for the given broadcastId/org (author or role check) before sending.
- notify-chat-message / notify-incident-status: use timingSafeEqual for the webhook secret; add an explicit [functions.notify-incident-status] block in config.toml with verify_jwt=false and a comment that the webhook secret header is the auth mechanism.
- filter_notify_recipients failures: fail closed (do not send), log the error, and return a 5xx so webhooks can retry.
- Delete functions/location-cleanup/index.js after confirming nothing references it.
- Move platform/web/.github/workflows/daily-cleanup.yml to the repo-root .github/workflows/ (create the folder). Change it to call the function with header `x-cron-secret: ${{ secrets.CRON_SECRET }}` plus the project anon key only if the gateway requires an apikey header; remove SUPABASE_SERVICE_ROLE_KEY from the workflow entirely. Keep workflow_dispatch and the schedule.
- Update platform/scripts/test-location-cleanup.ps1 so it requires CRON_SECRET and no longer calls the function with only the anon JWT.
- Update platform/docs (the README / runbook that mentions cron or edge function secrets) to list required secrets: CRON_SECRET, webhook secrets, and how to set them (supabase secrets set ...).

CONSTRAINTS: Do not change function behaviour beyond auth/error handling. Do not print or commit any secret values. Keep Deno import styles consistent with existing files.

VERIFY: Run `deno check` on each changed function if deno is installed (otherwise review types manually). Show me a table of each function with: auth mechanism before -> after. List the secrets I must set in Supabase and GitHub before deploying, and the exact `supabase functions deploy` commands for the changed functions.
```

---

## Prompt 2 — Close cross-tenant RLS holes (Critical)

```text
You are working in the Watchman multi-tenant platform repo. Backend is platform/supabase (migrations in platform/supabase/migrations, ad-hoc isolation tests in platform/supabase/sql/isolation_tests_community.sql). Create a branch `fix/rls-tenant-isolation`.

CONTEXT: Later migrations introduced org isolation helpers (look for current_org_ids(), organization_id columns and the `criminal_profiles_*_org` policies in 20260815028000_intelligence_org_isolation.sql). A static audit found tables that still use the ORIGINAL permissive policies and were never tightened. Re-verify each by reading ALL migrations that touch the table (grep the table name across platform/supabase/migrations, in timestamp order) and, if a Supabase CLI/DB is available, by querying pg_policies. Only fix what is truly still open.

CANDIDATES:
1. profile_associates, profile_geography, profile_intelligence, mo_pattern_history, profile_match_queue — created in 20250327000002_criminal_intelligence_system.sql with `auth.role() = 'authenticated'` policies (no org join). 20260815028000 only replaced policies on criminal_profiles. profile_match_queue UPDATE is open to every authenticated user.
2. profile_associates UPDATE/DELETE policies from 20260329240000_profile_associates_update_delete.sql allow any authenticated user.
3. incident_section_updates: SELECT `USING (true)` for authenticated (20260329220000_incident_section_updates.sql lines ~67-71).
4. security_company_resident_metrics view granted to authenticated in 20260818010000 and revoked in 20260820070000 — make the view `security_invoker = true` (or confirm it is only reachable by RPC) so it can never leak if grants regress.
5. feedback_reviews INSERT `WITH CHECK (true)` in 20260403150000 — tie to auth.uid() and the user's organization, keep it insertable by ordinary members.
6. Review (do not necessarily change, but report with a recommendation): incidents_select_own cross-org visibility (20260815051000), security_company_branding SELECT USING(true) (20260815074000), hotspots/cameras global SELECT (20260815029000).

DO:
- Write ONE new forward-only migration with a fresh timestamp later than the newest file in migrations/ (do not edit or rename existing migrations). Drop the legacy permissive policies by name (use DROP POLICY IF EXISTS) and create org-scoped replacements that mirror the criminal_profiles_*_org approach: child tables resolve the org via profile_id -> criminal_profiles.organization_id and current_org_ids() (use the exact helper names that exist in this repo). Staff-only write rules where the existing UI is staff-only; check src/pages/intelligence and src/components/intelligence to see who legitimately writes.
- Make sure no SECURITY DEFINER function you add lacks `set search_path = public` and an explicit auth check, and REVOKE EXECUTE from public/anon on new functions.
- Extend platform/supabase/sql/isolation_tests_community.sql (or add a sibling isolation_tests_intelligence.sql following the same style) with tests proving: user in org A cannot select/insert/update/delete org B rows in each table above, and a legitimate staff member of org A still can.
- Check the frontend queries for these tables (grep src) still work under the new policies; list any query that would now return fewer rows.

CONSTRAINTS: Migration must be idempotent and wrapped sensibly; do not touch unrelated tables; do not run it against production. If you can't run SQL locally, say so and give me the exact test steps.

OUTPUT: A short report listing each table, old policy -> new policy, which candidates were already fixed by later migrations (and which migration), and the recommendations for item 6.
```

---

## Prompt 3 — Fix the Vercel build and push (FCM) pipeline (Critical)

```text
You are working in the Watchman repo; the web app is platform/web and is deployed on Vercel with Root Directory = platform/web. Create a branch `fix/vercel-build-fcm`.

PROBLEM (verify first):
1. platform/web/vercel.json has buildCommand "npm install && npx vite build". `npx vite build` does NOT run npm's `prebuild` hook, so scripts/check-sound-assets.mjs and scripts/generate-firebase-messaging-sw.mjs never run on Vercel. public/firebase-messaging-sw.js is gitignored, so production may not have that file at all; the SPA rewrite in vercel.json then serves index.html for /firebase-messaging-sw.js and web push silently breaks.
2. vite.config.js disables VitePWA when process.env.VERCEL === '1', so production has no Workbox/precache/manifest.webmanifest, while public/sw.js (tracked) is a legacy network-first worker that nothing registers. src/main.jsx registerFcmServiceWorkerWhenNeeded() returns early if an existing registration's active script URL contains 'sw.js', so users who still have the legacy /sw.js registered never get /firebase-messaging-sw.js and never receive web push.
3. vercel.json rewrites `/((?!assets/).*)` to /index.html, which also swallows /sw.js, /firebase-messaging-sw.js, /.well-known/*, /manifest*, /sounds/*, /icons etc. if the static file is missing.
4. Node version drift: package.json engines ">=20" vs .nvmrc 18.20.8.

DO:
- Change vercel.json buildCommand to `npm run build` and installCommand to `npm ci` (package-lock.json exists; if `npm ci` fails because of the legacy-peer-deps/peer conflicts, report it rather than reverting silently). Make the generate-firebase-messaging-sw script fail the build with a clear message on Vercel when VITE_FIREBASE_* vars are missing (keep it lenient for local dev).
- Fix the rewrite so real static files and well-known paths are never swallowed (e.g. exclude `sw.js`, `firebase-messaging-sw.js`, `.well-known/`, `assets/`, `sounds/`, `icons/`, and any file with an extension).
- Rework registerFcmServiceWorkerWhenNeeded in src/main.jsx: if a legacy registration with scriptURL ending in '/sw.js' exists and VitePWA is not present, unregister it, then register /firebase-messaging-sw.js. Add a one-time console-free, try/catch-safe migration. Delete public/sw.js if nothing else needs it (grep first).
- Align .nvmrc to the Node major used by Vercel and engines (Node 20 LTS or 22), and update platform/web/README.md accordingly.
- Decide and document in platform/docs/SCALE_ROADMAP.md (short note) whether production is intentionally "online-first, no Workbox". Do NOT enable VitePWA on Vercel in this task; just make sure FCM works there.
- Fix typos/obsolete content in deploy helper scripts you touch; if platform/web/build.js, build.sh, deploy.sh, deploy.bat and test-gps-tracking.html are unused (check package.json, README, docs), delete them and update docs; otherwise make them call `npm run build`. (deploy.sh contains a `--preivew` typo.)

VERIFY: `cd platform/web && npm ci && npm run build` succeeds and `dist/firebase-messaging-sw.js` exists; `VERCEL=1 npm run build` also works. Show me the final vercel.json and a checklist of the Vercel env vars that must be set (list names only, no values).
```

---

## Prompt 4 — Remove the 32 MB favicon and slim static assets (High)

```text
Work in platform/web of the Watchman repo. Create a branch `perf/slim-static-assets`.

PROBLEM (verify sizes with a directory listing first):
- public/favicon.svg is ~32 MB (a single-line SVG wrapping a base64 PNG from RealFaviconGenerator), is tracked in git, and index.html links it on every page load (`<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=...">`). The Vite PWA build warns "favicon.svg is 33.5 MB".
- public/mask-icon.svg is ~0.6 MB (probably also embedded raster).
- public/sounds contains uncompressed WAV files (~7 MB: panic-siren.wav 1.5 MB, emergency-alarm.wav 1.5 MB, alert-chime, error-beep, patrol-autoend, etc.) and some MP3 duplicates. src/utils/sound.js preloads sounds (preloadSounds) up front.
- public/icon-512.png (0.4 MB) and assets/icons/icon-512.webp (0.48 MB) are heavier than they need to be.

DO:
1. Replace favicon.svg with a real small vector (use the app mark; if there is no vector source, generate a simple teal shield/eye mark SVG < 5 KB matching the brand colours #0d9488 / #0f766e / #083344) OR remove the svg link from index.html and rely on favicon.ico + favicon-96x96.png. Do the same for mask-icon.svg (single-colour, < 5 KB) or delete it if unreferenced (grep).
2. Convert the WAV sounds to compressed audio (OPUS in OGG or MP3 at a sensible bitrate; keep emergency sounds loud and clear) using ffmpeg if available. Update src/utils/sound.js and scripts/check-sound-assets.mjs and generate-placeholder-sounds.mjs so file names/extensions match; keep a WAV fallback only if a platform needs it (Android WebView supports MP3/OGG). Make preloadSounds lazy: preload only the 2-3 most used sounds, and load the rest on first play. Make sure the SOS/panic siren still plays instantly on Android and iOS Safari (do not break autoplay-unlock behaviour already in the code).
3. Re-encode the 512 PNG/WebP icons with a lossless optimiser or quantise them to < 120 KB each without visible quality loss.
4. Add a size budget check script (scripts/check-asset-budget.mjs) wired into `prebuild` that fails if any file in public/ exceeds 500 KB (allow an explicit allowlist) so this cannot regress.
5. Do NOT rewrite git history. At the end, tell me how much smaller `public/` and `dist/` are and give me (as an optional, separate step I can run myself) the `git filter-repo` command to purge favicon.svg from history, with a warning that it rewrites history and all collaborators must re-clone.

VERIFY: npm run build has no favicon size warning; PWA precache size drops; all sound keys used in src (grep `playSound`/sound names) resolve to existing files; lint passes for files you changed.
```

---

## Prompt 5 — Add CI, fix repo and doc hygiene (High)

```text
Work in the Watchman repo root. Create a branch `chore/ci-and-repo-hygiene`.

PROBLEM (verify first):
- There is no CI that runs lint, unit tests and build on pull requests. The only workflow is in a nested folder (platform/web/.github/workflows/daily-cleanup.yml) that GitHub does not execute; it was handled in a different task — if it's still nested when you start, move it to the root .github/workflows without changing its content.
- Root README.md says "Android TWA projects" but platform/android is a Capacitor project. platform/web/AGENTS.md and platform/web/.env.example document VITE_SUPABASE_SERVICE_ROLE_KEY as a web env var — any VITE_* var is bundled into the client, so this invites leaking the service-role key. The key is not referenced in src/ (verify with grep) and must not be.
- platform/web/.npmrc sets legacy-peer-deps=true which hides peer conflicts (e.g. vite-plugin-pwa 0.19.x vs Vite 8).
- platform/web/public/.well-known/assetlinks.json contains placeholders (com.yourcompany.watchman / YOUR_SHA256_FINGERPRINT_HERE) while the real app id is com.watchman.app.
- A modified platform/android/app/capacitor.build.gradle shows in `git status` but the diff is line endings only.
- ~17 stale merged feature/fix branches exist locally and on origin.

DO:
1. Add .github/workflows/ci.yml at the repo root: on pull_request and push to main; working-directory platform/web; setup-node using .nvmrc; `npm ci`; `npm run lint`; `npm run test:unit`; `npm run build`. Cache npm. Use dummy VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY env values so the build can run. Add concurrency cancel-in-progress.
2. Lint currently fails (17 errors). Do NOT fix them here and do NOT weaken the lint step (no --max-warnings tricks, no continue-on-error). Keep it a normal step and note in the PR description that CI will go green once the lint-cleanup task is merged.
3. Remove VITE_SUPABASE_SERVICE_ROLE_KEY from .env.example and AGENTS.md, add a comment "never put service-role keys in VITE_* vars". Add a tiny script scripts/check-no-secrets-in-env.mjs that fails the build if any VITE_ var name contains SERVICE_ROLE or SECRET, wired to prebuild.
4. Fix README.md (root and platform/README.md) wording: Capacitor, not TWA. Remove the stale sentence about legacy root folders if /src, /public, /android don't exist at the root.
5. Add a root .gitattributes (`* text=auto eol=lf`, with *.bat/*.ps1 as crlf, binary patterns for images/audio/jar/apk) and renormalise (`git add --renormalize .`) so the capacitor.build.gradle phantom diff disappears. Report how many files changed by renormalisation before committing; if it is more than ~20 files, stop and ask me.
6. Try removing legacy-peer-deps from .npmrc: run `npm install` + build. If it fails because of real peer conflicts, restore it and document the exact conflicts in platform/web/README.md under "Known peer-dependency issues".
7. assetlinks.json: if this app is not shipped as a TWA, delete the file; otherwise leave a TODO in README with what is needed. Do not invent fingerprints.
8. Print (do NOT run) the commands to delete merged local and remote branches, based on `git branch --merged main` and `git branch -r --merged origin/main`, so I can review them first.

VERIFY: CI yaml is valid (actionlint if available), `npm ci && npm run build` passes locally, `git status` is clean afterwards.
```

---

## Prompt 6 — Auth and routing robustness (High)

```text
Work in platform/web/src of the Watchman repo (React 19 + react-router 7 + Supabase). Create a branch `fix/auth-profile-failure-and-guards`.

PROBLEMS TO VERIFY AND FIX:
1. src/auth/AuthProvider.jsx (~lines 267-283) and src/auth/RequireRole.jsx (~25-27): when the `users` profile fetch fails or times out, the provider sets profileLoaded=true but the role is never hydrated, so hasHydratedAppRole stays false. RequireRole/RequireCapability then render the "Checking access…" skeleton forever. Users with a valid session are locked out of /schedule, /resident/*, admin pages, etc. with no way to recover.
2. src/App.jsx ~611-619: the /chat route only uses NeighborhoodRoute, with no role/capability guard. Compare with src/chat/chatChannels.js and canAccessPatrolOpsChat (or equivalent) to determine whether residents/other roles should reach patrol-ops channels. Either add the right guard or add a short code comment proving it is intentional and that channel-level access is enforced by RLS.
3. Review App.jsx fully for other routes missing guards, redirects that loop, and /admin/roles missing RequireActiveOrganization (decide if intentional).

DO:
- Add an explicit profile-load error state to AuthProvider (e.g. profileError + retryProfile()). After N retries with backoff (e.g. 3 tries over ~10 s) stop and expose the error. RequireRole/RequireCapability must render a clear error screen when profileError is set: friendly message, "Try again" button (calls retryProfile), and "Sign out" button. Never spin indefinitely; cap the skeleton at ~10 s then show the error screen.
- Offline case: if navigator.onLine is false, show an "You are offline" variant instead of an access error, and auto-retry on the `online` event.
- Add unit tests under src/utils/__tests__ or a new src/auth/__tests__ (node --test is the repo runner: see "test:unit" in package.json; keep tests runnable without a DOM by extracting the retry/backoff logic into a pure function).
- Fix the /chat guard per finding 2.
- Make sure the Dashboard role-redirect (Dashboard.jsx ~105-109) works with the new error state and does not flash residents onto the patrol dashboard.

CONSTRAINTS: Do not change database/RLS. Keep the existing visual language (Tailwind classes used by PageSkeleton and other error screens; look for an existing ErrorState/EmptyState component before creating one). Keep diffs focused.

VERIFY: npm run lint shows no new errors in files you touched; npm run test:unit and npm run build pass. Describe how to manually reproduce the failure (e.g. block the users request in DevTools) and what the user now sees.
```

---

## Prompt 7 — SOS reliability and accessibility (High)

```text
Work in platform/web/src of the Watchman repo. The app is an emergency/neighbourhood-watch app, so the SOS flows must be dependable and accessible. Create a branch `fix/sos-reliability-a11y`.

PROBLEMS TO VERIFY AND FIX:
1. src/utils/residentSos.js (~133-140, ~402-407) and src/pages/ResidentSos.jsx (~33-34, ~54-65): triggerResidentSos throws if the sos_alerts insert fails (good) but broadcastSosToPatrolChat only console.warn()s when the chat insert fails, and ResidentSos.jsx always toasts "Patrollers and admins have been notified" and navigates to /chat. The user may think help was alerted via chat when it wasn't.
2. There is no confirmation/cancel affordance on the resident SOS and no offline messaging. Check src/chat/hooks/useMessageQueue.js for an existing offline queue and reuse it so a failed chat broadcast is queued and retried.
3. src/chat/components/EmergencyButton.jsx (~67-71): the hold-to-trigger panic control works with mouse/touch only. src/components/**/SosHoldButton.jsx (~74-87) has a keyboard path — mirror that pattern. Also the lint error in the hold button (react-hooks/immutability: `tick` references itself inside useCallback) must be fixed with a ref-based rAF loop.
4. Check src/components/patrol/ActiveSosBanner.jsx, ActiveThreatsBanner.jsx (dismiss button has only `title`, no aria-label; photos use alt="").

DO:
- Make broadcastSosToPatrolChat return a structured result ({ ok, error }) and propagate it. The UI must show three distinct states: full success; SOS recorded but chat delivery failed (with a "Retry" button and automatic queued retry); total failure (clear red state, tells the user to call the emergency number — use the number configured in the app if there is one, otherwise a constant in src/config).
- Add a short confirm step that does not slow a real emergency: e.g. a 5-second "Sending SOS in 5… Cancel" countdown with a large Cancel button, skippable by a second press of the SOS button. Keep hold-to-trigger on the chat panic button but add keyboard (Space/Enter hold) and `aria-live="assertive"` progress text; support prefers-reduced-motion.
- When offline (navigator.onLine false), say so up front and queue the SOS for send-on-reconnect if feasible with the existing offline queue; otherwise display the phone-call fallback prominently.
- Add aria-labels to icon-only buttons you touch; give threat photos meaningful alt text from the incident type/description; make dismiss/close targets at least 44x44 px.
- Unit-test the pure logic (result shaping, countdown/cancel) with node --test in src/utils/__tests__ (see package.json "test:unit").

CONSTRAINTS: no DB changes; do not alter who is notified. Keep copy short and plain-language (South African English: "neighbourhood", "colour"). 

VERIFY: lint clean for touched files, tests pass, build passes. Write a manual test script (steps) covering: success, chat failure, offline, cancel during countdown, keyboard-only use.
```

---

## Prompt 8 — Realtime and geolocation consolidation (High)

```text
Work in platform/web/src of the Watchman repo. Create a branch `perf/realtime-geolocation-consolidation`.

PROBLEMS TO VERIFY AND FIX:
1. Up to 7-8 separate Supabase realtime `postgres_changes` channels listen to INSERTs on chat_messages with NO server-side filter: src/chat/hooks/useUnreadCount.js (~93-108) is used in Dashboard.jsx (~159-170), components/**/MobilePatrolDockHost.jsx (~35-45) and chat/components/ChatContainer.jsx (~257+), plus chat/hooks/useChatNotifications.js (~24-48) used by Dashboard.jsx (~199). Every message reaches every handler on every client.
2. src/pages/Dashboard.jsx (~142-155) keeps an always-on navigator.geolocation.watchPosition for the threat banner while useGPSTracking (hooks/useGPSTracking.js) runs another watcher during a patrol — double battery and network use and racy location state.
3. src/chat/components/MessageBubble/LocationMessage.jsx (~141-147): setInterval for checkConnectionSpeed every 30 s is never cleared in the effect cleanup, leaking a timer per mounted location bubble. Also lint error 'isMapLoaded' is unused (~174).
4. src/hooks/useChatNotifications.js (root hooks folder) is a near-duplicate of src/chat/hooks/useChatNotifications.js and appears unused (the app imports from '../chat'). Confirm by grep and delete it.
5. src/hooks/useGPSTracking.js (~355): `optionsRef.current = options` during render violates react-hooks/refs. Fix it by updating the ref in an effect (useLayoutEffect or useEffect).
6. src/pages/IncidentModeration.jsx (~380-387) polls every 30 s even while realtime is SUBSCRIBED.

DO:
- Create ONE chat realtime subscription manager (e.g. src/chat/realtime/chatRealtime.js or a context provider mounted once) with fan-out to subscribers (unread counts, notifications, active room), ref-counted subscribe/unsubscribe, and server-side filters where Supabase allows them (room_id=in.(...) or per-room channels for the user's rooms; if that is not feasible, filter early on the client by room membership and drop the rest immediately). Keep existing behaviour (sound is owned by useChatNotifications; do not double-play).
- Create a single shared geolocation source (context/hook) that both the threat banner and patrol tracking read from; only one watchPosition active; lower accuracy/frequency when not patrolling; stop the watcher on tab hidden unless a patrol is active.
- Fix the LocationMessage interval (and remove the unused state), fix the ref-in-render lint error, make IncidentModeration poll only when realtime is not SUBSCRIBED with exponential backoff.
- Audit every other `supabase.channel(` and `setInterval(` / `watchPosition(` in src for missing cleanup (return cleanup from useEffect, removeChannel on unmount) and fix what you find; list them in your report.

CONSTRAINTS: no DB changes. Keep the public API of hooks stable where possible (export names from src/chat/index.js). Add unit tests for the ref-counting/fan-out logic (node --test, pure JS). 

VERIFY: lint on touched files, tests, build. In your report give the before/after count of realtime channels and geolocation watchers on the Dashboard while on an active patrol.
```

---

## Prompt 9 — Data loading and bundle performance (Medium)

```text
Work in platform/web/src of the Watchman repo. Create a branch `perf/data-loading-and-bundle`.

PROBLEMS TO VERIFY AND FIX:
1. src/pages/IncidentList.jsx (~378-405) + src/utils/fetchPagedRows.js (~5-16): loads up to 20,000 approved incidents client-side and then runs `.in('incident_id', ids)` for evidence/updates with no chunking (URL/size limits, memory, main-thread jank). The evidence query error (`evErr`) is swallowed (~386-397).
2. src/pages/Leaderboard.jsx (~532-541): pulls up to 20,000 patrol_logs to aggregate on the client; also statically pulls in recharts and the route map stack.
3. src/pages/IncidentModeration.jsx (~365-369): realtime handler inserts a row with `evidenceRows: ev || []` even when the evidence query failed.
4. src/utils/equipmentWishlist.js (~175-177): a failed list_wishlist_ledger_totals RPC is treated as 0 covered cents, showing wrong fundraising totals.
5. Static imports of heavy libs: src/pages/AdminDashboard.jsx (~11-17) imports exceljs + recharts statically; src/pages/AdminWatchStaffActivity.jsx (~5) imports exceljs; src/chat/components/ChatContainer.jsx (~5) imports react-leaflet statically. The build output shows exceljs 1.1 MB, html2pdf 0.94 MB, PatrolRouteMapPanel 0.37 MB, ChatContainer 138 KB, Leaderboard 153 KB. src/utils/downloadDomAsPdf.js (~33) already shows the lazy `import()` pattern to copy.
6. React Query is used in only two hooks (useOrgCapabilities, useCriminalIntelligence); most pages hand-roll fetch/loading/error state.

DO:
- Add `chunkIds(ids, size = 150)` + `fetchInChunks()` helper in src/utils and use it for every `.in()` with potentially large arrays (grep for `.in(` on id lists).
- IncidentList: server-side pagination (keyset by created_at,id) with "Load more"/infinite scroll via @tanstack/react-virtual (already a dependency) and a hard cap (e.g. 200 per page); surface evidence-fetch errors with a non-blocking inline "Some evidence failed to load — Retry" row.
- Leaderboard: add a Supabase RPC (new migration with fresh timestamp, SECURITY INVOKER or DEFINER with explicit org check and `set search_path = public`) returning aggregated stats for a date range and organization; use it instead of fetching raw logs. Default to the last 90 days with a range picker. Lazy-load recharts and map sections with React.lazy + Suspense skeletons.
- Convert exceljs/recharts/leaflet-in-chat imports to dynamic import() at first use (export click, tab open). Confirm via `npm run build` that exceljs and html2pdf are no longer reachable from any entry/preloaded chunk, and report the before/after sizes of index, AdminDashboard, Leaderboard, ChatContainer chunks.
- Fix findings 3 and 4 properly: check `{ error }`, retry or fall back to a refetch, show an "unknown" state instead of 0.
- Migrate IncidentList and Leaderboard reads to React Query (useQuery/useInfiniteQuery) with sensible staleTime and error/retry UI. Keep the existing query key conventions if any (grep queryKey).
- Make ReactQueryDevtools load only in dev via `import.meta.env.DEV && lazy(() => import(...))` in main.jsx (currently `process.env.NODE_ENV` is used and the devtools package is a normal dependency).

CONSTRAINTS: Keep UI the same except for the new load-more/error rows. Any migration must be forward-only and include the isolation reasoning in a comment. 

VERIFY: lint on touched files, tests, build; list the new/changed migration and queries. Provide a before/after bundle table.
```

---

## Prompt 10 — Lint errors, dead code, dependency pruning (Medium)

```text
Work in platform/web of the Watchman repo. Create a branch `chore/lint-deps-dead-code`.

CURRENT STATE: `npm run lint` reports 17 errors and 19 warnings; unit tests (50) and build pass.

ERRORS TO FIX (re-run lint to get the live list):
- build.js: cmdError unused (delete the file if Prompt 3 hasn't already).
- chat/components/MessageBubble/LocationMessage.jsx: isMapLoaded unused.
- chat/hooks/useMessageQueue.js (~9): `file`, `blob` assigned but unused (check this is not a real bug — a queued file/blob that is never used would mean offline uploads are lost; read the code and fix the logic if so).
- components/intelligence/MoTemplatePicker.jsx (moSignature) and WatchlistTemplatePicker.jsx (watchlistFlags): unused args.
- components/patrol/ActiveSosBanner.jsx (~19): React Compiler "existing memoization could not be preserved" — fix the useCallback dependency list so it is consistent (user vs user?.id etc.).
- hooks/useGPSTracking.js (~355): ref written during render; the SOS hold-to-trigger button `tick` self-reference (react-hooks/immutability). If another task already fixed them, skip.
- pages/IncidentForm.jsx (~881): unused `_`; utils/leaderboardFunFacts.js (5 unused `c` params); utils/profileAssociates.js (~16) associate_profile unused; utils/volunteerStats.js (~117) holidayIdForDate unused.

WARNINGS: fix every react-hooks/exhaustive-deps warning properly (wrap loaders in useCallback, include deps, or restructure) instead of blanket eslint-disable. Where an intentional omission is correct, add a one-line `// eslint-disable-next-line react-hooks/exhaustive-deps -- reason`. For useSupabaseQuery.js (~87, spread in deps), serialise the deps key. For ref cleanup warnings (streetsFetchedRef) copy the ref value to a local in the effect.

DEPENDENCY PRUNING (verify each with grep over src/, scripts/, vite.config.js, tailwind.config.js before removing):
- Remove unused: @babel/runtime-corejs2, @firebase/storage (firebase/messaging is the only Firebase usage; check src/**/fcmRegistration.js), d3 (only used by an unmounted ProfileNetworkGraph.jsx — either delete both ProfileNetworkGraph.jsx and d3, or if the feature is planned, leave a TODO and keep).
- Move to devDependencies: @capacitor/cli, @capacitor/assets, @tanstack/react-query-devtools (only if devtools are loaded dynamically in dev; coordinate with the perf prompt).
- @tailwindcss/line-clamp: Tailwind 3.3+ includes line-clamp-* natively; remove the plugin from package.json and tailwind.config.js and confirm classes still compile.
- Delete dead code: src/hooks/useChatNotifications.js (duplicate of src/chat/hooks version, unused), any other file with zero importers (use a script or `npx knip`/`depcheck` as a one-off, do not add them as deps; review the result manually, since lazy imports and route strings can fool tools).
- main.jsx: `window.supabase = supabase;` is exposed unconditionally; wrap in `if (import.meta.env.DEV)`. Replace `process.env.NODE_ENV` with `import.meta.env.DEV`.
- Remove console.log/console.info of URLs/payloads in production paths (ChatContainer.jsx ~996-1012, MessageInput.jsx ~197 and ~526); guard with `import.meta.env.DEV` or delete. Consider a small `logger` util that is a no-op in production, and Sentry breadcrumbs for errors.
- Add to eslint.config.js: ignore dist/dev-dist/android assets; keep rules strict (no blanket off switches).

VERIFY: `npm run lint` exits 0 (warnings = 0 if feasible; otherwise list the remaining ones with reasons), `npm run test:unit`, `npm run build`. Report the bundle size delta and the list of removed packages and files.
```

---

## Prompt 11 — PWA identity, icons and headers (Medium)

```text
Work in platform/web of the Watchman repo. Create a branch `fix/pwa-identity-and-headers`. Depends on the Vercel build prompt being merged (npm run build used on Vercel).

PROBLEMS TO VERIFY AND FIX:
1. Two manifests: index.html links /site.webmanifest, while vite-plugin-pwa generates manifest.webmanifest; public/ also has manifest.webmanifest. App names conflict: 'Neighbourhood Watch', 'PatrolWatch' (vite.config.js short_name), 'Watchman' (index.html apple title, capacitor.config.json appName, Android strings.xml).
2. Icons are WebP only (site.webmanifest, vite.config.js manifest, apple-touch-icon in index.html). iOS needs PNG apple-touch-icon (180x180). Manifest has `purpose: 'any maskable'` (invalid combined value; use separate entries) and some entries declare type image/png on .webp files.
3. orientation: 'portrait-primary' locks the PWA, which hurts tablets and the map/schedule/admin views.
4. vercel.json caches everything except /assets/ with `no-cache` (including sounds, icons, fonts) and sets no security headers.
5. Google Fonts Inter is loaded from fonts.googleapis.com in index.html (render-blocking, third-party, fails offline/in-app WebView). tailwind.config.js lists JetBrains Mono/Fira Code which are not loaded.

DO:
- Pick ONE brand: product name "Watchman" (short) with title "Watchman — Neighbourhood Watch" unless you find the codebase clearly prefers otherwise; apply consistently to index.html <title>, manifest name/short_name, apple title, Capacitor appName, and Android strings.xml (ask me before changing the Android app_name if it is already published to Play).
- Single manifest source: keep one (generated by VitePWA for the capacitor/dev build and a static one in public/ for Vercel) — or make Vercel use a static public/manifest.webmanifest and delete the duplicates. Update index.html link accordingly.
- Generate PNG icons (192, 512, maskable 512 with safe-zone padding, apple-touch 180) with the existing `npm run web:icons` tooling or sharp; list them in the manifest with correct `type` and separate `purpose` entries. Add `screenshots` and `shortcuts` (e.g. "Start patrol", "Report incident", "SOS") if routes exist. Remove portrait lock (use "any").
- Self-host Inter (variable woff2 subset: latin + latin-ext) via @fontsource-variable/inter or /public/fonts with font-display: swap and preload; remove the Google Fonts link and the unused mono families (or load JetBrains Mono only where used).
- vercel.json headers: immutable 1-year cache for /assets/*, /fonts/*, /sounds/*, /icons/*; `no-cache` only for index.html, sw files, manifest; add security headers: Strict-Transport-Security, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy (geolocation=(self), camera=(self), microphone=(self)), X-Frame-Options DENY (or frame-ancestors in CSP). Add a Content-Security-Policy in Report-Only mode first, covering Supabase (https + wss), Firebase, OSM tile hosts, Sentry, fonts, blob:/data: images. Document in the PR how to promote it to enforcing after a week.

VERIFY: npm run build; run `npx lighthouse` or the browser devtools Application tab to confirm manifest installability, and report the PWA checklist results. Show before/after of the response headers for / and /assets/x.js.
```

---

## Prompt 12 — Android release hardening (Medium)

```text
Work in platform/android (Capacitor 8) and platform/web/capacitor.config.json of the Watchman repo. Create a branch `chore/android-release-hardening`.

PROBLEMS TO VERIFY AND FIX:
1. app/build.gradle (~22-27): release buildType has `minifyEnabled false` and no signingConfig; gradle.properties has android.r8.optimizedResourceShrinking=false. versionCode 6 / versionName "1.0.5" are hard-coded.
2. AndroidManifest.xml: android:allowBackup="true"; only ACCESS_FINE/COARSE_LOCATION, no ACCESS_BACKGROUND_LOCATION and no foreground service. hooks/useGPSTracking.js uses watchPosition only, so patrol tracking pauses when the app is backgrounded or the screen is off on modern Android — a real problem for a patrol app, and Play policy requires a prominent disclosure for background location.
3. res/xml/config.xml has the legacy Cordova `<access origin="*" />`.
4. google-services handling: plugin applied conditionally; app/google-services.json.example uses package com.your.app.id instead of com.watchman.app.
5. Check network_security_config / usesCleartextTraffic, exported components, and that WebView debugging is debug-only (MainActivity).

DO:
- Add release signing via a gitignored keystore.properties (and env vars for CI) — no secrets in the repo; document in platform/README.md how to create the keystore and build a signed AAB (`gradlew bundleRelease`). Enable minifyEnabled true + shrinkResources true with the Capacitor/Firebase keep rules; build `assembleRelease` locally to confirm the app still starts (describe a smoke test since you can't run a device).
- Read versionCode/versionName from gradle properties or a version file, bump scripts documented; keep current values as defaults.
- allowBackup=false (or dataExtractionRules/fullBackupContent that exclude shared prefs and the WebView data).
- Remove `<access origin="*">` if nothing depends on it.
- Fix the google-services.json.example package name.
- Background tracking: propose and, if you judge it low-risk, implement the minimal solution — a Capacitor background geolocation approach (evaluate @capacitor-community/background-geolocation or a foreground service with a persistent "Patrol in progress" notification), manifest permissions (FOREGROUND_SERVICE, FOREGROUND_SERVICE_LOCATION, ACCESS_BACKGROUND_LOCATION only if truly required), a runtime in-app prominent-disclosure screen before requesting background location, and battery-optimisation guidance. If it is too large, STOP at a written design with options and effort estimates in platform/docs/ANDROID_BACKGROUND_TRACKING.md and don't change code for that part.
- Make sure `npm run android:sync` and `android:apk:debug` still work.

CONSTRAINTS: don't change applicationId (com.watchman.app). Don't commit keystores or google-services.json. 

VERIFY: `cd platform/web && npm run android:sync && cd ../android && gradlew.bat assembleDebug` works; `assembleRelease` configuration at least evaluates. Summarise permission changes (before/after) in the PR description.
```

---

## Prompt 13 — Migration and storage hygiene (Medium)

```text
Work in platform/supabase of the Watchman repo. Create a branch `chore/migration-and-storage-hygiene`. Do this AFTER the RLS prompt is merged.

PROBLEMS TO VERIFY:
1. Duplicate migration timestamp prefixes: 20260815076000_* (emergency_directory_media + neighbourhood_activity_feed_windows), 20260329240000_* x2, 20260329250000_* x2, 20260815031000_* x2. Supabase orders by version; duplicate versions can fail on `supabase db push` / fresh DB.
2. platform/supabase/sql/*.sql (9 files) are ad-hoc DDL duplicating migrations (e.g. criminal_profiles_legal_status_columns.sql vs 20260329250000_criminal_profiles_legal_status.sql).
3. Sample/demo data in migrations: 20260815059000_sample_gqeberha_security_companies.sql.
4. Two migrations create resident_report_events (20260815025000 and 20260815051000).
5. 20261031071000_wishlist_multi_photos.sql line ~276 has two statements concatenated on one line.
6. Storage: incident-photos bucket is public (20260328163000), community-media is public (20261031030000), and ~10 migrations drop/recreate storage.objects policies (churn, e.g. 20261021004000 and 20261021005000, 20260820090000). The audit suspects drift between environments.
7. Review platform/supabase/config.toml for local-dev settings that should not be left on in prod-linked config.

DO (NON-DESTRUCTIVE; never edit migrations that may already be applied in production):
- First check which migrations are applied in the remote project if the CLI is linked (`supabase migration list`); if you cannot, say so and treat all existing files as applied.
- For duplicate versions: do NOT rename applied files. Produce a written plan using `supabase migration repair` if renaming is needed, and rename only files confirmed unapplied. Add a CI/precommit check script (scripts/check-migration-versions.mjs) that fails on duplicate version prefixes for NEW migrations only (compare against an allowlist of the known historical duplicates).
- Move sql/*.sql into platform/supabase/archive/ (or delete if they are exact duplicates of migrations), keeping isolation tests in platform/supabase/tests/. Update docs and README references.
- Move sample/demo seeds into supabase/seed.sql guarded so they run only locally (or document that production already has this data and leave the migration alone).
- Write ONE new forward migration `storage_policies_consolidated` that re-states the final intended storage.objects policies per bucket (using DROP POLICY IF EXISTS then CREATE) — derive the final state from the policies as they stand after all migrations (query pg_policies if a DB is available; otherwise from the latest migration touching each bucket) and add a header comment listing the superseded migrations. 
- Public buckets: do NOT flip incident-photos or community-media to private in this task (it requires signed-URL changes in the app). Instead, grep src for how URLs are produced (getPublicUrl vs createSignedUrl), list every call site, estimate effort, and write the exact plan in platform/docs/STORAGE_PRIVACY_PLAN.md with a recommendation (incident evidence = private + signed URLs; resident media = decide).
- Add a docs note in SQL_CONVENTIONS.md: unique 14-digit timestamps, one concern per migration, never edit applied migrations, newline-separated statements.

VERIFY: if Docker + supabase CLI available, run `supabase db reset` locally to confirm migrations apply cleanly in order and run the isolation test SQL; otherwise state what you could not verify.
```

---

## Prompt 14 — UX and visual design pass (Medium)

```text
Work in platform/web/src of the Watchman repo (React + Tailwind 3, teal brand #0d9488, dark mode via class). Create a branch `feat/ux-design-pass`. Depends on lint cleanup being merged.

OBSERVATIONS FROM A LIVE LOOK AT /login AND A CODE REVIEW:
- Login page: header shows only text "Neighbourhood Watch" with no logo; the card has no trust/safety messaging; the "Stay signed in" checkbox renders in the browser-default purple instead of the brand teal; the font renders as a fallback because Google Fonts is external; no visible focus rings audit; the primary button is a muted teal (#43938a-ish) with unclear disabled/loading states.
- A global Toaster is mounted top-right (main.jsx) which overlaps the header/notification bell on mobile; many flows toast on both success and failure.
- Icon-only buttons across IncidentList.jsx (~449+), banners and chat lack aria-labels; tap targets under 44 px in dense lists; `alt=""` on meaningful images.
- Largest screens (Dashboard 1500+ lines, CriminalProfileDetail 1600+) mix many concerns, which causes visual density and inconsistent spacing.
- Tailwind theme defines custom gray palette and CSS variables in index.css but components mix raw hex, Tailwind colours and CSS variables.

DO:
1. Establish a small design-token layer: map CSS variables (index.css :root and .dark) to Tailwind theme colours (primary, success, warning, danger, info, surface, border, text) and document usage in platform/docs/DESIGN_SYSTEM.md. Set `accent-color` to the brand on form controls globally; ensure AA contrast (4.5:1 text, 3:1 UI) in both light and dark for primary buttons, links, helper text and badges — run a quick contrast script/report and fix tokens that fail.
2. Create or consolidate shared primitives (Button with loading/disabled states, IconButton with required `label` prop that sets aria-label and a min 44px hit-area, FormField with label/help/error, EmptyState, ErrorState with retry, Skeleton). Check for existing components before creating duplicates, and migrate only the highest-traffic screens: Login, Register, Dashboard, ResidentDashboard, IncidentList, IncidentForm.
3. Login/Register redesign (keep logic): logo + product name, one-line value proposition ("Keep your neighbourhood safe together"), password show/hide with proper aria-pressed, visible inline validation, `autocomplete` attributes (username/current-password/new-password), `inputmode`, loading spinner in the button, and a calm trust footer (privacy policy and terms links that already exist in docs/routes). Keep the dark-mode toggle but make it labelled. Use mobile-first layout, safe-area insets (viewport-fit=cover is already set).
4. Notifications: move the Toaster to bottom-center on mobile (above the tab bar / safe area) and top-right on md+; dedupe identical toasts with an id; success toasts for routine saves should be short (2 s), errors persist longer with an action when retryable.
5. Add a global `:focus-visible` ring style, `prefers-reduced-motion` handling, and skip-to-content link in the app shell.
6. Accessibility sweep on the screens migrated: labels for every input, aria-live regions for async status, correct heading order, keyboard-trap-free dialogs (focus return on close; use an existing Dialog implementation if present).
7. Offline/slow-network: global offline banner (navigator.onLine + `online`/`offline` events) with consistent copy, and ensure primary lists have loading, empty and error states.

You may use the Mobbin MCP (search_screens / search_flows) to gather 3-5 reference screens for login/onboarding and incident reporting for inspiration, and mention the references you used in the PR description; do not copy any design assets.

VERIFY: lint, tests, build. Provide before/after screenshots of Login (light+dark, 390px and 1280px) captured via the browser tool, and an axe-core or Lighthouse accessibility score before/after for Login and Dashboard.
```

---

## Prompt 15 — Split oversized files (optional, Low)

```text
Work in platform/web/src of the Watchman repo. Create a branch `refactor/split-large-components`. Only start after lint cleanup and the perf prompts are merged to avoid conflicts. Behaviour must not change.

Largest files (lines) and suggested seams:
- pages/CriminalProfileDetail.jsx 1659 -> core profile / associates / sightings / admin actions
- chat/components/ChatContainer.jsx 1577 -> message list, composer, map share, voice upload
- pages/Dashboard.jsx 1537 -> patrol lifecycle hook, active patrols list, header/actions
- pages/SecurityCompanyDashboard.jsx 1464 -> map board / roster / SOS panels
- pages/Profile.jsx 1340 -> household, vehicles, verification, settings
- pages/Leaderboard.jsx 1209, pages/IncidentForm.jsx 1118, pages/AdminDashboard.jsx 1104, pages/IncidentDetail.jsx 1073

DO, one file per commit (so each is revertable):
- Extract data/side-effect logic into custom hooks (src/hooks or alongside the page in a folder) and presentational subcomponents; keep props explicit; no new global state.
- Do not rename routes or exports used by React.lazy in App.jsx; keep default exports for page components.
- After each extraction run `npm run lint`, `npm run test:unit`, `npm run build`. If a file needs more than ~1.5 hours of careful work or has no test safety net, stop and add characterisation tests first (pure-function extraction + node --test).
- Target: no component file over ~500 lines; report remaining ones.

Stop after 3 files and give me a report, so I can review before you do more.
```

---

## Decision points for you

These came out of the audit and need a product decision before (or while) running the prompts above:

1. **Background GPS during patrols** (Prompt 12): foreground-only tracking or a foreground service with background location? The second needs a Google Play disclosure and review.
2. **Private storage for incident photos / community media** (Prompt 13): the right security answer is private buckets with signed URLs, but it touches every image call site. Schedule it as its own project.
3. **PWA on Vercel**: production is currently online-first with no Workbox or offline shell. Decide whether offline support matters for patrollers; if yes, add a follow-up task to merge Workbox and FCM into one service worker.
4. **Hotspots and cameras visible city-wide** to every authenticated user: confirm that is intended.

## What was verified directly versus inferred

Verified by running or reading: lint, tests and build results; vercel.json `buildCommand` skipping the `prebuild` hook; `favicon.svg` ~32 MB and tracked in git; the workflow being in a nested `.github`; `auto-end-patrols` having no auth check; `location-cleanup` failing open when `CRON_SECRET` is unset; `VITE_SUPABASE_SERVICE_ROLE_KEY` documented in `.env.example` and `AGENTS.md`; dead `useChatNotifications` duplicate and `ProfileNetworkGraph`; login page appearance.

Inferred from static review and worth re-checking inside each prompt (the prompts tell the agent to do so): the individual RLS gaps, the AuthProvider dead-end, the realtime channel counts, and the Android background-tracking behaviour.
