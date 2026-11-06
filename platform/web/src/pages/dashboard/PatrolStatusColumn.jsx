import { FaPlay, FaStop } from 'react-icons/fa';
import UpcomingScheduledPatrollers from '../../components/patrol/UpcomingScheduledPatrollers';
import HouseholdsAwayCard from '../../components/patrol/HouseholdsAwayCard';
import PatrolShareBanner from '../../components/patrol/share/PatrolShareBanner';
import Button from '../../components/ui/Button';
import startPatrolIcon from '../../assets/start-patrol-icon.png';
import { formatPatrolClock } from './patrolTiming';

export default function PatrolStatusColumn({
  activePatrol,
  canDoPatrolOps,
  canUsePatrolSchedule,
  shareRefreshKey,
  onOpenShare,
  elapsed,
  loadingPatrol,
  onCheckIn,
  onCheckOut,
  upcomingScheduleRefresh,
}) {
  return (
    <div className={`lg:col-span-7 flex flex-col gap-4 min-h-0 h-full ${activePatrol ? 'lg:row-span-2' : ''}`}>
      {canDoPatrolOps ? (
        <PatrolShareBanner refreshKey={shareRefreshKey} onOpen={onOpenShare} />
      ) : null}
      <div className="shrink-0 min-h-0">
        <div className={`relative overflow-hidden rounded-2xl p-6 motion-safe:transition-all motion-safe:duration-300
          ${activePatrol
            ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25'
            : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-card'
          }
        `}>
          {activePatrol && (
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
          )}

          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-start gap-4">
              <div
                className={`w-14 h-14 shrink-0 rounded-2xl flex items-center justify-center text-2xl overflow-hidden
                ${activePatrol
                  ? 'bg-white/20 backdrop-blur-sm'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                }
              `}
              >
                {activePatrol ? (
                  <span className="text-white" aria-hidden>
                    ✓
                  </span>
                ) : (
                  <img
                    src={startPatrolIcon}
                    alt=""
                    className="h-full w-full object-cover"
                    width={128}
                    height={128}
                    decoding="async"
                  />
                )}
              </div>
              <div>
                <h2 className={`text-xl font-bold ${activePatrol ? 'text-white' : 'text-gray-900 dark:text-white'}`}>
                  {activePatrol ? 'Patrol Active' : 'Ready to Start'}
                </h2>
                {activePatrol && (
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-4xl font-mono font-bold tracking-tight">
                      {formatPatrolClock(elapsed)}
                    </span>
                    <span className="text-emerald-100 text-sm font-medium">elapsed</span>
                  </div>
                )}
                {!activePatrol && (
                  <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                    Start a patrol to begin tracking your route
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {activePatrol && canDoPatrolOps && (
                <Button type="button" variant="danger" onClick={() => onCheckOut(false)}>
                  <FaStop className="mr-2" aria-hidden /> End Patrol
                </Button>
              )}
              {!activePatrol && canDoPatrolOps && (
                <Button type="button" variant="success" onClick={onCheckIn} disabled={loadingPatrol}>
                  <FaPlay className="mr-2" aria-hidden /> Start Patrol
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {canUsePatrolSchedule ? (
        <UpcomingScheduledPatrollers
          className="lg:flex-1"
          refreshNonce={upcomingScheduleRefresh}
        />
      ) : null}
      <HouseholdsAwayCard />
    </div>
  );
}
