import { FaLock, FaPlus } from 'react-icons/fa';
import IncidentUpdateCard from './IncidentUpdateCard';

/**
 * @param {object} props
 * @param {string} props.label
 * @param {React.ReactNode} props.originalChildren — content inside the original (locked) record
 * @param {Array<{ id: string, body: string, created_at: string, author_name?: string, author_role?: string }>} props.updates
 * @param {boolean} props.canAdd
 * @param {() => void} props.onAddClick
 */
export default function IncidentSectionPanel({
  label,
  originalChildren,
  updates = [],
  canAdd,
  onAddClick,
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{label}</h3>
        {canAdd && (
          <button
            type="button"
            onClick={onAddClick}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/80 dark:border-amber-600/80 bg-white dark:bg-gray-800 px-2.5 py-1 text-xs font-medium text-amber-900 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-950/50"
          >
            <FaPlus className="w-3 h-3" />
            Add update
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-dashed border-gray-300 bg-gray-100/70 dark:border-gray-600 dark:bg-gray-800/50">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-gray-300/60 bg-gray-200/60 px-2 py-1.5 dark:border-gray-600 dark:bg-gray-700/50 sm:px-3">
          <FaLock className="h-3 w-3 shrink-0 text-gray-500 dark:text-gray-400" />
          <span className="min-w-0 text-[10px] font-semibold uppercase leading-snug tracking-wide text-gray-500 dark:text-gray-400 sm:text-[11px]">
            Original submission (read-only)
          </span>
        </div>
        <div className="min-w-0 overflow-x-auto px-2 py-3 text-sm text-gray-600 dark:text-gray-300 sm:px-3">
          {originalChildren}
        </div>
      </div>

      {updates.length > 0 && (
        <div className="space-y-3 pl-0 sm:pl-2 border-l-2 border-amber-300 dark:border-amber-700">
          {updates.map((u) => (
            <IncidentUpdateCard key={u.id} row={u} />
          ))}
        </div>
      )}
    </section>
  );
}
