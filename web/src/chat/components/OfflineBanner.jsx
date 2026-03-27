// src/chat/components/OfflineBanner.jsx
import React from 'react';
import { FaWifi, FaSync } from 'react-icons/fa';

export const OfflineBanner = React.memo(function OfflineBanner({ 
  isOnline, 
  pendingCount, 
  onRetry,
  isProcessing,
}) {
  if (isOnline && pendingCount === 0) return null;

  return (
    <div className={`px-4 py-3 mb-3 rounded-xl flex items-center justify-between ${
      isOnline 
        ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200' 
        : 'bg-red-50 dark:bg-red-900/20 border border-red-200'
    }`}>
      <div className="flex items-center gap-2 text-sm">
        {isOnline ? (
          <FaSync className={`w-4 h-4 text-amber-600 ${isProcessing ? 'animate-spin' : ''}`} />
        ) : (
          <FaWifi className="w-4 h-4 text-red-600" />
        )}
        <span className={isOnline ? 'text-amber-800' : 'text-red-800'}>
          {isOnline 
            ? `${pendingCount} message${pendingCount !== 1 ? 's' : ''} syncing...` 
            : 'You are offline - messages queued'}
        </span>
      </div>
      {!isOnline && (
        <button 
          onClick={onRetry}
          className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700"
        >
          Retry Now
        </button>
      )}
    </div>
  );
});