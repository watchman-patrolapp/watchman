// src/chat/hooks/useSound.js
import { useCallback, useEffect, useRef } from 'react';

// Sound file paths - adjust to your actual files
const SOUNDS = {
  emergency: '/sounds/emergency-alarm.mp3',
  alert: '/sounds/alert-chime.mp3',
  standard: '/sounds/message-pop.mp3',
  sent: '/sounds/message-sent.mp3',
  failed: '/sounds/error-beep.mp3',
  panic: '/sounds/panic-siren.mp3',
};

export const useSound = () => {
  const audioRefs = useRef({});
  const fadeTimersRef = useRef(new Set());

  useEffect(() => () => {
    for (const id of fadeTimersRef.current) window.clearInterval(id);
    fadeTimersRef.current.clear();
  }, []);

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
          const fade = window.setInterval(() => {
            if (audio.volume > step) {
              audio.volume -= step;
            } else {
              audio.pause();
              window.clearInterval(fade);
              fadeTimersRef.current.delete(fade);
            }
          }, 100);
          fadeTimersRef.current.add(fade);
        },
      };
    } catch (e) {
      console.error('Sound play failed:', e);
      return { stop: () => {}, fadeOut: () => {} };
    }
  }, []);

  const stopAll = useCallback(() => {
    for (const id of fadeTimersRef.current) window.clearInterval(id);
    fadeTimersRef.current.clear();
    Object.values(audioRefs.current).forEach(audio => {
      audio.pause();
      audio.currentTime = 0;
    });
  }, []);

  return { play, stopAll };
};