import VehicleIcon, { normalizeVehicleType } from '../../components/VehicleIcon';
import { isLightMobilityVehicleType, getVehicleTypePublicLabel } from '../../utils/vehicleTypeConstants';
import { PATROL_MAX_ELAPSED_MS } from './patrolTiming';

export function PatrolWarningModal({
  showWarning,
  autoCloseAt,
  startTime,
  warningTriggeredRef,
  onDismissWarning,
  onScheduleAutoClose,
  onEndPatrol,
}) {
  if (!showWarning) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-sm w-full p-6">
        <h2 className="text-xl font-bold mb-4 dark:text-white">Patrol Time Warning</h2>
        <p className="text-gray-700 dark:text-gray-300 mb-4">You've been on patrol for 2 hours. Do you want to continue?</p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              onDismissWarning();
              if (autoCloseAt == null && startTime) {
                onScheduleAutoClose(startTime.getTime() + PATROL_MAX_ELAPSED_MS);
              }
              warningTriggeredRef.current = true;
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Continue
          </button>
          <button onClick={onEndPatrol} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">
            End Patrol
          </button>
        </div>
      </div>
    </div>
  );
}

export function VehiclePickerModal({
  open,
  vehicles,
  onPick,
  onClose,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
        <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Select Vehicle</h2>
        <div className="space-y-2">
          {vehicles.map(v => {
            const reg = v.registration?.trim();
            const norm = normalizeVehicleType(v.vehicle_type, v.make_model);
            const label = isLightMobilityVehicleType(v.vehicle_type)
              ? getVehicleTypePublicLabel(v.vehicle_type)
              : reg
                ? `${v.make_model}  (${reg})`
                : v.make_model;

            const subtitle = isLightMobilityVehicleType(v.vehicle_type)
              ? null
              : `${getVehicleTypePublicLabel(norm)} · ${v.color || 'unknown color'}`;

            return (
              <button
                key={v.id}
                onClick={() => onPick(v.id)}
                className="w-full text-left p-3 border border-gray-100 dark:border-gray-600 rounded-xl hover:bg-slate-50 dark:hover:bg-gray-700 transition"
              >
                <div className="flex items-center gap-3">
                  <div style={{
                    width: 36, height: 36,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: '50%',
                    backgroundColor: '#f1f5f9',
                    flexShrink: 0,
                  }}>
                    <VehicleIcon type={v.vehicle_type || 'car'} color={v.color} size="md" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 dark:text-white truncate">{label}</p>
                    {subtitle && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 capitalize">{subtitle}</p>
                    )}
                  </div>
                  {v.is_primary && (
                    <span className="ml-auto text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-full font-medium flex-shrink-0">
                      Primary
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        <button
          onClick={onClose}
          className="mt-4 w-full py-2 text-sm text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
