import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FaArrowLeft, FaBell, FaBellSlash, FaVolumeUp, FaVolumeMute } from 'react-icons/fa';

export const ChatHeader = React.memo(function ChatHeader({
  isOnline,
  messageCount,
  isEmergencyMode,
  soundEnabled,
  onToggleSound,
  notificationsEnabled,
  onToggleNotifications,
}) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 flex-shrink-0">
      <button
        onClick={() => navigate('/dashboard')}
        className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 
          text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-300 transition text-sm font-medium"
      >
        <FaArrowLeft className="w-4 h-4" />
        Dashboard
      </button>

      <div className="text-center">
        <h1 className={`text-2xl font-bold flex items-center justify-center gap-2 ${
          isEmergencyMode ? 'text-red-600 dark:text-red-400 animate-pulse' : 'text-gray-900 dark:text-white'
        }`}>
          Emergency Chat
          <span className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`} />
        </h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {messageCount} messages • {isOnline ? 'Connected' : 'Offline'}
        </p>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onToggleSound}
          className={`p-2 rounded-full transition ${
            soundEnabled
              ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300'
              : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
          }`}
          title={soundEnabled ? 'Mute sound' : 'Enable sound'}
        >
          {soundEnabled ? <FaVolumeUp className="w-5 h-5" /> : <FaVolumeMute className="w-5 h-5" />}
        </button>

        {'Notification' in window && (
          <button
            onClick={onToggleNotifications}
            className={`p-2 rounded-full transition ${
              notificationsEnabled
                ? 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300'
                : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
            }`}
            title={notificationsEnabled ? 'Notifications on' : 'Enable notifications'}
          >
            {notificationsEnabled ? <FaBell className="w-5 h-5" /> : <FaBellSlash className="w-5 h-5" />}
          </button>
        )}
      </div>
    </div>
  );
});