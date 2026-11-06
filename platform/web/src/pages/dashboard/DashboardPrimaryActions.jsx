import { OpsChatUnreadSplit } from '../../chat/components/OpsChatUnreadSplit';

export default function DashboardPrimaryActions({
  onReportIncident,
  onOpenChat,
  isOpsChat,
  patrolUnread,
  neighbourUnread,
  unreadCount,
  onOpenPatrolChat,
  onOpenNeighbourChat,
  canUseIntelligence,
  onOpenIntelligence,
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3 mb-4">
      <button
        type="button"
        onClick={onReportIncident}
        className="bento-tile-interactive flex flex-col items-center justify-center gap-2 min-h-[5.5rem] rounded-lg border-0 bg-gradient-to-br from-emerald-600 to-teal-600 text-white font-semibold p-4 shadow-lg shadow-emerald-900/20 hover:shadow-xl transition dark:from-emerald-700 dark:to-teal-800"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        <span className="text-sm text-center leading-tight">Report incident</span>
      </button>
      <div className="bento-tile-interactive relative flex flex-col items-center justify-center gap-2 min-h-[5.5rem] rounded-lg border-0 bg-gradient-to-br from-violet-600 to-purple-800 text-white font-semibold p-4 shadow-lg shadow-purple-900/25 hover:shadow-xl transition dark:from-violet-700 dark:to-purple-900">
        <button
          type="button"
          className="absolute inset-0 z-0 rounded-lg"
          onClick={onOpenChat}
          aria-label={
            isOpsChat
              ? `Open chat. Patrol ops ${patrolUnread} unread, Neighbours ${neighbourUnread} unread`
              : 'Open emergency chat'
          }
        />
        <div className="relative z-10 pointer-events-none flex flex-col items-center justify-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span className="text-sm text-center leading-tight">Emergency chat</span>
        </div>
        {isOpsChat ? (
          <div className="absolute top-2 right-2 z-20 max-w-[calc(100%-1rem)]">
            <OpsChatUnreadSplit
              patrolUnread={patrolUnread}
              neighbourUnread={neighbourUnread}
              size="sm"
              className="flex-wrap justify-end"
              onPatrolClick={onOpenPatrolChat}
              onNeighbourClick={onOpenNeighbourChat}
            />
          </div>
        ) : unreadCount > 0 ? (
          <span className="absolute top-2 right-2 z-20 bg-red-500 text-white text-xs font-bold rounded-full min-w-[1.25rem] h-5 px-1 flex items-center justify-center motion-safe:animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </div>
      {canUseIntelligence ? (
        <button
          type="button"
          onClick={onOpenIntelligence}
          className="bento-tile-interactive col-span-2 sm:col-span-1 flex flex-col items-center justify-center gap-2 min-h-[5.5rem] rounded-lg border-0 bg-gradient-to-br from-red-600 to-red-400 text-white font-semibold p-4 shadow-lg shadow-red-900/25 hover:shadow-xl transition dark:from-red-700 dark:to-red-600"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="text-sm text-center leading-tight">Intelligence</span>
        </button>
      ) : null}
    </div>
  );
}
