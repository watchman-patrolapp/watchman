import { useCallback, useEffect, useState } from "react";
import { FaCheck, FaTimes, FaUserPlus } from "react-icons/fa";
import toast from "../../utils/notify";
import { listWatchJoinRequests, reviewWatchJoin } from "../../utils/organizationRequests";
import { joinRequestNote } from "../../utils/organizationRequestsView";

/**
 * People waiting to join this admin's watch, e.g. after a reviewer merged their suburb request
 * into it (SA places D9). Hidden when nobody is waiting.
 */
export default function WatchJoinRequestsPanel({ onChanged }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      setRows(await listWatchJoinRequests());
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (row, approve) => {
    if (!approve && !window.confirm(`Decline ${row.name}'s request to join ${row.organization_name}?`)) return;
    setBusy(`${row.organization_id}:${row.user_id}`);
    try {
      await reviewWatchJoin(row.organization_id, row.user_id, approve);
      toast.success(approve ? `${row.name} is now a member of ${row.organization_name}.` : `${row.name}'s request was declined.`);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy("");
    }
  };

  if (!rows.length) return null;
  const several = new Set(rows.map((r) => r.organization_id)).size > 1;

  return (
    <section
      className="bg-white dark:bg-gray-800 p-4 rounded shadow"
      aria-labelledby="watch-join-requests-heading"
    >
      <h2 id="watch-join-requests-heading" className="flex items-center gap-2 text-lg font-semibold dark:text-white">
        <FaUserPlus className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden />
        Waiting to join ({rows.length})
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        These people asked to join. They get access once you approve.
      </p>
      <ul className="mt-3 space-y-2">
        {rows.map((row) => {
          const key = `${row.organization_id}:${row.user_id}`;
          return (
            <li
              key={key}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900/40"
            >
              <span className="min-w-0">
                <span className="font-medium text-gray-900 dark:text-white">{row.name}</span>
                <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                  {joinRequestNote(row)}
                  {several ? ` · ${row.organization_name}` : ""}
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400 break-all">
                  {[row.email, row.phone].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary text-xs inline-flex items-center gap-1"
                  disabled={Boolean(busy)}
                  onClick={() => void review(row, true)}
                >
                  <FaCheck className="h-3 w-3" aria-hidden /> Approve
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs inline-flex items-center gap-1 text-red-700 dark:text-red-300"
                  disabled={Boolean(busy)}
                  onClick={() => void review(row, false)}
                >
                  <FaTimes className="h-3 w-3" aria-hidden /> Decline
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
