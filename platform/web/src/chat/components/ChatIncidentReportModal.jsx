import { lazy, Suspense } from 'react';

const IncidentPinPicker = lazy(() => import('./IncidentPinPicker'));

export const INCIDENT_TYPE_OPTIONS = [
  'Suspicious Activity',
  'Theft',
  'Vandalism',
  'Noise Complaint',
  'Suspicious Vehicle',
  'Assault',
  'Other',
];

export default function ChatIncidentReportModal({ draft, onChange, onClose, onSave }) {
  if (!draft) return null;

  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/50 p-3 sm:items-center">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-800">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">Compile Incident Report</h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Drafted from selected chat message. Save and continue chatting.
        </p>
        <div className="mt-3 space-y-2">
          <select
            value={draft.type}
            onChange={(e) => onChange((p) => ({ ...p, type: e.target.value }))}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          >
            {INCIDENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          <input
            value={draft.location}
            onChange={(e) => onChange((p) => ({ ...p, location: e.target.value }))}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            placeholder="Location"
          />
          <div className="rounded-lg border border-gray-200 p-2 dark:border-gray-600">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-gray-600 dark:text-gray-300">Optional: place location pin on map</p>
              <button
                type="button"
                onClick={() =>
                  onChange((p) => ({ ...p, showMapPicker: !p.showMapPicker }))
                }
                className="rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-gray-600"
              >
                {draft.showMapPicker ? 'Hide map' : 'Open map'}
              </button>
            </div>
            {Number.isFinite(Number(draft.pinLat)) && Number.isFinite(Number(draft.pinLng)) && (
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="text-[11px] text-teal-700 dark:text-teal-300">
                  Pin: {Number(draft.pinLat).toFixed(6)}, {Number(draft.pinLng).toFixed(6)}
                </p>
                <button
                  type="button"
                  onClick={() => onChange((p) => ({ ...p, pinLat: null, pinLng: null }))}
                  className="rounded-md border border-gray-300 px-2 py-0.5 text-[11px] dark:border-gray-600"
                >
                  Clear pin
                </button>
              </div>
            )}
            {draft.showMapPicker && (
              <div className="mt-2">
                <Suspense fallback={<div className="h-[180px] animate-pulse rounded-[10px] bg-gray-100 dark:bg-gray-700" />}>
                  <IncidentPinPicker
                    pin={
                      Number.isFinite(Number(draft.pinLat)) &&
                      Number.isFinite(Number(draft.pinLng))
                        ? { lat: Number(draft.pinLat), lng: Number(draft.pinLng) }
                        : null
                    }
                    onPick={({ lat, lng }) =>
                      onChange((p) => ({ ...p, pinLat: lat, pinLng: lng }))
                    }
                  />
                </Suspense>
                <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  Tap map to place or move the pin.
                </p>
              </div>
            )}
          </div>
          <input
            value={draft.suspectName}
            onChange={(e) => onChange((p) => ({ ...p, suspectName: e.target.value }))}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            placeholder="Suspect name (optional)"
          />
          <div>
            <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">
              When it happened
            </label>
            <div className="flex flex-wrap items-stretch gap-2">
              <input
                type="date"
                value={draft.incidentDate || ''}
                onChange={(e) => onChange((p) => ({ ...p, incidentDate: e.target.value }))}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
              <input
                type="time"
                value={draft.incidentTime || ''}
                onChange={(e) => onChange((p) => ({ ...p, incidentTime: e.target.value }))}
                className="w-[8.5rem] shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
            </div>
          </div>
          <textarea
            value={draft.description}
            onChange={(e) => onChange((p) => ({ ...p, description: e.target.value }))}
            className="h-32 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => void onSave()}
            className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700"
          >
            Save Incident
          </button>
        </div>
      </div>
    </div>
  );
}
