import { useEffect, useState } from "react";
import { FaWhatsapp } from "react-icons/fa";
import { fetchMyPendingPatrolShares } from "../../../utils/sharePatrol";
import { filterFreshPendingShares } from "../../../utils/patrolFormat";

const RECHECK_MS = 30 * 1000;

/**
 * Persistent "not shared yet" reminder. Reads list_my_pending_patrol_shares
 * (the SQL keeps a 24 h window; the banner only shows rows whose DB event time,
 * start_time for sign-on and end_time for sign-off, is within SHARE_REMINDER_WINDOW_MS).
 * Note: the RPC returns no server "now", so the comparison uses the device clock (Date.now()).
 * props: refreshKey (bump to reload), onOpen({ kind, patrol })
 */
export default function PatrolShareBanner({ refreshKey, onOpen }) {
  const [rows, setRows] = useState([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    fetchMyPendingPatrolShares()
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setNow(Date.now());
      })
      .catch(() => !cancelled && setRows([])); // migration not applied yet: stay hidden
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const fresh = filterFreshPendingShares(rows, now);

  // Re-check every 30 s while something is showing, so it disappears on its own.
  useEffect(() => {
    if (!fresh.length) return undefined;
    const id = setInterval(() => setNow(Date.now()), RECHECK_MS);
    return () => clearInterval(id);
  }, [fresh.length]);

  if (!fresh.length) return null;
  const row = fresh[0];
  const kind = row.source === "active" ? "start" : "end";
  const label = kind === "start" ? "Sign-on not shared yet" : "Sign-off not shared yet";

  return (
    <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2.5 flex items-center gap-3">
      <FaWhatsapp className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100 truncate">{label}</p>
        <p className="text-xs text-emerald-800/80 dark:text-emerald-200/70 truncate">
          Ref {row.share_ref}
          {fresh.length > 1 ? ` · +${fresh.length - 1} more` : ""}
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
