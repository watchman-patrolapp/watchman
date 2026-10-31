import { useEffect, useState } from "react";
import { FaWhatsapp } from "react-icons/fa";
import { fetchMyPendingPatrolShares } from "../../../utils/sharePatrol";

/**
 * Persistent "not shared yet" reminder. Reads list_my_pending_patrol_shares
 * (active sign-on not shared, sign-offs from the last 24 h not shared).
 * props: refreshKey (bump to reload), onOpen({ kind, patrol })
 */
export default function PatrolShareBanner({ refreshKey, onOpen }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetchMyPendingPatrolShares()
      .then((data) => !cancelled && setRows(data))
      .catch(() => !cancelled && setRows([])); // migration not applied yet: stay hidden
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!rows.length) return null;
  const row = rows[0];
  const kind = row.source === "active" ? "start" : "end";
  const label = kind === "start" ? "Sign-on not shared yet" : "Sign-off not shared yet";

  return (
    <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2.5 flex items-center gap-3">
      <FaWhatsapp className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100 truncate">{label}</p>
        <p className="text-xs text-emerald-800/80 dark:text-emerald-200/70 truncate">
          Ref {row.share_ref}
          {rows.length > 1 ? ` · +${rows.length - 1} more` : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onOpen?.({ kind, patrol: row })}
        className="shrink-0 px-3 py-1.5 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
      >
        Share
      </button>
    </div>
  );
}
