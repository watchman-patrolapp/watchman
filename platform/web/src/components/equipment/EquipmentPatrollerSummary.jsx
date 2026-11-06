import { useCallback, useEffect, useState } from "react";
import Button from "../ui/Button";
import { equipmentErrorMessage, equipmentStatusMeta } from "../../utils/equipment";
import { getEquipmentPatrollerOverview } from "../../utils/equipmentReporting";
import { readEquipmentCache, rememberEquipmentRead, runEquipmentAction } from "../../utils/equipmentOfflineStore";

/** Member view: neighbourhood counts, and a prompt to confirm gear during a stocktake. */
export default function EquipmentPatrollerSummary() {
  const [overview, setOverview] = useState(null);
  const [hint, setHint] = useState("");
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await getEquipmentPatrollerOverview();
    if (error) {
      const cached = await readEquipmentCache("patroller");
      setOverview(cached);
      setHint(cached ? "You're offline. Some actions will wait until you reconnect." : equipmentErrorMessage(error));
      return;
    }
    setOverview(data);
    setHint("");
    void rememberEquipmentRead("patroller", data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!overview && !hint) return null;

  const statuses = Object.entries(overview?.units_by_status || {});
  const mine = overview?.open_stocktake?.mine || [];

  const confirm = async (unitId) => {
    setBusy(unitId);
    const { data, error } = await runEquipmentAction("still_held", { unitId });
    setBusy("");
    if (error) return setFlash(equipmentErrorMessage(error));
    setFlash(data?.queued ? "Saved on this phone. It will send when you are back online." : "Thanks. That unit is marked as still with you.");
    if (!data?.queued) void load();
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">This neighbourhood</h2>
      {hint ? <p className="mb-2 text-sm text-text-secondary">{hint}</p> : null}
      {flash ? <p className="mb-2 text-sm text-text-primary" role="status">{flash}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Stat label="On loan" value={overview?.on_loan} />
        <Stat label="Overdue" value={overview?.overdue} />
        <Stat label="Open issues" value={overview?.open_issues} />
        <Stat label="With me" value={overview?.my_holding} />
      </div>
      {statuses.length ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {statuses.map(([status, count]) => (
            <li key={status}><span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${equipmentStatusMeta(status).tone}`}>{equipmentStatusMeta(status).label} {count}</span></li>
          ))}
        </ul>
      ) : null}
      {overview?.open_stocktake ? (
        <div className="mt-3">
          <p className="text-sm font-medium text-text-primary">Stocktake: {overview.open_stocktake.label}</p>
          {mine.length === 0 ? <p className="mt-1 text-sm text-text-secondary">You are not holding anything that needs a confirmation.</p> : (
            <ul className="mt-2 space-y-2">
              {mine.map((unit) => (
                <li key={unit.unit_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-mono">{unit.asset_tag}</span>
                  <span className="text-text-secondary">{unit.item_name}</span>
                  {unit.confirmed ? <span className="text-text-secondary">Confirmed</span> : (
                    <Button loading={busy === unit.unit_id} onClick={() => confirm(unit.unit_id)}>I still have it</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div className="min-w-[5.5rem] rounded-xl border border-subtle bg-surface-inset px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className="text-lg font-semibold text-text-primary">{value ?? "–"}</p>
    </div>
  );
}
