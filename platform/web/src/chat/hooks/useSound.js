// src/chat/hooks/useSound.js
import { useCallback, useRef } from 'react';

// Sound file paths - adjust to your actual files
const SOUNDS = {
  emergency: '/sounds/emergency-alarm.wav',
  alert: '/sounds/alert-chime.wav',
  standard: '/sounds/message-pop.wav',
  sent: '/sounds/message-sent.wav',
  failed: '/sounds/error-beep.wav',
  panic: '/sounds/panic-siren.wav',
};

export const useSound = () => {
  const audioRefs = useRef({});

  const play = useCallback((soundName, options = {}) => {
    const { loop = false, volume = 1 } = options;
    
    try {
      let audio = audioRefs.current[soundName];
      
      if (!audio) {
        audio = new Audio(SOUNDS[soundName]);
        audioRefs.current[soundName] = audio;
      }

      audio.currentTime = 0;
      audio.volume = volume;
      audio.loop = loop;
      
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Auto-play prevented, ignore
        });
      }

      return {
        stop: () => {
          audio.pause();
          audio.currentTime = 0;
        },
        fadeOut: (duration = 1000) => {
          const step = audio.volume / (duration / 100);
          const fade = setInterval(() => {
            if (audio.volume > step) {
              audio.volume -= step;
            } else {
              audio.pause();
              clearInterval(fade);
            }
          }, 100);
        },
      };
    } catch (e) {
      console.error('Sound play failed:', e);
      return { stop: () => {}, fadeOut: () => {} };
    }
  }, []);

  const stopAll = useCallback(() => {
    Object.values(audioRefs.current).forEach(audio => {
      audio.pause();
      audio.currentTime = 0;
    });
  }, []);

  return { play, stopAll };
};