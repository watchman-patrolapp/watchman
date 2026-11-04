// src/utils/sound.js
import { devLog, devWarn } from './devLog';

let audioUnlocked = false;

/**
 * MP3 everywhere. Android WebView and iOS Safari both play it, so there is no WAV fallback.
 * Clip choices match the previous WAV mapping; only the container changed.
 */
const SOUND_SRC = {
  chat: '/sounds/notification.mp3',
  messageSent: '/sounds/message-sent.mp3',
  messageFailed: '/sounds/notification.mp3',
  patrolStart: '/sounds/patrol-start.mp3',
  patrolEnd: '/sounds/patrol-end.mp3',
  patrolWarning: '/sounds/patrol-warning.mp3',
  patrolAutoEnd: '/sounds/patrol-autoend.mp3',
  incidentNew: '/sounds/incident-new.mp3',
  patrolSigninNotification: '/sounds/patrolsigninNotification.mp3',
  voiceNote: '/sounds/voice-note.mp3',
};

/**
 * Startup preload is only the hot path plus the SOS clip.
 * Chat notification and message-sent are played constantly.
 * playPanicSiren() uses patrol-warning and must already be buffered: the call
 * often runs after an awaited geolocation, so play() stays synchronous for the
 * iOS Safari / Android WebView autoplay unlock. Its element is separate from
 * the lazy patrol-warning cue so stop() does not cut that sound off.
 * The long panic-siren / emergency-alarm files load on first play (see useSound).
 */
const PRELOAD_KEYS = ['chat', 'messageSent'];

const sounds = {
  chat: null,
  messageSent: null,
  messageFailed: null,
  patrolStart: null,
  patrolEnd: null,
  patrolWarning: null,
  patrolAutoEnd: null,
  incidentNew: null,
  patrolSigninNotification: null,
  voiceNote: null,
};

/** Dedicated, preloaded element for playPanicSiren() (same clip: patrol-warning). */
let panicAudio = null;

function createAudio(src, preload) {
  const audio = new Audio(src);
  audio.volume = 0.5;
  audio.preload = preload ? 'auto' : 'none';
  if (preload) audio.load();
  return audio;
}

function safeRewind(audio) {
  if (!audio || audio.readyState < 1) return;
  try {
    audio.currentTime = 0;
  } catch {
    // Not seekable until metadata arrives. play() still starts at the beginning.
  }
}

/** Create on first play. play() is still called in the same turn (no canplay wait). */
function getSound(key) {
  if (!sounds[key]) {
    sounds[key] = createAudio(SOUND_SRC[key], true);
  }
  return sounds[key];
}

function preloadSounds() {
  PRELOAD_KEYS.forEach((key) => {
    sounds[key] = createAudio(SOUND_SRC[key], true);
  });
  panicAudio = createAudio(SOUND_SRC.patrolWarning, true);
  panicAudio.volume = 0.8;
  devLog('Sounds preloaded:', [...PRELOAD_KEYS, 'panic'].join(', '));
}

preloadSounds();

function markUnlocked() {
  if (!audioUnlocked) {
    audioUnlocked = true;
    devLog('Audio context unlocked via user interaction');
  }
}

function playSound(audio, name) {
  if (!audio) {
    devWarn(`${name} sound not available (audio object missing)`);
    return;
  }

  safeRewind(audio);

  const pending = audio.play();
  if (pending && typeof pending.then === 'function') {
    pending
      .then(() => {
        markUnlocked();
      })
      .catch((err) => {
        devWarn(`${name} sound playback failed:`, err.message);
      });
  }
}

function playKeyed(key, name) {
  const audio = getSound(key);
  audio.loop = false;
  audio.volume = 0.5;
  playSound(audio, name);
}

// ─── Normal sounds ──────────────────────────────────────────────
export function playVoiceNote() {
  playKeyed('voiceNote', 'Voice note');
}

export function playMessageFailed() {
  playKeyed('messageFailed', 'Message failed');
}

export function playMessageSent() {
  playKeyed('messageSent', 'Message sent');
}

export function playChatNotification() {
  playKeyed('chat', 'Chat notification');
}

export function playPatrolStart() {
  playKeyed('patrolStart', 'Patrol start (self)');
}

export function playPatrolEnd() {
  playKeyed('patrolEnd', 'Patrol end');
}

export function playPatrolWarning() {
  playKeyed('patrolWarning', 'Patrol warning');
}

export function playPatrolAutoEnd() {
  playKeyed('patrolAutoEnd', 'Patrol auto-end');
}

export function playIncidentNew() {
  playKeyed('incidentNew', 'Incident new');
}

export function playPatrolSigninNotification() {
  playKeyed('patrolSigninNotification', 'Patrol sign-in notification (others)');
}

// ─── Test / debug ───────────────────────────────────────────────
export function playTestSound() {
  if (sounds.chat) {
    playSound(sounds.chat, 'Test');
  } else {
    devWarn('Test sound not available – chat audio missing');
  }
}

// ─── Emergency sounds (non-looping or controllable) ─────────────
export function playEmergencyAlarm() {
  // Separate element so looping does not take over the chat notification.
  const audio = new Audio(SOUND_SRC.chat);
  audio.loop = true;
  audio.volume = 0.7;
  const pending = audio.play();
  if (pending && typeof pending.catch === 'function') {
    pending.catch((err) => devWarn('Emergency alarm error:', err));
  }
  return {
    stop: () => {
      audio.pause();
      safeRewind(audio);
    },
  };
}

export function playAlertChime() {
  const audio = new Audio(SOUND_SRC.chat);
  audio.volume = 0.6;
  const pending = audio.play();
  if (pending && typeof pending.catch === 'function') {
    pending.catch((err) => devWarn('Alert chime error:', err));
  }
}

export function playPanicSiren() {
  // Preloaded patrol-warning element (same clip as before). play() is synchronous
  // so a user gesture is not dropped while the file fetches.
  const audio = panicAudio || createAudio(SOUND_SRC.patrolWarning, true);
  if (!panicAudio) panicAudio = audio;
  audio.loop = false;
  audio.volume = 0.8;
  safeRewind(audio);
  const pending = audio.play();
  if (pending && typeof pending.then === 'function') {
    pending
      .then(() => {
        markUnlocked();
      })
      .catch((err) => devWarn('Panic siren error:', err));
  }
  return {
    stop: () => {
      audio.pause();
      safeRewind(audio);
    },
  };
}
