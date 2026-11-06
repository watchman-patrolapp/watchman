import { FaMapMarkerAlt, FaSync } from 'react-icons/fa';
import SoundToggle from '../../components/SoundToggle';
import ThemeToggle from '../../components/ThemeToggle';
import AppNotificationBell from '../../components/layout/AppNotificationBell';
import AreaWeatherChip from '../../components/layout/AreaWeatherChip';
import IconButton from '../../components/ui/IconButton';
import { formatPatrolPlaceLabel } from '../../config/neighborhoodRegions';
import appMark from '../../assets/app-mark.png';

export default function DashboardHeader({
  user,
  firstName,
  initials,
  todayDate,
  activeOrganization,
  isGlobalOperator,
  onRefresh,
  onOpenProfile,
  onChangeArea,
}) {
  return (
    <>
      <div className="mb-5 flex items-center gap-2 sm:gap-3 lg:gap-4">
        <img
          src={appMark}
          alt=""
          width={128}
          height={128}
          decoding="async"
          className="h-9 w-9 shrink-0 rounded-xl object-contain sm:h-10 sm:w-10 lg:h-11 lg:w-11"
        />
        <span className="text-base font-bold tracking-tight text-gray-900 dark:text-white sm:text-lg lg:text-xl">
          Watchman
        </span>
      </div>

      <div className="bg-gradient-to-r from-teal-600 to-teal-700 dark:from-teal-800 dark:to-teal-900 rounded-2xl shadow-xl overflow-hidden mb-6 motion-safe:transition-shadow">
        <div className="px-5 py-6 sm:px-8 sm:py-7">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-start space-x-4 min-w-0">
              <button type="button" onClick={onOpenProfile} aria-label={`Open profile for ${firstName}`} className="focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-full shrink-0">
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover ring-2 ring-white dark:ring-gray-300 shadow-md" />
                ) : (
                  <div className="h-16 w-16 rounded-full bg-white dark:bg-gray-200 text-teal-600 dark:text-teal-800 flex items-center justify-center text-2xl font-bold shadow-md">
                    {initials}
                  </div>
                )}
              </button>
              <div className="min-w-0">
                <h1 className="text-2xl sm:text-3xl font-bold text-white break-words">Welcome back, {firstName}!</h1>
                <p className="text-teal-100 text-sm mt-1">{todayDate}</p>
                <AreaWeatherChip
                  organizationId={activeOrganization?.id}
                  className="mt-1 text-white/90"
                />
                <p className="mt-2 flex items-start gap-1.5 text-sm font-medium text-white">
                  <FaMapMarkerAlt className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-100" aria-hidden />
                  <span className="min-w-0 break-words">{activeOrganization?.name || formatPatrolPlaceLabel()}</span>
                </p>
                {isGlobalOperator ? (
                  <button
                    type="button"
                    onClick={onChangeArea}
                    className="mt-2 inline-block bg-white/20 hover:bg-white/30 text-white text-xs px-2 py-1 rounded-full"
                  >
                    Change neighbourhood
                  </button>
                ) : null}
              </div>
            </div>
            <div className="flex space-x-3 shrink-0">
              <IconButton label="Refresh data" onClick={onRefresh} className="bg-white/20 text-white hover:bg-white/30 motion-safe:transition">
                <FaSync className="w-4 h-4" aria-hidden />
              </IconButton>
              <SoundToggle />
              <AppNotificationBell variant="brand" />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
