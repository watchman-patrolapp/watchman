import { useCallback, useEffect, useState } from "react";
import toast from "../../utils/notify";
import { listMyOrgNeighbours, listOrgNeighbourCandidates, setOrgNeighbour } from "../../utils/localServicesApi";
import { NEIGHBOUR_FALLBACK, friendlyServiceError } from "../../utils/localServices";

export default function NeighbouringSuburbsCard({ onChanged }) {
  const [neighbours, setNeighbours] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  const load = useCallback(async () => {
    try {
      const [mine, options] = await Promise.all([listMyOrgNeighbours(), listOrgNeighbourCandidates()]);
      setNeighbours(mine);
      setCandidates(options);
    } catch (err) {
      console.warn("[local-services] neighbours card load failed", err?.code || "");
      setHidden(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const change = async (orgId, enabled) => {
    if (!orgId || busy) return;
    setBusy(true);
    try {
      await setOrgNeighbour(orgId, enabled);
      setPick("");
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(friendlyServiceError(err, NEIGHBOUR_FALLBACK));
    } finally {
      setBusy(false);
    }
  };

  if (hidden) return null;

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Neighbouring suburbs</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Linked watches can see listings from providers who opt in. Links work both ways and only reach direct neighbours.
        </p>
      </div>
      {neighbours.length === 0 ? (
        <p className="text-xs text-gray-500">No neighbouring suburbs linked yet.</p>
      ) : (
        <ul className="space-y-2">
          {neighbours.map((n) => (
            <li key={n.organization_id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-gray-800 dark:text-gray-100">
                {n.organization_name}
                {n.suburb_name && n.suburb_name !== n.organization_name ? ` · ${n.suburb_name}` : ""}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => change(n.organization_id, false)}
                className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <select
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          aria-label="Choose a neighbouring suburb to add"
          className="input border min-w-0 flex-1 text-sm"
        >
          <option value="">Add a neighbouring suburb…</option>
          {candidates.map((c) => (
            <option key={c.organization_id} value={c.organization_id}>
              {c.organization_name}
              {c.suburb_name && c.suburb_name !== c.organization_name ? ` · ${c.suburb_name}` : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!pick || busy}
          onClick={() => change(pick, true)}
          className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </section>
  );
}
