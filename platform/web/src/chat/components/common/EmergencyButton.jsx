// src/chat/components/common/EmergencyButton.jsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { FaExclamation, FaPhoneSlash } from 'react-icons/fa';

export default function EmergencyButton({ 
  onPanic, 
  disabled = false,
  size = 'lg',
}) {
  const [isPressed, setIsPressed] = useState(false);
  const [progress, setProgress] = useState(0);
  const pressTimerRef = useRef(null);
  const progressIntervalRef = useRef(null);

  const REQUIRED_PRESS_MS = 2000; // 2 seconds to prevent accidental triggers

  const endPress = useCallback(() => {
    clearTimeout(pressTimerRef.current);
    clearInterval(progressIntervalRef.current);
    setIsPressed(false);
    setProgress(0);
  }, []);

  const startPress = useCallback(() => {
    if (disabled) return;
    clearTimeout(pressTimerRef.current);
    clearInterval(progressIntervalRef.current);

    setIsPressed(true);
    setProgress(0);

    const startTime = Date.now();
    
    progressIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const newProgress = Math.min((elapsed / REQUIRED_PRESS_MS) * 100, 100);
      setProgress(newProgress);
    }, 50);

    pressTimerRef.current = setTimeout(() => {
      onPanic();
      endPress();
    }, REQUIRED_PRESS_MS);
  }, [disabled, endPress, onPanic]);

  useEffect(() => () => {
    clearTimeout(pressTimerRef.current);
    clearInterval(progressIntervalRef.current);
  }, []);

  const handleKeyDown = (event) => {
    if (disabled || event.repeat) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (!isPressed) startPress();
    }
  };

  const handleKeyUp = (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      endPress();
    }
  };

  const sizeClasses = {
    sm: 'w-12 h-12',
    md: 'w-16 h-16',
    lg: 'w-20 h-20',
    xl: 'w-24 h-24',
  };

  const iconSizes = {
    sm: 'w-5 h-5',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
    xl: 'w-10 h-10',
  };

  const announced = Math.min(100, Math.floor(progress / 25) * 25);
  const liveText = !isPressed
    ? ''
    : announced >= 100
      ? 'Sending emergency.'
      : `Holding emergency button. ${announced} percent.`;

  return (
    <div className="inline-flex flex-col items-center">
      <button
        type="button"
        className={`relative ${sizeClasses[size]} rounded-full bg-red-600 hover:bg-red-700 
          active:bg-red-800 text-white shadow-lg hover:shadow-xl motion-safe:transition-all motion-safe:duration-200
          flex items-center justify-center group focus:outline-none focus:ring-4 focus:ring-red-300
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${isPressed ? 'motion-safe:scale-95' : 'motion-safe:scale-100'}`}
        onMouseDown={startPress}
        onMouseUp={endPress}
        onMouseLeave={endPress}
        onTouchStart={startPress}
        onTouchEnd={endPress}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onBlur={endPress}
        disabled={disabled}
        aria-label="Emergency panic button. Hold for 2 seconds."
        aria-describedby="emergency-hold-status"
      >
        {/* Progress ring */}
        <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" aria-hidden="true">
          <circle
            cx="50%"
            cy="50%"
            r="48%"
            fill="none"
            stroke="rgba(255,255,255,0.3)"
            strokeWidth="4"
          />
          <circle
            cx="50%"
            cy="50%"
            r="48%"
            fill="none"
            stroke="white"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${progress * 3.02} 302`}
            className="motion-safe:transition-all motion-safe:duration-100"
          />
        </svg>

        <div className={`relative z-10 ${isPressed ? 'motion-safe:animate-pulse' : ''}`}>
          {isPressed ? (
            <FaPhoneSlash className={`${iconSizes[size]} rotate-12`} aria-hidden="true" />
          ) : (
            <FaExclamation className={`${iconSizes[size]} motion-safe:group-hover:scale-110 motion-safe:transition-transform`} aria-hidden="true" />
          )}
        </div>

        {isPressed && (
          <span className="absolute inset-0 rounded-full bg-white opacity-25 motion-safe:animate-ping" aria-hidden="true" />
        )}
      </button>
      <p
        aria-hidden="true"
        className="mt-1 min-h-[1.25rem] max-w-[10rem] text-center text-xs font-medium text-red-700 dark:text-red-300"
      >
        {isPressed ? `Hold… ${Math.round(progress)}%` : ''}
      </p>
      <p id="emergency-hold-status" aria-live="assertive" className="sr-only">
        {liveText}
      </p>
    </div>
  );
}
