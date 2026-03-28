import { useState } from 'react';
import { FaVolumeUp, FaVolumeMute } from 'react-icons/fa';
import { playTestSound } from '../utils/sound';

// Safe localStorage helpers — won't throw in restricted environments
const getSoundEnabled = () => {
  try {
    const stored = localStorage.getItem('soundEnabled');
    // Default to TRUE on first visit — sound alerts are critical for this app
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
};

const setSoundEnabled = (value) => {
  try {
    localStorage.setItem('soundEnabled', String(value));
  } catch {
    // Silently ignore if localStorage is unavailable
  }
};

export default function SoundToggle() {
  // Lazy initialiser — only reads localStorage once on mount, not on every render
  const [soundEnabled, setSoundState] = useState(() => getSoundEnabled());

  const toggleSound = () => {
    const newState = !soundEnabled;
    setSoundState(newState);
    setSoundEnabled(newState);
    if (newState) {
      // User-triggered action — browser will allow audio playback here
      playTestSound();
    }
  };

  return (
    <button
      onClick={toggleSound}
      className="p-1 rounded-full text-white hover:bg-teal-500 transition"
      title={soundEnabled ? 'Sound on (click to mute)' : 'Sound off (click to enable)'}
      aria-label={soundEnabled ? 'Mute sounds' : 'Enable sounds'}
      aria-pressed={soundEnabled}
    >
      {soundEnabled
        ? <FaVolumeUp className="w-5 h-5" />
        : <FaVolumeMute className="w-5 h-5" />
      }
    </button>
  );
}