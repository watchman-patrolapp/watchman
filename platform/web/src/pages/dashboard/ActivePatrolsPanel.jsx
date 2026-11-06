import { FaClock, FaPhone, FaStopwatch } from 'react-icons/fa';
import VehicleIcon, { normalizeVehicleType, PatrolInfoIcon } from '../../components/VehicleIcon';
import { Avatar } from '../../chat/components/common/Avatar';
import ErrorState from '../../components/ui/ErrorState';
import Skeleton from '../../components/ui/Skeleton';
import { getVehicleDisplayText } from '../../utils/vehicleDisplay';
import { resolvePatrolAvatarUrl } from '../../utils/patrolAvatarUrl';
import { parsePatrolTime } from '../../utils/watchTime';
import { formatPatrolElapsed } from './patrolTiming';

export default function ActivePatrolsPanel({
  fetchAllError,
  fetchAllLoading,
  allActivePatrols,
  viewer,
  nowMs,
  onRetry,
  onPreviewPhoto,
}) {
  if (fetchAllError) {
    return (
      <div className="mb-6">
        <ErrorState
          title="Error loading active patrols"
          message={fetchAllError}
          onRetry={onRetry}
        />
      </div>
    );
  }

  if (fetchAllLoading) {
    return (
      <div className="mb-6 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-6 py-8 dark:border-amber-800/60 dark:bg-amber-950/20">
        <Skeleton lines={4} />
      </div>
    );
  }

  if (allActivePatrols.length === 0) return null;

  return (
    <div className="mb-8 rounded-2xl border border-green-200 dark:border-green-800 bg-green-50/90 dark:bg-green-950/25 shadow-soft overflow-hidden">
      <div className="px-6 py-4 border-b border-green-200/80 dark:border-green-800/80 bg-green-100/50 dark:bg-green-900/20">
        <h2 className="text-lg font-semibold text-green-900 dark:text-green-100">🟢 Currently on Patrol</h2>
      </div>
      <div className="p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {allActivePatrols.map((p) => {
            const started = parsePatrolTime(p.start_time);
            const elapsedSec = started ? Math.floor((nowMs - started.getTime()) / 1000) : 0;
            const vehicleType = normalizeVehicleType(p.vehicle_type, p.car_type);
            const vehicleColor = p.vehicle_color || 'gray';
            const vehicleDisplay = getVehicleDisplayText(
              p.vehicle_type,
              p.car_type,
              p.vehicle_make_model,
              p.vehicle_reg,
              p.reg_number
            );
            const patrolAvatarDisplayUrl = resolvePatrolAvatarUrl(p, viewer);

            return (
              <div
                key={p.user_id}
                className="rounded-xl border border-green-200 dark:border-green-800 bg-white/80 dark:bg-gray-900/60 p-4 shadow-sm"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    className="inline-flex items-center justify-center shrink-0 rounded-full border-0 bg-transparent p-0 m-0 appearance-none focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                    onClick={() =>
                      onPreviewPhoto({
                        name: p.user_name || 'Patrol',
                        imageUrl: patrolAvatarDisplayUrl,
                      })
                    }
                    aria-label={`View photo of ${p.user_name || 'patroller'}`}
                  >
                    <Avatar name={p.user_name || 'Patrol'} avatarUrl={patrolAvatarDisplayUrl} size="sm" />
                  </button>
                  <p className="font-semibold text-gray-900 dark:text-white truncate">{p.user_name}</p>
                </div>
                <div className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-400">
                  <div className="flex items-center gap-1.5">
                    <VehicleIcon type={vehicleType} color={vehicleColor} size="sm" />
                    <span>{vehicleDisplay}</span>
                  </div>
                  {(p.patroller_phone || '').trim() ? (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <PatrolInfoIcon icon={FaPhone} colorKey={vehicleColor} />
                      <span className="truncate">{p.patroller_phone}</span>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <PatrolInfoIcon icon={FaClock} colorKey={vehicleColor} />
                    <span>Started: {started ? started.toLocaleTimeString() : '—'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <PatrolInfoIcon icon={FaStopwatch} colorKey={vehicleColor} />
                    <span>Elapsed: {formatPatrolElapsed(elapsedSec)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
