# Manual test: SOS reliability and accessibility

Use a signed-in resident in a neighbourhood. Open `/resident` and `/sos`. DevTools: Network and Application → Local Storage (`chat_message_queue`).

## 1. Full success

1. Stay online.
2. Hold the SOS button for 2 seconds (mouse, touch, or Space/Enter).
3. Confirm the line “Sending SOS in 5…” and a large Cancel button.
4. Wait for the countdown to finish without pressing Cancel.
5. Expect a green state: “SOS sent. Patrollers and admins have been notified.”
6. Open patrol chat and confirm one critical SOS message. The SOS board should show the alert.

## 2. Chat failure, queued retry

1. In DevTools, block requests to `chat_messages` (or set the request to fail) and leave `incidents` and `sos_alerts` allowed.
2. Hold SOS, then let the countdown finish.
3. Expect an amber state: the SOS is recorded, patrol chat did not get it, and a Retry button is shown.
4. Expect a `chat_message_queue` entry with `visibility: "patrol"` and `is_emergency: true`.
5. Unblock `chat_messages`. Press Retry, or wait for the automatic retry.
6. Expect the green success state and one patrol chat message (not a second SOS alert).

## 3. Offline

1. DevTools → Network → Offline (`navigator.onLine` is false).
2. Expect an up-front “You are offline” notice before you send.
3. Hold SOS and let the countdown finish.
4. If storage works, expect “This SOS is queued” and a large Call SAPS 10111 link. `chat_message_queue` has a `sos_pending` item.
5. Go back online. The queued SOS should send on its own. Success if chat also sends; amber plus Retry if only the SOS row was saved.
6. To see the phone fallback as the main action, block site storage (or the probe) so the queue cannot be written, then send while offline. Expect a red “SOS was not sent” state and Call SAPS 10111.

## 4. Cancel during the countdown

1. Hold SOS for 2 seconds.
2. While “Sending SOS in 5…” is showing, press Cancel (or Escape).
3. Expect the countdown to clear and no new SOS alert or chat message.
4. Hold again, and during the countdown press the SOS button a second time (short press, or Space/Enter).
5. Expect the send to start immediately, without waiting out the five seconds.

## 5. Keyboard only

1. Tab to the SOS button on `/sos` or `/resident`. Hold Space or Enter for 2 seconds. Releasing early must not send.
2. On the countdown, press Space or Enter again to send now, or press Escape, or Shift+Tab to Cancel.
3. The chat panic control is `EmergencyButton` (`src/chat/components/common/EmergencyButton.jsx`). It is not mounted on a route. Hold Space or Enter on that button for 2 seconds: progress is announced with `aria-live="assertive"` (“Holding emergency button. N percent.”). Releasing early resets it. Mouse and touch hold still work.
4. With “prefers-reduced-motion: reduce”, that panic button does not pulse or ping, and the resident SOS rings stay still.
5. On a threat banner, the dismiss control is named “Dismiss threat alert”, is at least 44×44 px, and a threat photo’s alt text names the person, the risk, and the sighting. `ActiveSosBanner` has no dismiss control and no photo; its button already has visible text.
