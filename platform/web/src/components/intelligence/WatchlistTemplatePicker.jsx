import React from 'react';
import { FaChevronDown, FaPlus } from 'react-icons/fa';
import { WATCHLIST_FLAG_TEMPLATE_GROUPS } from '../../data/intelligenceTaxonomy';
import toast from 'react-hot-toast';

function appendWatchlistFlag(current, flag) {
  const trimmed = flag.trim();
  if (!trimmed) return current;
  const existing = current.map((f) => f.trim()).filter(Boolean);
  if (existing.includes(trimmed)) {
    toast('Already on the list', { icon: 'ℹ️' });
    return current;
  }
  const emptyIdx = current.findIndex((f) => !String(f).trim());
  if (emptyIdx >= 0) {
    return current.map((f, i) => (i === emptyIdx ? trimmed : f));
  }
  return [...current, trimmed];
}

/**
 * Grouped, expandable template chips for watchlist flags.
 */
export default function WatchlistTemplatePicker({ watchlistFlags, setWatchlistFlags }) {
  return (
    <div className="mt-3 rounded-xl border border-dashed border-amber-200 bg-amber-50/50 p-3 dark:border-amber-700/50 dark:bg-gray-900/40">
      <p className="mb-2 text-xs font-medium text-amber-900 dark:text-amber-200">Quick-add watchlist tags</p>
      <p className="mb-3 text-xs text-amber-800/90 dark:text-gray-400">
        Pick common flags; you can still type custom entries below. Duplicates are skipped.
      </p>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {WATCHLIST_FLAG_TEMPLATE_GROUPS.map((group) => (
          <details
            key={group.id}
            className="group rounded-xl border border-amber-200/80 bg-white dark:border-gray-600 dark:bg-gray-700/50"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-gray-800 dark:text-gray-100 [&::-webkit-details-marker]:hidden">
              {group.title}
              <FaChevronDown className="h-3 w-3 shrink-0 text-amber-700 transition group-open:rotate-180 dark:text-amber-400" />
            </summary>
            <div className="flex flex-wrap gap-1.5 border-t border-amber-100 px-3 py-2 dark:border-gray-600">
              {group.flags.map((flag) => (
                <button
                  key={flag}
                  type="button"
                  onClick={() => setWatchlistFlags((prev) => appendWatchlistFlag(prev, flag))}
                  className="inline-flex items-center gap-1 rounded-full border border-amber-300/80 bg-white px-2 py-1 text-left text-xs text-amber-950 hover:bg-amber-100 dark:border-gray-500 dark:bg-gray-800 dark:text-amber-100 dark:hover:bg-gray-600"
                >
                  <FaPlus className="h-2.5 w-2.5 shrink-0 opacity-70" />
                  {flag}
                </button>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
