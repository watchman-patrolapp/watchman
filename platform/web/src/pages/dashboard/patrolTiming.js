/** Warn after this many seconds on patrol (2h). */
export const PATROL_WARNING_SECONDS = 7200;
/** Grace period after the 2h mark before auto-end if the patroller does not end (30m). Guide: total 2.5h. */
export const AUTO_CLOSE_EXTENSION_SECONDS = 1800;
/** Absolute patrol end from start_time = 2h + 30m (matches Guide / auto-end expectations). */
export const PATROL_MAX_ELAPSED_MS = (PATROL_WARNING_SECONDS + AUTO_CLOSE_EXTENSION_SECONDS) * 1000;

const soundThrottleRef = {};

export function playThrottled(key, fn, now = Date.now()) {
  if (!soundThrottleRef[key] || now - soundThrottleRef[key] > 1000) {
    fn();
    soundThrottleRef[key] = now;
  }
}

let audioUnlocked = false;
export function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buf = ctx.createBuffer(1, 1, 22050);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(0);
  ctx.resume();
}

export function formatPatrolClock(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function formatPatrolElapsed(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
