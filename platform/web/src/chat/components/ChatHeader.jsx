import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FaArrowLeft, FaShieldAlt, FaUserFriends } from 'react-icons/fa';
import { markChatVisited } from '../utils/markChatVisited';
import ThemeToggle from '../../components/ThemeToggle';
import { useAuth } from '../../auth/useAuth';
import { homePathForRole } from '../../auth/roleMatrix';
import { CHAT_CHANNEL_PATROL, CHAT_CHANNEL_RESIDENT } from '../utils/chatChannels';

export const ChatHeader = React.memo(function ChatHeader({
  isOnline,
  messageCount,
  isEmergencyMode,
  channel = CHAT_CHANNEL_PATROL,
  canSwitchChannels = false,
  neighbourUnread = 0,
  onChannelChange,
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const homePath = homePathForRole(user?.role, user?.platformRole);
  const onPatrol = channel === CHAT_CHANNEL_PATROL;
  const title = canSwitchChannels
    ? onPatrol
      ? 'Patrol ops'
      : 'Neighbours'
    : 'Chat with patrol';
  const subtitle = canSwitchChannels
    ? onPatrol
      ? 'Patrol ops only — residents cannot see this room'
      : 'Residents and patrol — replies stay here'
    : 'Patrol in your neighborhood can see this room';
  const titleColor = isEmergencyMode
    ? 'text-red-600 dark:text-red-400 animate-pulse'
    : onPatrol && canSwitchChannels
      ? 'text-amber-700 dark:text-amber-300'
      : 'text-teal-700 dark:text-teal-300';

  return (
    <div className="mb-3 flex-shrink-0 sm:mb-4">
      <div className="flex items-center justify-between gap-2 sm:gap-4">
        <button
          type="button"
          onClick={() => {
            void markChatVisited(null, channel);
            navigate(homePath);
          }}
          className="inline-flex items-center gap-2 px-3 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-300 transition text-sm font-medium"
        >
          <FaArrowLeft className="w-4 h-4" />
          Home
        </button>

        <h1 className={`min-w-0 text-lg sm:text-2xl font-bold flex items-center justify-center gap-2 ${titleColor}`}>
          <span className="truncate">{title}</span>
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isOnline ? 'bg-green-500' : 'bg-red-500'}`} />
        </h1>

        <div className="shrink-0">
          <ThemeToggle variant="toolbar" />
        </div>
      </div>

      {canSwitchChannels ? (
        <div className="mt-3 flex justify-center">
          <div
            className="inline-flex w-full max-w-md rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-gray-700 dark:bg-gray-900/70"
            role="tablist"
            aria-label="Chat rooms"
          >
            <button
              type="button"
              role="tab"
              aria-selected={onPatrol}
              onClick={() => onChannelChange?.(CHAT_CHANNEL_PATROL)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                onPatrol
                  ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/30 dark:bg-amber-500'
                  : 'text-amber-800/70 hover:bg-amber-50 hover:text-amber-900 dark:text-amber-200/70 dark:hover:bg-amber-950/40 dark:hover:text-amber-100'
              }`}
            >
              <FaShieldAlt className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Patrol ops
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!onPatrol}
              onClick={() => onChannelChange?.(CHAT_CHANNEL_RESIDENT)}
              className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                !onPatrol
                  ? 'bg-teal-600 text-white shadow-sm shadow-teal-600/30 dark:bg-teal-600'
                  : 'text-teal-800/70 hover:bg-teal-50 hover:text-teal-900 dark:text-teal-200/70 dark:hover:bg-teal-950/40 dark:hover:text-teal-100'
              }`}
            >
              <FaUserFriends className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Neighbours
              {neighbourUnread > 0 ? (
                <span className="absolute -right-0.5 -top-1 inline-flex min-w-[1.15rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4 text-white ring-2 ring-white dark:ring-gray-900">
                  {neighbourUnread > 99 ? '99+' : neighbourUnread}
                </span>
              ) : null}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-1.5 text-center">
        <p
          className={`text-xs ${
            onPatrol && canSwitchChannels
              ? 'text-amber-800/80 dark:text-amber-200/70'
              : 'text-teal-800/80 dark:text-teal-200/70'
          }`}
        >
          {subtitle}
        </p>
        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          {messageCount} messages • {isOnline ? 'Connected' : 'Offline'}
        </p>
      </div>
    </div>
  );
});
