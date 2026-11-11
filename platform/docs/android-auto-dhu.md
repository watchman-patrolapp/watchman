# Android Auto: testing in the DHU

Watchman's car screens run as a Car App Library `CarAppService` (POI category, map templates) inside the normal Android app.

## Set up the Desktop Head Unit (DHU)

1. In Android Studio's SDK Manager (SDK Tools) install **Android Auto Desktop Head Unit Emulator**.
2. On the phone: Settings > Apps > Android Auto > tap the version 10 times > three-dot menu > **Developer settings** > enable **Unknown sources**, then three-dot menu > **Start head unit server**.
3. `adb forward tcp:5277 tcp:5277`, then run `desktop-head-unit` from `<sdk>/extras/google/auto/`.
4. Install the debug build. Debug builds allow any host; release builds only allow Google's host allowlist.
5. In the DHU open the app launcher and choose **Watchman** (navigation / POI section).

Day and night: in the DHU console use `day` / `night` to switch the theme and check that colours stay readable.

## What to expect

- Signed out on the phone: "Open Watchman on your phone and sign in".
- Signed in as a patrol member: stats row, pins for other patrollers and recent incidents, and the actions Check in (or End patrol), Report, SOS, Nearby.
- Apply `20261111010000_android_auto_car_dashboard.sql` in Supabase first, or the car says "Watchman needs an update on the server".
- GPS points upload only while the phone app is tracking; the car shows the phone's live distance and the server's total.

## Play listing angle

Describe Watchman for cars as a community-safety navigation helper:

- see nearby incidents and other patrollers on the map
- navigate to an incident or an SOS in one tap
- send a two-step SOS or a one-tap preset report without typing
- end the patrol with a summary (date, times, duration, distance)

No text entry and no video; the screens follow the driver-distraction rules (short lists, no animation, refresh no more than every 15 seconds).
