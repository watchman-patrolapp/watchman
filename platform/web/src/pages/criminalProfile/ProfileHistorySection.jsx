import { FaExclamationTriangle, FaPlus, FaTimes } from 'react-icons/fa';
import { FieldGuideExplainerLink } from '../../components/intelligence/IntelligenceFieldGuide';
import WatchlistTemplatePicker from '../../components/intelligence/WatchlistTemplatePicker';
import {
  CONVICTION_HISTORY_SUMMARY_OPTIONS,
  CRIMINAL_JUSTICE_STATUS_OPTIONS,
  LEGAL_RECORD_INTELLIGENCE_NOTE,
} from '../../data/intelligenceTaxonomy';
import { DETAIL_INPUT, DETAIL_SECTION } from './profileDetailClasses';

export default function ProfileHistorySection({
  isEditing,
  editForm,
  displayData,
  onUpdateField,
  onUpdateArrayField,
  onAddArrayItem,
  onRemoveArrayItem,
  onSetWatchlistFlags,
  onOpenFieldGuide,
}) {
  return (
    <section className={DETAIL_SECTION}>
      <h2 className="mb-4 flex items-center gap-2 border-b border-gray-200 pb-2 text-xl font-semibold text-red-700 dark:border-gray-700 dark:text-red-400">
        <FaExclamationTriangle /> Criminal History
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="text-sm text-gray-600 dark:text-gray-400">Gang Affiliation</label>
          {isEditing ? (
            <input
              type="text"
              value={editForm.gang_affiliation || ''}
              onChange={(e) => onUpdateField('gang_affiliation', e.target.value || null)}
              className={DETAIL_INPUT}
            />
          ) : (
            <p className="font-medium text-red-600 dark:text-red-400">{displayData.gang_affiliation || '-'}</p>
          )}
        </div>

        <div>
          <label className="text-sm text-gray-600 dark:text-gray-400">Criminal Organization</label>
          {isEditing ? (
            <input
              type="text"
              value={editForm.criminal_organization || ''}
              onChange={(e) => onUpdateField('criminal_organization', e.target.value || null)}
              className={DETAIL_INPUT}
            />
          ) : (
            <p className="font-medium dark:text-gray-100">{displayData.criminal_organization || '-'}</p>
          )}
        </div>
      </div>

      <p className="mb-4 rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100/90">
        {LEGAL_RECORD_INTELLIGENCE_NOTE}
      </p>

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="text-sm text-gray-600 dark:text-gray-400">Prior convictions (this file)</label>
          {isEditing ? (
            <select
              value={editForm.conviction_history_summary || 'unknown'}
              onChange={(e) => onUpdateField('conviction_history_summary', e.target.value)}
              className={DETAIL_INPUT}
            >
              {CONVICTION_HISTORY_SUMMARY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <p className="mt-1 font-medium dark:text-gray-100">
              {CONVICTION_HISTORY_SUMMARY_OPTIONS.find(
                (o) => o.value === (displayData.conviction_history_summary || 'unknown')
              )?.label ?? '—'}
            </p>
          )}
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {CONVICTION_HISTORY_SUMMARY_OPTIONS.find(
              (o) =>
                o.value ===
                ((isEditing ? editForm.conviction_history_summary : displayData.conviction_history_summary) ||
                  'unknown')
            )?.hint ?? 'What this file records about previous convictions.'}
          </p>
        </div>
        <div>
          <label className="text-sm text-gray-600 dark:text-gray-400">
            Criminal justice / prosecution status
          </label>
          {isEditing ? (
            <select
              value={editForm.criminal_justice_status || 'unknown'}
              onChange={(e) => onUpdateField('criminal_justice_status', e.target.value)}
              className={DETAIL_INPUT}
            >
              {CRIMINAL_JUSTICE_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <p className="mt-1 font-medium dark:text-gray-100">
              {CRIMINAL_JUSTICE_STATUS_OPTIONS.find(
                (o) => o.value === (displayData.criminal_justice_status || 'unknown')
              )?.label ?? '—'}
            </p>
          )}
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {CRIMINAL_JUSTICE_STATUS_OPTIONS.find(
              (o) =>
                o.value ===
                ((isEditing ? editForm.criminal_justice_status : displayData.criminal_justice_status) ||
                  'unknown')
            )?.hint ?? 'Stage of any open or recent matter, as known to your structure.'}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-semibold text-red-600 dark:text-red-400">
            <FaExclamationTriangle /> Watchlist Flags
          </h3>
          {isEditing && (
            <FieldGuideExplainerLink topic="watchlist" onOpen={onOpenFieldGuide}>
              Explain watchlist flags
            </FieldGuideExplainerLink>
          )}
        </div>
        {isEditing ? (
          <div>
            <WatchlistTemplatePicker
              watchlistFlags={editForm.watchlist_flags || []}
              setWatchlistFlags={onSetWatchlistFlags}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {(editForm.watchlist_flags || []).map((flag, index) => (
                <div
                  key={index}
                  className="flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 dark:border-red-800 dark:bg-red-950/40"
                >
                  <input
                    type="text"
                    value={flag}
                    onChange={(e) => onUpdateArrayField('watchlist_flags', index, e.target.value)}
                    className="border-none bg-transparent text-sm text-red-700 dark:text-red-300"
                  />
                  <button
                    type="button"
                    onClick={() => onRemoveArrayItem('watchlist_flags', index)}
                    className="text-red-500"
                  >
                    <FaTimes size={12} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => onAddArrayItem('watchlist_flags')}
                className="flex items-center gap-1 rounded border border-dashed border-red-300 px-2 py-1 text-sm text-red-600 dark:border-red-700 dark:text-red-400"
              >
                <FaPlus size={12} /> Add Flag
              </button>
            </div>
          </div>
        ) : (
          displayData.watchlist_flags?.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {displayData.watchlist_flags.map((flag, index) => (
                <span key={index} className="rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-700 dark:bg-red-950/50 dark:text-red-200">
                  {flag}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 dark:text-gray-500">No watchlist flags</p>
          )
        )}
      </div>
    </section>
  );
}
