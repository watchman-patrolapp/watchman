import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import CapabilityBadge from "../community/CapabilityBadge";
import { capabilityErrorMessage, listMyCapabilityGrants, revokeCapability } from "../../utils/orgCapabilities";
import { capabilityLabel } from "../../auth/capabilities";
import { useOrgCapabilities } from "../../hooks/useOrgCapabilities";

/** Profile badge row ("Street rep - Theescombe Ave") with a Step down link per grant. */
export default function MyCapabilities({ user }) {
  const userId = user?.id ?? null;
  const { refetch } = useOrgCapabilities();
  const [grants, setGrants] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await listMyCapabilityGrants(userId);
    if (error) {
      setGrants([]);
      return;
    }
    setGrants(data);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stepDown = async (grant) => {
    if (busyId) return;
    const label = capabilityLabel(grant.capability) || "this role";
    if (!window.confirm(`Step down as ${label}? An NW admin can assign it again later.`)) return;
    setBusyId(grant.id);
    try {
      const { error } = await revokeCapability(grant.id, "stepped down");
      if (error) throw error;
      toast.success("You stepped down.");
      await load();
      void refetch();
    } catch (err) {
      toast.error(capabilityErrorMessage(err, "Could not step down."));
    } finally {
      setBusyId(null);
    }
  };

  if (!grants.length) return null;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-5">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Your neighbourhood roles</h2>
      <ul className="mt-3 space-y-2">
        {grants.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="flex flex-wrap items-center gap-2 text-gray-700 dark:text-gray-200">
              <CapabilityBadge capability={g.capability} title={g.title} />
              {g.title ? <span>{g.title}</span> : null}
            </span>
            <button
              type="button"
              onClick={() => stepDown(g)}
              disabled={busyId === g.id}
              className="text-xs font-medium text-gray-500 hover:text-red-600 hover:underline disabled:opacity-50 dark:text-gray-400 dark:hover:text-red-400"
            >
              {busyId === g.id ? "Stepping down." : "Step down"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}