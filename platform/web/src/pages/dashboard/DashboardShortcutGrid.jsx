import { FaBook, FaCalendarAlt, FaCar, FaClipboardList, FaFire, FaHome, FaInfoCircle, FaMapMarkerAlt, FaPhone, FaShieldAlt, FaToolbox, FaTrophy, FaUser } from 'react-icons/fa';

export default function DashboardShortcutGrid({
  canOpenHousehold,
  canUsePatrolSchedule,
  canUseIntelligence,
  canUseSosBoard,
  canVerifyResidents,
  canAccessAdmin,
  canUseCityHub,
  equipmentMine,
  equipmentBadge,
  pendingIncidentCount,
  pendingFeedbackCount,
  unreadCityHubCount,
  onNavigate,
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-8">
      {canOpenHousehold ? (
        <button type="button" onClick={() => onNavigate('/resident')} className="bento-tile-interactive p-3 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center justify-center gap-2 text-center">
          <FaHome className="text-teal-600 dark:text-teal-400 shrink-0" aria-hidden />
          <span>Resident Portal</span>
        </button>
      ) : null}
      {canUsePatrolSchedule ? (
        <button type="button" onClick={() => onNavigate('/schedule')} className="bento-tile-interactive p-3 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center justify-center gap-2 text-center">
          <FaCalendarAlt className="text-indigo-500 dark:text-indigo-400 shrink-0" aria-hidden />
          <span>Patrol schedule</span>
        </button>
      ) : null}
      <button type="button" onClick={() => onNavigate('/incidents')} className="bento-tile-interactive p-3 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center justify-center gap-2 text-center">
        <FaClipboardList className="text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden />
        <span>View incidents</span>
      </button>
      {canUseIntelligence ? (
        <button type="button" onClick={() => onNavigate('/hotspots')} className="bento-tile-interactive p-3 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center justify-center gap-2 text-center">
          <FaFire className="text-red-600 dark:text-red-400 shrink-0" aria-hidden />
          <span>Hotspots</span>
        </button>
      ) : null}
      <button type="button" onClick={() => onNavigate('/leaderboard')} className="bento-tile-interactive p-3 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center justify-center gap-2 text-center">
        <FaTrophy className="text-amber-500 shrink-0" aria-hidden />
        <span>Leaderboard</span>
      </button>
      {canUseSosBoard ? (
        <button type="button" onClick={() => onNavigate('/sos')} className="bento-tile-interactive p-3 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center justify-center gap-2 text-center">
          <FaPhone className="text-red-600 dark:text-red-400 shrink-0" aria-hidden />
          <span>SOS board</span>
        </button>
      ) : null}
      {canVerifyResidents && !canAccessAdmin ? (
        <button type="button" onClick={() => onNavigate('/admin/residents')} className="bento-tile-interactive p-3 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center justify-center gap-2 text-center">
          <FaUser className="text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden />
          <span>Verify residents</span>
        </button>
      ) : null}
      <button type="button" onClick={() => onNavigate('/vehicles')} className="bento-tile-interactive p-3 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center justify-center gap-2 text-center">
        <FaCar className="text-slate-600 dark:text-slate-300 shrink-0" aria-hidden />
        <span>Vehicles</span>
      </button>
      <button type="button" onClick={() => onNavigate(equipmentMine ? '/equipment/mine' : '/equipment')} className="bento-tile-interactive p-3 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center justify-center gap-2 text-center">
        <FaToolbox className="text-teal-600 dark:text-teal-400 shrink-0" aria-hidden />
        <span>Equipment</span>
        {equipmentBadge ? (
          <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white" aria-label={`${equipmentBadge} waiting`}>
            {equipmentBadge > 99 ? '99+' : equipmentBadge}
          </span>
        ) : null}
      </button>
      <button type="button" onClick={() => onNavigate('/guide')} className="bento-tile-interactive p-3 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center justify-center gap-2 text-center">
        <FaBook className="text-violet-600 dark:text-violet-400 shrink-0" aria-hidden />
        <span>Guide</span>
      </button>
      <button type="button" onClick={() => onNavigate('/about')} className="bento-tile-interactive p-3 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center justify-center gap-2 text-center">
        <FaInfoCircle className="text-sky-600 dark:text-sky-400 shrink-0" aria-hidden />
        <span>About</span>
      </button>
      {canAccessAdmin && (
        <button
          type="button"
          onClick={() => onNavigate('/admin')}
          className="relative bento-tile-interactive col-span-2 md:col-span-4 lg:col-span-5 p-3 text-sm font-semibold text-teal-700 dark:text-teal-300 flex items-center justify-center gap-2 text-center bg-teal-50/80 dark:bg-teal-950/40 border-teal-200/60 dark:border-teal-800/60"
        >
          <FaShieldAlt className="text-teal-600 dark:text-teal-400 shrink-0" aria-hidden />
          <span>Admin panel</span>
          {(pendingIncidentCount + pendingFeedbackCount) > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 sm:top-1 sm:right-2 bg-red-500 text-white text-xs font-bold rounded-full min-w-[1.25rem] h-5 px-1 flex items-center justify-center motion-safe:animate-pulse"
              aria-label={`${pendingIncidentCount} incident(s) pending, ${pendingFeedbackCount} feedback item(s) pending review`}
            >
              {(pendingIncidentCount + pendingFeedbackCount) > 99
                ? '99+'
                : pendingIncidentCount + pendingFeedbackCount}
            </span>
          )}
        </button>
      )}
      {canUseCityHub && (
        <button
          type="button"
          onClick={() => onNavigate('/city-hub')}
          className={`relative bento-tile-interactive col-span-2 md:col-span-4 lg:col-span-5 p-3 text-sm font-semibold flex items-center justify-center gap-2 text-center ${
            unreadCityHubCount > 0
              ? 'text-red-800 dark:text-red-200 bg-red-50/90 dark:bg-red-950/45 ring-2 ring-red-500/85 shadow-[0_0_12px_rgba(239,68,68,0.28)]'
              : 'text-rose-700 dark:text-rose-300 bg-rose-50/80 dark:bg-rose-950/40 border-rose-200/60 dark:border-rose-800/60'
          }`}
        >
          <FaMapMarkerAlt className={`shrink-0 ${unreadCityHubCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-rose-600 dark:text-rose-400'}`} aria-hidden />
          <span>City hub</span>
          {unreadCityHubCount > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 sm:top-1 sm:right-2 bg-red-500 text-white text-xs font-bold rounded-full min-w-[1.25rem] h-5 px-1 flex items-center justify-center motion-safe:animate-pulse"
              aria-label={`${unreadCityHubCount} unread City Hub post${unreadCityHubCount === 1 ? '' : 's'}`}
            >
              {unreadCityHubCount > 99 ? '99+' : unreadCityHubCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
