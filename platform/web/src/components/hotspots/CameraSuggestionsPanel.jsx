import { suggestionCopy } from '../../utils/cameraSuggestions';
import { upsertCameraCheck } from '../../utils/hotspotService';
import toast from 'react-hot-toast';

const STATUSES = [
  { id: 'checked', label: 'Checked' },
  { id: 'useful', label: 'Useful' },
  { id: 'nothing', label: 'Nothing' },
];

export default function CameraSuggestionsPanel({
  event,
  suggestions,
  checks,
  userId,
  onChecksChange,
}) {
  if (!event) return null;

  const checkFor = (cameraId) =>
    (checks || []).find((c) => c.camera_spot_id === cameraId && c.created_by === userId);

  const setStatus = async (cameraId, status) => {
    if (!userId) return;
    try {
      await upsertCameraCheck({ eventId: event.id, cameraId, userId, status });
      onChecksChange?.();
    } catch (err) {
      toast.error(err.message || 'Could not save check.');
    }
  };

  if (!suggestions.length) {
    return (
      <div className="mt-3 rounded-lg bg-gray-50 dark:bg-gray-900/60 p-3 text-sm text-gray-600 dark:text-gray-400">
        No cameras close enough to suggest. Add camera spots to get a time window to request footage.
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Suggested cameras (estimate)
      </h3>
      <p className="text-xs text-gray-500">
        Local ranking from distance, facing, and time — not live video AI. Ask the owner for this window.
      </p>
      <ul className="space-y-2">
        {suggestions.map((s) => {
          const mine = checkFor(s.camera.id);
          return (
            <li
              key={s.camera.id}
              className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-sm text-gray-900 dark:text-white">{s.camera.name}</p>
                  <p className="text-xs text-teal-700 dark:text-teal-400">{s.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{s.reason}</p>
                </div>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300 mt-2">{suggestionCopy(s, event)}</p>
              {userId && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {STATUSES.map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => void setStatus(s.camera.id, st.id)}
                      className={`px-2 py-1 text-xs rounded-md border ${
                        mine?.status === st.id
                          ? 'bg-teal-600 text-white border-teal-600'
                          : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
