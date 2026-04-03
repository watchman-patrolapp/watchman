import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FaArrowLeft } from 'react-icons/fa';
import { markChatVisited } from '../utils/markChatVisited';
import ThemeToggle from '../../components/ThemeToggle';

export const ChatHeader = React.memo(function ChatHeader({
  isOnline,
  messageCount,
  isEmergencyMode,
}) {
  const navigate = useNavigate();

  return (
    <div className="mb-4 flex-shrink-0">
      <div className="flex items-center justify-between gap-2 sm:gap-4">
        <button
          type="button"
          onClick={() => {
            void markChatVisited(null);
            navigate('/dashboard');
          }}
          className="inline-flex items-center gap-2 px-3 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-300 transition text-sm font-medium"
        >
          <FaArrowLeft className="w-4 h-4" />
          Dashboard
        </button>

        <h1
          className={`min-w-0 text-lg sm:text-2xl font-bold flex items-center justify-center gap-2 ${
            isEmergencyMode ? 'text-red-600 dark:text-red-400 animate-pulse' : 'text-gray-900 dark:text-white'
          }`}
        >
          <span className="truncate sm:hidden">Ops Chat</span>
          <span className="hidden sm:inline">Emergency Chat</span>
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isOnline ? 'bg-green-500' : 'bg-red-500'}`} />
        </h1>

        <div className="shrink-0">
          <ThemeToggle variant="toolbar" />
        </div>
      </div>

      <div className="mt-1 text-center">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {messageCount} messages • {isOnline ? 'Connected' : 'Offline'}
        </p>
      </div>
    </div>
  );
});