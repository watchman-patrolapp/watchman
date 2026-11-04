/**
 * Single source of truth for chat/app sound files under public/sounds/.
 * Used by generate-placeholder-sounds.mjs and check-sound-assets.mjs.
 *
 * MP3 (not WAV): Android WebView and iOS Safari both play MP3, so no WAV
 * fallback is shipped. Emergency clips (panic-siren, emergency-alarm) are
 * encoded louder/clearer (160 kbps); UI cues are 96 kbps.
 */
export const SOUND_FILES = [
  'notification.mp3',
  'message-sent.mp3',
  'patrol-start.mp3',
  'patrol-end.mp3',
  'patrol-warning.mp3',
  'patrol-autoend.mp3',
  'incident-new.mp3',
  'patrolsigninNotification.mp3',
  'voice-note.mp3',
  'emergency-alarm.mp3',
  'alert-chime.mp3',
  'message-pop.mp3',
  'error-beep.mp3',
  'panic-siren.mp3',
];
