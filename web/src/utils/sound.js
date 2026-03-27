// src/utils/sound.js
let audioUnlocked = false;

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

function preloadSounds() {
  sounds.chat = new Audio('/sounds/notification.mp3');
  sounds.messageSent = new Audio('/sounds/message-sent.mp3');
  sounds.messageFailed = new Audio('/sounds/notification.mp3');
  sounds.patrolStart = new Audio('/sounds/patrol-start.mp3');
  sounds.patrolEnd = new Audio('/sounds/patrol-end.mp3');
  sounds.patrolWarning = new Audio('/sounds/patrol-warning.mp3');
  sounds.patrolAutoEnd = new Audio('/sounds/patrol-autoend.mp3');
  sounds.incidentNew = new Audio('/sounds/incident-new.mp3');
  sounds.patrolSigninNotification = new Audio('/sounds/patrolsigninNotification.mp3');
  sounds.voiceNote = new Audio('/sounds/voice-note.mp3');

  Object.values(sounds).forEach((audio) => {
    if (audio) {
      audio.volume = 0.5;
      audio.preload = 'auto'; // better than just load()
      audio.load();
    }
  });

  console.log('Sounds preloaded');
}

preloadSounds();

function playSound(audio, name) {
  if (!audio) {
    console.warn(`${name} sound not available (audio object missing)`);
    return;
  }

  // Reset to start in case it was partially played before
  audio.currentTime = 0;

  audio.play()
    .then(() => {
      if (!audioUnlocked) {
        audioUnlocked = true;
        console.log('✅ Audio context unlocked via user interaction');
      }
    })
    .catch((err) => {
      console.warn(`${name} sound playback failed:`, err.message);
    });
}

// ─── Normal sounds ──────────────────────────────────────────────
export function playVoiceNote() {
  playSound(sounds.voiceNote, 'Voice note');
}

export function playMessageFailed() {
  playSound(sounds.messageFailed, 'Message failed');
}

export function playMessageSent() {
  playSound(sounds.messageSent, 'Message sent');
}

export function playChatNotification() {
  playSound(sounds.chat, 'Chat notification');
}

export function playPatrolStart() {
  playSound(sounds.patrolStart, 'Patrol start (self)');
}

export function playPatrolEnd() {
  playSound(sounds.patrolEnd, 'Patrol end');
}

export function playPatrolWarning() {
  playSound(sounds.patrolWarning, 'Patrol warning');
}

export function playPatrolAutoEnd() {
  playSound(sounds.patrolAutoEnd, 'Patrol auto-end');
}

export function playIncidentNew() {
  playSound(sounds.incidentNew, 'Incident new');
}

export function playPatrolSigninNotification() {
  playSound(sounds.patrolSigninNotification, 'Patrol sign-in notification (others)');
}

// ─── Test / debug ───────────────────────────────────────────────
export function playTestSound() {
  if (sounds.chat) {
    playSound(sounds.chat, 'Test');
  } else {
    console.warn('Test sound not available – chat audio missing');
  }
}

// ─── Emergency sounds (non-looping or controllable) ─────────────
export function playEmergencyAlarm() {
  const audio = new Audio('/sounds/notification.mp3');
  audio.loop = true;
  audio.volume = 0.7;
  audio.play().catch((err) => console.warn('Emergency alarm error:', err));
  return {
    stop: () => {
      audio.pause();
      audio.currentTime = 0;
    },
  };
}

export function playAlertChime() {
  const audio = new Audio('/sounds/notification.mp3');
  audio.volume = 0.6;
  audio.play().catch((err) => console.warn('Alert chime error:', err));
}

export function playPanicSiren() {
  const audio = new Audio('/sounds/patrol-warning.mp3');
  audio.volume = 0.8;
  audio.play().catch((err) => console.warn('Panic siren error:', err));
  return {
    stop: () => {
      audio.pause();
      audio.currentTime = 0;
    },
  };
}