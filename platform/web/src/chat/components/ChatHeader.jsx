import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FaArrowLeft, FaShieldAlt, FaUserFriends } from 'react-icons/fa';
import { markChatVisited } from '../utils/markChatVisited';
import ThemeToggle from '../../components/ThemeToggle';
import { useAuth } from '../../auth/useAuth';
import { homePathForRole } from '../../auth/roleMatrix';
import { CHAT_CHANNEL_PATROL, CHAT_CHANNEL_RESIDENT } from '../utils/chatChannels';

function RoomUnreadPill({ count, tone }) {
  if (!count || count <= 0) return null;
  const label = count > 99 ? '99+' : String(count);
  const toneClass =
    tone === 'ops'
      ? 'bg-amber-500 text-white ring-amber-200/80 dark:ring-amber-900/60'
      : 'bg-teal-600 text-white ring-teal-200/80 dark:ring-teal-900/60';
  return (
    <span
      className={`ml-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none shadow-sm ring-2 ring-offset-0 ${toneClass}`}
      aria-label={`${label} unread`}
    >
      {label}
    </span>
  );
}

export const ChatHeader = React.memo(function ChatHeader({
  isOnline,
  messageCount,
  isEmergencyMode,
  channel = CHAT_CHANNEL_PATROL,
  canSwitchChannels = false,
  patrolUnread = 0,
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
      ? 'Watch-only room — residents cannot see these messages'
      : 'Shared with residents — keep replies in this room'
    : 'Patrol in your neighborhood can see this room';
  const titleColor = isEmergencyMode
    ? 'text-red-600 dark:text-red-400 animate-pulse'
    : onPatrol && canSwitchChannels
      ? 'text-amber-800 dark:text-amber-200'
      : 'text-teal-800 dark:text-teal-200';

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
            className="inline-flex w-full max-w-lg rounded-2xl border border-black/5 bg-gradient-to-b from-white to-gray-50 p-1 shadow-sm dark:border-white/10 dark:from-gray-900 dark:to-gray-950"
            role="tablist"
            aria-label="Chat rooms — Patrol ops and Neighbours are separate"
          >
            <button
              type="button"
              role="tab"
              aria-selected={onPatrol}
              aria-label={
                patrolUnread > 0
                  ? `Patrol ops, ${patrolUnread} unread`
                  : 'Patrol ops'
              }
              onClick={() => onChannelChange?.(CHAT_CHANNEL_PATROL)}
              className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                onPatrol
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-500/25'
                  : 'text-amber-900/65 hover:bg-amber-500/10 hover:text-amber-950 dark:text-amber-100/70 dark:hover:bg-amber-400/10 dark:hover:text-amber-50'
              }`}
            >
              <FaShieldAlt className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
              <span>Patrol ops</span>
              <RoomUnreadPill count={onPatrol ? 0 : patrolUnread} tone="ops" />
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!onPatrol}
              aria-label={
                neighbourUnread > 0
                  ? `Neighbours, ${neighbourUnread} unread`
                  : 'Neighbours'
              }
              onClick={() => onChannelChange?.(CHAT_CHANNEL_RESIDENT)}
              className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                !onPatrol
                  ? 'bg-teal-600 text-white shadow-md shadow-teal-600/25'
                  : 'text-teal-900/65 hover:bg-teal-600/10 hover:text-teal-950 dark:text-teal-100/70 dark:hover:bg-teal-400/10 dark:hover:text-teal-50'
              }`}
            >
              <FaUserFriends className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
              <span>Neighbours</span>
              <RoomUnreadPill count={!onPatrol ? 0 : neighbourUnread} tone="neighbours" />
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
