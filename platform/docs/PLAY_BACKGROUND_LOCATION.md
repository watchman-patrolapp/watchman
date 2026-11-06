# Google Play declaration — patrol background location

Use this when the first App Bundle that contains the patrol foreground service and `ACCESS_BACKGROUND_LOCATION` is uploaded. The feature records a route only while a patroller is signed on. Signing off, or the patrol ending on its own, stops the service.

Package name: `com.watchman.app`.

## Foreground service declaration

Play Console → App content → Foreground service permissions.

| Field | Text |
| --- | --- |
| Service type | Location (`foregroundServiceType=location`) |
| Permission | `FOREGROUND_SERVICE_LOCATION` |
| When it runs | Only during a signed-on patrol |
| User-visible notice | Persistent notification titled **Watchman: patrol in progress** |

**Declaration text** (paste into the description):

> Watchman is a neighbourhood-watch patrol app. While a patroller is signed on to a patrol, the app runs a location foreground service and shows the notification “Watchman: patrol in progress”. The service records the patrol route so coordinators can see it on the live map, including when the phone is locked, the screen is off, or another app is in front. The service starts only after the patroller signs on, and it stops when they sign off or when the patrol reaches its time limit. Watchman does not collect location in the background when the patroller is signed off.

Video for this declaration can be the same recording as the background-location video below. Show the notification appearing at sign-on and disappearing at sign-off.

## Background location declaration

Play Console → App content → Sensitive app permissions → Location.

The app declares `ACCESS_BACKGROUND_LOCATION` and asks for **Allow all the time** only after a separate in-app explanation, and only when a patrol is starting. While-in-use location is requested first.

**Feature name:** Patrol route recording

**Why the app needs location in the background** (paste):

> Watchman records a patroller’s route only during a signed-on patrol. Patrollers lock the phone or switch apps while they are out, and the route has to continue so the neighbourhood watch can see where the patrol has been. Before the system permission dialog, the app shows an in-app explanation that location is collected in the background only during that patrol, that a “Watchman: patrol in progress” notification stays visible, and that tracking stops at sign-off. The explanation links to the in-app privacy policy at /privacy. If the patroller does not choose Allow all the time, the app keeps recording only while it is open and does not start the background service. Location is not collected when the patroller is signed off.

**In-app disclosure** (what the reviewer will see, before the system dialog):

> During a signed-on patrol, Watchman shows a “Watchman: patrol in progress” notification and records your route in the background, including while the screen is off or you switch apps. Tracking stops when you sign off.

The screen has a link to the privacy policy and the choice **Only while the app is open**, which skips the background permission.

## Battery optimisation

The patrol screen explains that some phone makers freeze background work, then offers **Allow during patrol**. That opens Android’s “ignore battery optimisations” prompt (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`). **Not now** continues the patrol without the exemption.

Play reviews this permission closely. If the declaration is rejected, remove the direct prompt and keep the explainer plus a link to the system battery screen. The route recording itself does not depend on the exemption; the notification and foreground service are the mechanism that should keep the patrol alive.

## Video script

Record on a physical Android phone (Android 14 or newer). One continuous take, about two minutes. Speak the lines below, or show them as captions. Do not cut out the permission dialogs.

1. **Signed off.** Open Watchman, already signed in, on the dashboard with no active patrol. Say: “No patrol is signed on. Watchman is not tracking location.” Pull down the notification shade and show there is no patrol notification. Optionally show system location permission still unused for background.
2. **Sign on.** Tap the control that starts a patrol. Say: “I am signing on to a patrol. Watchman explains location before the system dialog.”
3. **While in use.** Read the in-app line about location for this patrol, tap **Continue**, and on the system dialog choose **While using the app** (precise location if asked).
4. **Prominent disclosure.** Read the next in-app screen out loud, including that tracking is only during the patrol, that the notification stays up, and that it stops at sign-off. Point at the **Privacy policy** link and open it long enough to show the sentence that location is tracked only during a signed-on patrol, including in the background. Return to the disclosure.
5. **Allow all the time.** Tap **Continue**. On Android 11 and newer the system opens location settings. Choose **Allow all the time**. Return to Watchman.
6. **Notification.** If a notification permission dialog appears, allow it. Say: “The patrol notification is how the phone knows the route is still being recorded.” Show the shade with **Watchman: patrol in progress** and the text that tracking stops in the app.
7. **Battery explainer.** If the phone shows the battery explanation, read the line about Samsung, Xiaomi, and similar phones, tap **Allow during patrol**, and complete or dismiss the system battery dialog.
8. **Screen off.** Press the power button, wait at least 30 seconds, unlock, and show the route still updating (or say you will show the new points after the next step). Switch to another app for a few seconds, then come back. The notification must still be present.
9. **Sign off.** End the patrol in the app. Say: “Signing off stops tracking.” Show the notification is gone and the dashboard is no longer recording.

Upload the video unlisted (YouTube or a Play-accepted host) and paste the URL into both the foreground-service form and the background-location form.

## Permissions in this bundle

| Permission | Role |
| --- | --- |
| `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION` | While-in-use fix, requested first |
| `ACCESS_BACKGROUND_LOCATION` | “Allow all the time”, only after the disclosure, only for a signed-on patrol |
| `FOREGROUND_SERVICE` | Allows the patrol service |
| `FOREGROUND_SERVICE_LOCATION` | Required on Android 14+ for a location service |
| `POST_NOTIFICATIONS` | Shows the persistent patrol notification (Android 13+) |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Optional exemption prompt after the battery explainer |

`applicationId` stays `com.watchman.app`. The location service is `com.equimaps.capacitor_background_geolocation.BackgroundGeolocationService` with `android:exported="false"` and `android:foregroundServiceType="location"`.

## Build a phone build

From `platform/web`, with the Android SDK installed:

```bash
npm ci
npx cap sync android
cd ../android
./gradlew assembleDebug
```

`npm ci` runs `scripts/patch-background-geolocation.mjs`, which sets the service’s `startForeground` type to location (required on targetSdk 34+) and `exported=false`. `android:sync` builds the web app and runs the same patch before `cap sync`.

Install `platform/android/app/build/outputs/apk/debug/app-debug.apk`. Sign on, confirm the notification, lock the phone for several minutes, sign off, and confirm the notification is gone. Repeat with background location denied and confirm the route still records while the app is open. Repeat with notifications denied and confirm the app does not stick on a system error.

Release minify keeps `com.equimaps.capacitor_background_geolocation.**` and `com.watchman.app.WatchmanPatrolPlugin`. `android.useLegacyBridge` is on so location callbacks still arrive after several minutes in the background. That flag changes the Capacitor bridge for the whole app.

No database migration is required. Retries send the same `patrol_locations.id`, so a duplicate insert is ignored.
