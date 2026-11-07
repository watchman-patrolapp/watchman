import { FaTrash, FaClock, FaPhone, FaStopwatch } from "react-icons/fa";
import VehicleIcon, { normalizeVehicleType, PatrolInfoIcon } from '../../VehicleIcon';
import ShareStatusBadge from '../../patrol/share/ShareStatusBadge';
import { getVehicleDisplayText } from '../../../utils/vehicleDisplay';
import { resolvePatrolAvatarUrl } from '../../../utils/patrolAvatarUrl';
import { Avatar } from '../../../chat/components/common/Avatar';
import BrandedLoader from '../../layout/BrandedLoader';
import { displayPatrolZone } from '../../../config/neighborhoodRegions';
import { parsePatrolTime } from '../../../utils/watchTime';
import { SectionCard, InlineConfirm } from './AdminDashboardWidgets';

export function OnPatrolSection({
  activePatrolsError,
  fetchActivePatrols,
  activePatrols,
  user,
  setPatrolPhotoPreview,
  confirmEnd,
  setConfirmEnd,
  handleForceEnd,
  formatElapsed,
}) {
  return (
    <div className="mb-8 rounded-2xl border border-green-200 dark:border-green-800 bg-green-50/90 dark:bg-green-950/25 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-green-200/80 dark:border-green-800/80 bg-green-100/50 dark:bg-green-900/20">
        <h2 className="text-lg font-semibold text-green-900 dark:text-green-100">🟢 Currently on Patrol</h2>
      </div>
      <div className="p-4 sm:p-5">
        {activePatrolsError ? (
          <div className="text-center">
            <p className="text-red-600 dark:text-red-400 mb-2">{activePatrolsError}</p>
            <button type="button" onClick={fetchActivePatrols} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Retry</button>
          </div>
        ) : activePatrols.length === 0 ? (
          <p className="text-gray-600 dark:text-gray-400 text-center py-2">No active patrols.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activePatrols.map((p) => {
              const started = parsePatrolTime(p.start_time);
              const elapsedSec = started
                // eslint-disable-next-line react-hooks/purity -- same elapsed display as pre-split AdminDashboard (not live-ticking)
                ? Math.max(0, Math.floor((Date.now() - started.getTime()) / 1000))
                : 0;
              const vehicleType = normalizeVehicleType(p.vehicle_type, p.car_type);
              const vehicleColor = p.vehicle_color || 'gray';
              const vehicleDisplay = getVehicleDisplayText(
                p.vehicle_type,
                p.car_type,
                p.vehicle_make_model,
                p.vehicle_reg,
                p.reg_number
              );
              const patrolAvatarDisplayUrl = resolvePatrolAvatarUrl(p, user);

              return (
                <div
                  key={p.user_id}
                  className="relative rounded-xl border border-green-200 dark:border-green-800 bg-white/80 dark:bg-gray-900/60 p-4 shadow-sm"
                >
                  <div className="flex items-center gap-1.5 min-w-0 pr-10">
                    <button
                      type="button"
                      className="inline-flex items-center justify-center shrink-0 rounded-full border-0 bg-transparent p-0 m-0 appearance-none focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                      onClick={() =>
                        setPatrolPhotoPreview({
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
                      <span>Started: {started ? started.toLocaleTimeString('en-ZA') : '—'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <PatrolInfoIcon icon={FaStopwatch} colorKey={vehicleColor} />
                      <span>Elapsed: {formatElapsed(elapsedSec)}</span>
                    </div>
                    {p.share_tracked && p.share_ref ? (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{p.share_ref}</span>
                        <ShareStatusBadge label="Sign-on" sharedAt={p.start_shared_at} />
                      </div>
                    ) : null}
                  </div>
                  <div className="absolute top-3 right-3">
                    {confirmEnd === p.user_id ? (
                      <InlineConfirm
                        label="End?"
                        onConfirm={() => handleForceEnd(p)}
                        onCancel={() => setConfirmEnd(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmEnd(p.user_id)}
                        className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition"
                        title="Force-end patrol"
                        aria-label={`Force end patrol for ${p.user_name}`}
                      >
                        <FaTrash size={12} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function TopVolunteersSection({ logsError, refetchLogs, volunteerList, formatDuration }) {
  return (
    <SectionCard title="🏆 Top Volunteers">
      {logsError ? (
        <div className="text-center">
          <p className="text-red-600 dark:text-red-400 mb-2">{logsError}</p>
          <button onClick={refetchLogs} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Retry</button>
        </div>
      ) : volunteerList.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-center">No patrol data yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                {['Rank', 'Volunteer', 'Patrols', 'Total time', 'Avg duration'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {volunteerList.map((v, i) => (
                <tr key={v.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`font-bold ${i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-amber-600' : 'text-gray-400 dark:text-gray-500'}`}>
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-900 dark:text-white">{v.displayName}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">{v.patrols}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">{formatDuration(v.totalMinutes)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">
                    {formatDuration(Math.round(v.totalMinutes / v.patrols))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

export function RecentActivitySection({
  recentActivityError,
  fetchRecentActivity,
  recentActivityLoading,
  recentActivity,
  formatDuration,
}) {
  return (
    <SectionCard title="📋 Recent Patrol Activity (last 24h)">
      {recentActivityError ? (
        <div className="text-center">
          <p className="text-red-600 dark:text-red-400 mb-2">{recentActivityError}</p>
          <button onClick={fetchRecentActivity} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Retry</button>
        </div>
      ) : recentActivityLoading ? (
        <div className="flex justify-center py-8">
          <BrandedLoader message="Loading recent activity…" size="md" />
        </div>
      ) : recentActivity.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-center">No activity in the last 24 hours.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                {['Volunteer', 'Start', 'End', 'Duration', 'Status', 'Vehicle'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {recentActivity.map(item => {
                // 🔑 Same robust logic for recent activity table
                const vehicleType = normalizeVehicleType(item.vehicle_type, item.car_type);
                const vehicleColor = item.vehicle_color || 'gray';
                const vehicleDisplay = getVehicleDisplayText(
                  item.vehicle_type,
                  item.car_type,
                  item.vehicle_make_model,
                  item.vehicle_reg,
                  item.reg_number
                );
                const rowKey =
                  item.type === 'active'
                    ? `active-${item.user_id}`
                    : `completed-${item.id ?? `${item.user_id}-${item.start_time}`}`;

                return (
                  <tr key={rowKey} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-900 dark:text-white">{item.user_name}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">{parsePatrolTime(item.start_time)?.toLocaleString('en-ZA') || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">{item.end_time ? (parsePatrolTime(item.end_time)?.toLocaleString('en-ZA') || '—') : '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">{item.duration_minutes ? formatDuration(item.duration_minutes) : item.type === 'active' ? 'Active' : '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${item.type === 'active' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                        {item.type === 'active' ? 'Active' : 'Completed'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <VehicleIcon type={vehicleType} color={vehicleColor} size="sm" />
                        <span className="text-gray-500 dark:text-gray-400">{vehicleDisplay}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

export function PatrolSlotsSection({
  slotsError,
  refetchSlots,
  patrolSlots,
  todayLocal,
  confirmDelete,
  setConfirmDelete,
  handleDeleteSlot,
}) {
  return (
    <SectionCard
      title="Patrol signups (today & upcoming)"
      subtitle={`Past dates hidden · from ${todayLocal}`}
    >
      {slotsError ? (
        <div className="text-center">
          <p className="text-red-600 dark:text-red-400 mb-2">{slotsError}</p>
          <button onClick={refetchSlots} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Retry</button>
        </div>
      ) : patrolSlots?.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-center">No signups found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                {['Date', 'Time', 'Zone', 'Volunteer', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {patrolSlots.map(slot => (
                <tr key={slot.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                  <td className="px-4 py-3 whitespace-nowrap text-gray-900 dark:text-gray-200">{slot.date}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">{slot.start_time}–{slot.end_time}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">{displayPatrolZone(slot.zone) || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">{slot.volunteer_name || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {confirmDelete === slot.id ? (
                      <InlineConfirm
                        onConfirm={() => handleDeleteSlot(slot.id)}
                        onCancel={() => setConfirmDelete(null)}
                      />
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(slot.id)}
                        className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs transition"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
