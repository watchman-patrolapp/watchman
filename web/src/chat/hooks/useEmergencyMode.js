// src/chat/hooks/useEmergencyMode.js
import { useState, useCallback, useRef, useEffect } from 'react';
import { APP_CONFIG } from '../utils/constants';

export const useEmergencyMode = (user, onPanic) => {
  const [isEmergencyMode, setIsEmergencyMode] = useState(false);
  const [lastEmergencyTime, setLastEmergencyTime] = useState(0);
  const clickSequenceRef = useRef([]);
  const timeoutRef = useRef(null);

  // Triple-click detection for panic button
  const handlePotentialPanic = useCallback(() => {
    const now = Date.now();
    clickSequenceRef.current.push(now);
    
    // Clear old clicks outside 1 second window
    clickSequenceRef.current = clickSequenceRef.current.filter(
      time => now - time < 1000
    );

    if (clickSequenceRef.current.length >= 3) {
      triggerPanic();
      clickSequenceRef.current = [];
    }

    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      clickSequenceRef.current = [];
    }, 1000);
  }, [triggerPanic]);

  const triggerPanic = useCallback(() => {
    const now = Date.now();
    if (now - lastEmergencyTime < APP_CONFIG.EMERGENCY_COOLDOWN_MS) {
      return; // Prevent spam
    }

    setLastEmergencyTime(now);
    setIsEmergencyMode(true);
    onPanic?.();
    
    // Auto-reset after 30 seconds
    setTimeout(() => setIsEmergencyMode(false), 30000);
  }, [lastEmergencyTime, onPanic]);

  // Shake detection for mobile
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let lastX = 0, lastY = 0, lastZ = 0;
    let moveCounter = 0;

    const handleMotion = (e) => {
      const acc = e.accelerationIncludingGravity;
      if (!acc) return;

      const delta = Math.abs(acc.x - lastX) + Math.abs(acc.y - lastY) + Math.abs(acc.z - lastZ);

      if (delta > 20) {
        moveCounter++;
        if (moveCounter >= 5) {
          triggerPanic();
          moveCounter = 0;
        }
      }

      lastX = acc.x;
      lastY = acc.y;
      lastZ = acc.z;
    };

    if (window.DeviceMotionEvent) {
      window.addEventListener('devicemotion', handleMotion);
    }

    return () => {
      window.removeEventListener('devicemotion', handleMotion);
    };
  }, [triggerPanic]);

  return {
    isEmergencyMode,
    triggerPanic,
    handlePotentialPanic,
    lastEmergencyTime,
  };
};