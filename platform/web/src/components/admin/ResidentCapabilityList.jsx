import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import CapabilityBadge from "../community/CapabilityBadge";
import { isRpcNotFoundError } from "../../utils/isRpcNotFound";
import { capabilityErrorMessage, listCapabilityGrants, revokeCapability } from "../../utils/orgCapabilities";
import { formatWatchDate } from "../../utils/watchTime";

/** Current + past resident role assignments for the working neighbourhood, with revoke. */
export default function ResidentCapabilityList({ reloadKey = 0, onChanged }) {
  const [rows, setRows] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [hint, setHint] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await listCapabilityGrants(showHistory);
    if (error) {
      setRows([]);
      setHint(isRpcNotFoundError(error) ? "Run the capability SQL (P0a) in Supabase first." : "");
      return;
    }
    setHint("");
    setRows(data);
  }, [showHistory]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const revoke = async (row) => {
    if (busyId) return;
    const reason = window.prompt(`Why remove ${row.full_name || "this person"}'s role? (optional)`, "");
    if (reason === null) return;
    setBusyId(row.id);
    try {
      const { error } = await revokeCapability(row.id, reason);
      if (error) throw error;
      toast.success("Role removed.");
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(capabilityErrorMessage(err, "Could not remove role."));
    } finally {
      setBusyId(null);
    }
  };

  const now = Date.now();

  return (
    <div className="mt-6 rounded bg-white p-4 shadow dark:bg-gray-800">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold dark:text-white">Resident roles</h2>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
          Show history
        </label>
      </div>
      {hint ? <p className="text-sm text-amber-800 dark:text-amber-200">{hint}</p> : null}
      {rows.length === 0 && !hint ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No street reps or moderators yet. Use Resident roles on a resident row to assign one.
        </p>
      ) : null}
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {rows.map((row) => {
          const expired = row.expires_at && new Date(row.expires_at).getTime() <= now;
          const status = row.revoked_at ? "revoked" : expired ? "expired" : "active";
          return (
            <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
              <div className="text-gray-800 dark:text-gray-100">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{row.full_name || "-"}</span>
                  <CapabilityBadge capability={row.capability} title={row.title} />
                  {status !== "active" ? (
                    <span className="text-xs uppercase text-gray-400">{status}</span>
                  ) : null}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {[row.title, row.street_label].filter(Boolean).join(" - ")}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Assigned {formatWatchDate(row.granted_at) || "-"}
                  {row.granted_by_name ? ` by ${row.granted_by_name}` : ""}
                  {row.expires_at ? ` - ends ${formatWatchDate(row.expires_at)}` : ""}
                </p>
                {row.revoked_at ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Removed {formatWatchDate(row.revoked_at)}
                    {row.revoked_by_name ? ` by ${row.revoked_by_name}` : ""}
                    {row.revoke_reason ? ` - ${row.revoke_reason}` : ""}
                  </p>
                ) : null}
              </div>
              {!row.revoked_at ? (
                <button
                  type="button"
                  onClick={() => revoke(row)}
                  disabled={busyId === row.id}
                  className="rounded-lg border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                >
                  {busyId === row.id ? "Removing." : "Remove"}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}