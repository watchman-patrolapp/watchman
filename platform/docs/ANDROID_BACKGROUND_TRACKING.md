# Android background location during a patrol

Status: **not implemented**. This is the design stop for audit prompt 12. No tracking code, manifest permissions, or plugins were changed for this problem.

## Why it stopped here

Patrol tracking today is a `navigator.geolocation.watchPosition` running inside the Capacitor WebView (`platform/web/src/geo/sharedGeolocation.js`, started from `platform/web/src/hooks/useGPSTracking.js`). `@capacitor/geolocation` is used only to request the while-in-use permission. The shared watch is kept while a patrol consumer is held, including when the page is hidden. That does not survive Android backgrounding.

`BridgeActivity` pauses the WebView in `onPause`. Paused WebViews stop geolocation callbacks and JS timers. A foreground service that only keeps the process alive does not un-pause that WebView. Points also upload through `supabase-js` in the page. After a few minutes in the background, Android throttles HTTP started from a WebView, so a native location callback that still calls `fetch` from JS will stall even if the process is up.

Shipping a fix means a native location source, a persistent notification, a flush path that does not depend on the paused page, Play Console declarations, and a physical-device pass (screen off, app switch, OEM battery saver). That is larger than release hardening, and it cannot be checked on a device in this change. The low-risk bar is not met.

## What the app does today

| Piece | Behaviour |
| --- | --- |
| Position source | `navigator.geolocation.watchPosition` in the WebView |
| Permission | `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` only |
| Background permission | Not declared |
| Foreground service | None |
| While the screen is off or the app is backgrounded | WebView is paused. Fixes stop until the activity resumes |
| On return to the app | An already-active watch is not restarted. A watch that Android dropped stays dropped until the next `startTracking()` |

Permissions on the app manifest are unchanged by the release-hardening work. See the permission table at the end of this doc.

## Options

### A. Location foreground service, while-in-use permission (recommended)

Record the route only during an active patrol, with a persistent notification the patroller can see.

- Start the service from the foreground when a patrol starts. Stop it when the patrol ends, the auto-stop timer fires, or the user taps Stop on the notification.
- Notification copy: title **Patrol in progress**, text **Watchman is recording your route. Tap to return. Stop in the app to end tracking.**
- Native location callbacks (Fused Location Provider) write points to a small on-device queue. Flush that queue with Capacitor's native HTTP client (or a short native upload that uses the existing session), not `fetch` from the paused WebView. On resume, the existing `patrol_locations` insert path can drain anything still queued.
- Manifest additions: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` (required for a location-typed service on API 34+). `POST_NOTIFICATIONS` is already present and must be granted on API 33+ or the service cannot show its notification.
- Do **not** add `ACCESS_BACKGROUND_LOCATION`. A location foreground service started while the app is in the foreground may keep receiving fixes under the while-in-use grant. Play reviews that permission separately and rejects it when a notification-based patrol would do.
- Play Console: declare the foreground service type `location` and say it runs only during an active patrol.
- In-app line before the first patrol start (the existing permissions primer is the place; bump `PERMISSIONS_PRIMER_STORAGE_VERSION` when the copy changes): "During a patrol, Watchman shows a Patrol in progress notification and records your route while the screen is off. Tracking stops when the patrol ends."
- Battery: tell the patroller that some phone makers still freeze the service. Send them to the system battery screen (`Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` or the app details screen). Do not call `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`. Play treats a direct exemption prompt as a policy problem, and it is not required for a visible patrol notification.
- Service `android:exported` must be `false`. There is no reason for other apps to bind to it.

Engineering size: **medium**. New native plugin (service, notification, location callback, queue), changes in `useGPSTracking.js` / `Dashboard.jsx` start and stop, manifest, primer copy, and a device matrix (API 26, 33 notification grant, 34+ service type, at least one aggressive OEM). Bigger than a config change. This is the option to build when someone can run it on a phone.

### B. `@capacitor-community/background-geolocation` 1.3.1

The plugin (October 2026) declares Capacitor 8 as a dev dependency and peer-depends on `@capacitor/core` >= 3. It starts a location foreground service when `backgroundMessage` is set, and its manifest does **not** request `ACCESS_BACKGROUND_LOCATION`. Permissions it merges: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, plus the fine/coarse/notification permissions this app already has.

Do not drop it in unchanged:

- The service is `android:exported="true"` with no permission guarding it. It should be `false`.
- The README tells you to set `android.useLegacyBridge: true` so updates do not die after about five minutes. That flag changes the Capacitor bridge for the whole app, not just geolocation.
- The same README says WebView HTTP is throttled after about five minutes in the background, so `supabase-js` uploads still need a native HTTP path.
- Notification icon rules are strict (transparent status-bar icon). A bad icon makes the notification dismissible, which cancels the service.
- It does not include a disclosure screen or a Stop control wired to `useGPSTracking`.

Engineering size: **medium, higher risk** than option A. Less native code to write, more behaviour inherited from the plugin and from `useLegacyBridge`. Still needs the disclosure line, the upload path, an `exported="false"` patch, and the same device matrix.

### C. `ACCESS_BACKGROUND_LOCATION`

Request this only if the product must keep recording after the notification is gone (patrol continues with no foreground service). That is a different feature from "record while the phone is in a pocket during a patrol."

Play requires a prominent in-app disclosure **before** the runtime prompt: inside the app, not only in the store listing or the privacy policy, stating that location is collected in the background and why. The background grant is a separate request from fine location. The Console asks for a video of that disclosure. Reviews reject apps that ask for background location when a foreground service would cover the stated use.

Engineering size: **large**. Everything in option A, plus the disclosure flow, the separate permission request, the Console video, and a likely review cycle. Do not start here.

### D. Keep the screen on, or ask for a battery exemption

`@capacitor-community/keep-awake` only helps while the screen stays on. It does not cover a phone in a pocket. `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is a Play policy risk and does not fix the paused WebView. Engineering size: **small, and it does not fix the gap.** Not a candidate.

## If option A is built later

1. Add the service and the two foreground-service permissions. Leave `ACCESS_BACKGROUND_LOCATION` out.
2. Show the primer sentence, then start the service from an active patrol only.
3. Queue fixes natively and upload with native HTTP. Keep the current `patrol_locations` row shape.
4. Stop the service on patrol end and on the existing auto-stop timer.
5. Point patrollers at the system battery settings. Do not request an exemption.
6. Device pass: screen off for ten minutes, switch to another app, deny notifications (service must fail visibly), Android 14, one OEM with a battery killer.
7. Play Console foreground-service declaration before the AAB that contains the new permissions.

## Permissions

Unchanged in the release-hardening change. Option A would add only the two foreground-service permissions.

| Permission | Now | Option A |
| --- | --- | --- |
| `INTERNET` | yes | yes |
| `POST_NOTIFICATIONS` | yes | yes |
| `ACCESS_COARSE_LOCATION` | yes | yes |
| `ACCESS_FINE_LOCATION` | yes | yes |
| `ACCESS_BACKGROUND_LOCATION` | no | no |
| `FOREGROUND_SERVICE` | no | yes |
| `FOREGROUND_SERVICE_LOCATION` | no | yes |
| `CAMERA`, `RECORD_AUDIO`, media reads, legacy external storage | yes | yes |

`applicationId` stays `com.watchman.app`.
