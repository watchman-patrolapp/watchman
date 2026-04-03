// src/chat/components/common/EmergencyButton.jsx
import React, { useState, useCallback, useRef } from 'react';
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

  const startPress = useCallback(() => {
    if (disabled) return;
    
    setIsPressed(true);
    setProgress(0);

    const startTime = Date.now();
    
    progressIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const newProgress = Math.min((elapsed / REQUIRED_PRESS_MS) * 100, 100);
      setProgress(newProgress);
    }, 50);

    pressTimerRef.current = setTimeout(() => {
      // Trigger panic
      onPanic();
      setIsPressed(false);
      setProgress(0);
    }, REQUIRED_PRESS_MS);
  }, [disabled, onPanic]);

  const endPress = useCallback(() => {
    clearTimeout(pressTimerRef.current);
    clearInterval(progressIntervalRef.current);
    setIsPressed(false);
    setProgress(0);
  }, []);

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

  return (
    <button
      className={`relative ${sizeClasses[size]} rounded-full bg-red-600 hover:bg-red-700 
        active:bg-red-800 text-white shadow-lg hover:shadow-xl transition-all duration-200
        flex items-center justify-center group focus:outline-none focus:ring-4 focus:ring-red-300
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${isPressed ? 'scale-95' : 'scale-100'}`}
      onMouseDown={startPress}
      onMouseUp={endPress}
      onMouseLeave={endPress}
      onTouchStart={startPress}
      onTouchEnd={endPress}
      disabled={disabled}
      aria-label="Emergency panic button - hold for 2 seconds"
    >
      {/* Progress ring */}
      <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none">
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
          className="transition-all duration-100"
        />
      </svg>

      <div className={`relative z-10 ${isPressed ? 'animate-pulse' : ''}`}>
        {isPressed ? (
          <FaPhoneSlash className={`${iconSizes[size]} rotate-12`} />
        ) : (
          <FaExclamation className={`${iconSizes[size]} group-hover:scale-110 transition-transform`} />
        )}
      </div>

      {/* Ripple effect */}
      {isPressed && (
        <span className="absolute inset-0 rounded-full bg-white opacity-25 animate-ping" />
      )}
    </button>
  );
}