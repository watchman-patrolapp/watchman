import { useEffect, useMemo, useState } from "react";
import { listMergeTargets } from "../../utils/organizationRequests";
import { mergeTargetOptions } from "../../utils/organizationRequestsView";

/** "Merge into…": approved watches in the request's city, possible duplicates first. */
export default function MergeRequestPicker({ item, busy, onPick, onCancel }) {
  const [watches, setWatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let ignore = false;
    listMergeTargets(item.city_id)
      .then((rows) => {
        if (!ignore) setWatches(rows);
      })
      .catch((err) => {
        if (!ignore) setError(err.message || "Could not load the watches in this city.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [item.city_id]);

  const options = useMemo(() => mergeTargetOptions(watches, item, filter), [watches, item, filter]);
  const listId = `merge-targets-${item.organization_id}`;

  return (
    <div className="mt-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
          Merge into an approved watch in {item.city || "this city"}
        </p>
        <button type="button" className="btn-ghost text-xs" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      <input
        type="search"
        aria-label="Filter watches by suburb or name"
        aria-controls={listId}
        placeholder="Filter by suburb or name"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="input border w-full mt-2 text-sm"
      />
      {loading ? (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading watches…</p>
      ) : error ? (
        <p className="mt-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : !options.length ? (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {watches.length ? "No watch matches that." : `There are no approved watches in ${item.city || "this city"} yet.`}
        </p>
      ) : (
        <ul id={listId} className="mt-2 max-h-64 overflow-auto divide-y divide-gray-100 dark:divide-gray-700">
          {options.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-gray-900 dark:text-white">{w.name}</span>
                {w.suburb ? <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">{w.suburb}</span> : null}
                {w.likely ? (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                    possible duplicate
                  </span>
                ) : null}
              </span>
              <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => onPick(w)}>
                Merge here
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
