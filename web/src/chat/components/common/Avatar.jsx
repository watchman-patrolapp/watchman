// src/chat/components/common/Avatar.jsx
import React, { useState, useCallback } from 'react';
import { getInitials } from '../../utils/formatters';

export const Avatar = React.memo(function Avatar({ 
  name, 
  avatarUrl, 
  size = 'md', 
  isOnline = false 
}) {
  const [hasError, setHasError] = useState(false);
  
  const handleError = useCallback(() => setHasError(true), []);

  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
  };

  const sizeClass = sizeClasses[size] || sizeClasses.md;

  return (
    <div className={`relative flex-shrink-0 ${sizeClass}`}>
      {avatarUrl && !hasError && (
        <img
          src={avatarUrl}
          alt={`${name}'s avatar`}
          className={`${sizeClass} rounded-full object-cover border-2 border-white dark:border-gray-800 shadow-sm`}
          onError={handleError}
          loading="lazy"
        />
      )}
      
      {(hasError || !avatarUrl) && (
        <div className={`${sizeClass} rounded-full bg-gradient-to-br from-teal-500 to-purple-600 
          flex items-center justify-center font-bold text-white`}>
          {getInitials(name)}
        </div>
      )}
      
      {isOnline && (
        <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 
          border-2 border-white dark:border-gray-800 rounded-full" />
      )}
    </div>
  );
});