import { useCallback, useEffect, useState } from "react";
import Button from "../ui/Button";
import FormField from "../ui/FormField";
import { FIELD, LABEL } from "./EquipmentLoanDialogs";
import {
  MAINTENANCE_KIND_LABELS,
  equipmentErrorMessage,
  formatRandsFromCents,
  listEquipmentMaintenance,
  listEquipmentMaintenanceRecent,
  listEquipmentUnitsAdmin,
  logEquipmentMaintenance,
  randsInputToCents,
} from "../../utils/equipment";

function when(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** Service history for one unit, or the admin log across the neighbourhood. */
export default function EquipmentMaintenanceLog({ unitId = null, canManage = false }) {
  const [rows, setRows] = useState([]);
  const [units, setUnits] = useState([]);
  const [picked, setPicked] = useState(unitId || "");
  const [kind, setKind] = useState("service");
  const [note, setNote] = useState("");
  const [vendor, setVendor] = useState("");
  const [cost, setCost] = useState("");
  const [nextDue, setNextDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const load = useCallback(async () => {
    if (unitId) {
      const { data, error: err } = await listEquipmentMaintenance(unitId);
      setRows(data || []);
      setError(err ? equipmentErrorMessage(err) : "");
      return;
    }
    const [recent, list] = await Promise.all([listEquipmentMaintenanceRecent(), listEquipmentUnitsAdmin()]);
    setRows(recent.data || []);
    setUnits(list.data || []);
    setError(recent.error ? equipmentErrorMessage(recent.error) : list.error ? equipmentErrorMessage(list.error) : "");
  }, [unitId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    const target = unitId || picked;
    const cents = randsInputToCents(cost);
    if (!target || cents === undefined) return;
    setBusy(true);
    const { error: err } = await logEquipmentMaintenance(target, {
      kind,
      note,
      vendor,
      costCents: cents,
      nextDue: nextDue || null,
    });
    setBusy(false);
    if (err) return setError(equipmentErrorMessage(err));
    setNote("");
    setVendor("");
    setCost("");
    setNextDue("");
    setFlash("Service recorded.");
    setError("");
    void load();
  };

  const centsInvalid = randsInputToCents(cost) === undefined;

  return (
    <div className="space-y-4">
      {error ? <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-900/30 dark:text-rose-200">{error}</p> : null}
      {flash ? <p role="status" className="text-sm text-teal-800 dark:text-teal-200">{flash}</p> : null}
      {canManage ? (
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h3 className="text-sm font-semibold text-text-primary">Record a repair or service</h3>
          {!unitId ? (
            <div>
              <label htmlFor="eq-m-unit" className={LABEL}>Unit</label>
              <select id="eq-m-unit" value={picked} onChange={(e) => setPicked(e.target.value)} className={FIELD} required>
                <option value="">Choose a unit</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.asset_tag} · {u.item_name}</option>
                ))}
              </select>
            </div>
          ) : null}
          <div>
            <label htmlFor="eq-m-kind" className={LABEL}>Type</label>
            <select id="eq-m-kind" value={kind} onChange={(e) => setKind(e.target.value)} className={FIELD}>
              {Object.entries(MAINTENANCE_KIND_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <FormField id="eq-m-note" label="What was done">
            <textarea id="eq-m-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={FIELD} />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="eq-m-vendor" label="Workshop">
              <input id="eq-m-vendor" value={vendor} maxLength={120} onChange={(e) => setVendor(e.target.value)} className={FIELD} />
            </FormField>
            <FormField id="eq-m-cost" label="Cost (R)" error={centsInvalid ? "Enter rands, for example 350 or 350.50." : ""}>
              <input id="eq-m-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} className={FIELD} placeholder="0" />
            </FormField>
          </div>
          <FormField id="eq-m-due" label="Next service" hint="Leave blank if there is no next date.">
            <input id="eq-m-due" type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} className={FIELD} />
          </FormField>
          <Button type="submit" loading={busy} disabled={!(unitId || picked) || centsInvalid}>Save record</Button>
        </form>
      ) : null}
      {rows.length === 0 ? <p className="text-sm text-text-secondary">No service records yet.</p> : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {rows.map((m) => (
            <li key={m.id} className="py-2">
              <p className="text-sm font-medium text-text-primary">
                {MAINTENANCE_KIND_LABELS[m.kind] || m.kind}
                {m.asset_tag ? ` · ${m.asset_tag}` : ""}
              </p>
              <p className="text-xs text-text-tertiary">
                {when(m.performed_at)}
                {m.performed_by_name ? ` · ${m.performed_by_name}` : ""}
                {m.vendor ? ` · ${m.vendor}` : ""}
                {m.cost_cents != null ? ` · ${formatRandsFromCents(m.cost_cents)}` : ""}
                {m.next_due ? ` · next ${m.next_due}` : ""}
              </p>
              {m.note ? <p className="mt-1 text-sm text-text-secondary">{m.note}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
