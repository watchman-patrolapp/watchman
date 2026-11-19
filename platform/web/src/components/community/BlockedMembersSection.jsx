import { useCallback, useEffect, useState } from "react";
import toast from "../../utils/notify";
import { listMyBlockedUsers, loadBlockedUsers, unblockUser, useBlockedUserIds } from "../../utils/userBlocks";

/** Profile: members you've blocked, with Unblock. */
export default function BlockedMembersSection({ user }) {
  const userId = user?.id || null;
  const blocked = useBlockedUserIds(userId);
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { rows: list } = await listMyBlockedUsers();
    setRows(list);
    setLoaded(true);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh, blocked.size]);

  async function unblock(id) {
    if (busyId) return;
    setBusyId(id);
    try {
      const err = await unblockUser(userId, id);
      if (err) {
        toast.error(err);
        return;
      }
      toast.success("Member unblocked.");
      await loadBlockedUsers(userId, { force: true });
    } finally {
      setBusyId(null);
    }
  }

  if (!userId) return null;

  return (
    <section className="mt-8 border-t border-gray-200 pt-6 dark:border-gray-700" aria-label="Blocked members">
      <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Blocked members</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        You don't see chat messages or City Hub posts from people you've blocked. Emergency messages and suspect alerts still show.
      </p>
      {!loaded ? null : rows.length === 0 ? (
        <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">You haven't blocked anyone.</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-700">
          {rows.map((r) => (
            <li key={r.blocked_id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-gray-800 dark:text-gray-200">{r.full_name || "Member"}</span>
              <button
                type="button"
                onClick={() => unblock(r.blocked_id)}
                disabled={busyId === r.blocked_id}
                className="rounded-lg px-3 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50 dark:text-teal-300 dark:hover:bg-teal-900/30"
              >
                {busyId === r.blocked_id ? "Unblocking..." : "Unblock"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
