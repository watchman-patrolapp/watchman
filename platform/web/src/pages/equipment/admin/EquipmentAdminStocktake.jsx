import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "../../../components/ui/Button";
import EmptyState from "../../../components/ui/EmptyState";
import ErrorState from "../../../components/ui/ErrorState";
import FormField from "../../../components/ui/FormField";
import EquipmentAdminNav from "../../../components/equipment/EquipmentAdminNav";
import { useQrScanner } from "../../../hooks/useQrScanner";
import { equipmentErrorMessage } from "../../../utils/equipment";
import { finaliseEquipmentStocktake, getEquipmentStocktake, startEquipmentStocktake } from "../../../utils/equipmentReporting";
import { STOCKTAKE_RESULTS } from "../../../utils/equipmentReportingMeta";
import { runEquipmentAction } from "../../../utils/equipmentOfflineStore";
import EquipmentShell, { InfoSection } from "../EquipmentShell";

/** /equipment/admin/stocktake — count units, record discrepancies, optionally mark missing as lost. */
export default function EquipmentAdminStocktake() {
  const { supported, scanning, scan } = useQrScanner();
  const [label, setLabel] = useState(`Stocktake ${new Date().getFullYear()}`);
  const [board, setBoard] = useState(null);
  const [lookup, setLookup] = useState("");
  const [markLost, setMarkLost] = useState(false);
  const [hint, setHint] = useState("");
  const [flash, setFlash] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await getEquipmentStocktake();
    setLoading(false);
    if (error) {
      setBoard(null);
      setHint(equipmentErrorMessage(error, "Stocktake is not switched on yet. Ask an admin to apply the latest equipment SQL."));
      return;
    }
    setBoard(data);
    setHint("");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const progress = useMemo(() => {
    const total = Number(board?.total) || 0;
    const counted = Number(board?.counted) || 0;
    return { total, counted, pct: total ? Math.min(100, Math.round((counted / total) * 100)) : 0 };
  }, [board]);

  const start = async (event) => {
    event.preventDefault();
    setBusy("start");
    const { error, data } = await startEquipmentStocktake(label.trim());
    setBusy("");
    if (error) return setFlash(equipmentErrorMessage(error));
    setFlash(data ? "Stocktake started. Holders of gear that is out have been asked to confirm it." : "");
    void load();
  };

  const mark = async (unit, result) => {
    setBusy(unit.unit_id + result);
    const { data, error } = await runEquipmentAction("stocktake_count", {
      stocktakeId: board.id,
      unitId: unit.unit_id,
      result,
    });
    setBusy("");
    if (error) return setFlash(equipmentErrorMessage(error));
    setFlash(data?.queued ? "Saved on this phone. It will send when you are back online." : `${unit.asset_tag} marked ${result === "present" ? "found" : result}.`);
    if (!data?.queued) void load();
  };

  const lookupCount = async (event) => {
    event.preventDefault();
    const value = lookup.trim();
    if (!value || !board?.id) return;
    setBusy("lookup");
    const isToken = value.length > 24 && !value.includes(" ");
    const { data, error } = await runEquipmentAction("stocktake_count", {
      stocktakeId: board.id,
      qrToken: isToken ? value : null,
      assetTag: isToken ? null : value.toUpperCase(),
      result: "present",
    });
    setBusy("");
    if (error) return setFlash(equipmentErrorMessage(error));
    setLookup("");
    setFlash(data?.queued ? "Saved on this phone. It will send when you are back online." : "Counted as found.");
    if (!data?.queued) void load();
  };

  const scanCode = async () => {
    const raw = await scan();
    if (!raw) return setFlash(supported ? "No code seen. Type the asset tag instead." : "This browser cannot scan. Type the asset tag.");
    setLookup(raw);
  };

  const finish = async () => {
    setBusy("finish");
    const { data, error } = await finaliseEquipmentStocktake(board.id, markLost);
    setBusy("");
    if (error) return setFlash(equipmentErrorMessage(error));
    const missing = data?.missing ?? 0;
    setFlash(`Stocktake closed. ${missing} missing. Discrepancies are on the ledger.`);
    void load();
  };

  const closed = Boolean(board?.finalised_at);
  const units = board?.units || [];

  return (
    <EquipmentShell wide title="Stocktake" subtitle="Tick each unit found or missing. Discrepancies stay on the ledger." backTo="/equipment/admin" backLabel="Back to overview">
      <EquipmentAdminNav />
      {hint ? <ErrorState title="Stocktake unavailable" message={hint} onRetry={load} /> : null}
      {flash ? <p className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900 dark:border-teal-800 dark:bg-teal-900/30 dark:text-teal-100" role="status">{flash}</p> : null}
      {loading ? <p className="text-sm text-text-secondary">Loading...</p> : null}
      {!loading && !hint && !board ? (
        <form onSubmit={start} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <FormField id="stk-label" label="Name" required hint="For example AGM 2026.">
            <input id="stk-label" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} className="w-full rounded-lg border border-strong bg-surface-input px-3 py-2 text-text-primary" />
          </FormField>
          <Button type="submit" loading={busy === "start"} disabled={!label.trim()}>Start stocktake</Button>
        </form>
      ) : null}
      {board ? (
        <>
          <InfoSection title={board.label}>
            <p className="text-sm text-text-secondary">{progress.counted} of {progress.total} counted{closed ? " · closed" : ""}</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-inset" aria-hidden>
              <div className="h-full bg-primary-600" style={{ width: `${progress.pct}%` }} />
            </div>
            {closed && board.summary ? <Summary summary={board.summary} /> : null}
          </InfoSection>
          {!closed ? (
            <form onSubmit={lookupCount} className="flex flex-wrap items-end gap-2">
              <FormField id="stk-lookup" label="Asset tag or QR token" className="min-w-[16rem] flex-1">
                <input id="stk-lookup" value={lookup} onChange={(e) => setLookup(e.target.value)} className="w-full rounded-lg border border-strong bg-surface-input px-3 py-2 text-text-primary" />
              </FormField>
              <Button type="submit" variant="secondary" loading={busy === "lookup"}>Mark found</Button>
              <Button type="button" variant="ghost" loading={scanning} onClick={scanCode}>{supported ? "Scan" : "Scan unavailable"}</Button>
            </form>
          ) : null}
          {units.length === 0 ? <EmptyState title="No units to count" message="Retired units are left out." /> : (
            <ul className="space-y-2">
              {units.map((unit) => (
                <li key={unit.unit_id} className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-text-primary"><span className="font-mono">{unit.asset_tag}</span> · {unit.item_name}</p>
                    <p className="text-xs text-text-secondary">{unit.result ? `Counted: ${unit.result.replaceAll("_", " ")}` : unit.status?.replaceAll("_", " ")}{unit.holder_name ? ` · ${unit.holder_name}` : ""}</p>
                  </div>
                  {!closed ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {STOCKTAKE_RESULTS.map((choice) => (
                        <Button key={choice.id} variant={unit.result === choice.id ? "primary" : "secondary"} loading={busy === unit.unit_id + choice.id} onClick={() => mark(unit, choice.id)}>
                          {choice.label}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {!closed ? (
            <div className="space-y-3">
              <label className="flex items-start gap-2 text-sm text-text-primary">
                <input type="checkbox" checked={markLost} onChange={(e) => setMarkLost(e.target.checked)} className="mt-1" />
                <span>When I close this, mark missing units as lost where the status allows it. Anything that cannot change is listed as a discrepancy instead.</span>
              </label>
              <Button variant="danger" loading={busy === "finish"} onClick={finish}>Close stocktake</Button>
            </div>
          ) : null}
        </>
      ) : null}
    </EquipmentShell>
  );
}

function Summary({ summary }) {
  const left = summary.left_unchanged || [];
  return (
    <div className="mt-3 text-sm text-text-secondary">
      <p>Found {summary.present || 0} · with holder {summary.with_holder_confirmed || 0} · damaged {summary.damaged || 0} · missing {summary.missing || 0}</p>
      {left.length ? (
        <ul className="mt-2 space-y-1">
          {left.map((row) => <li key={row.asset_tag}>{row.asset_tag}: {row.reason}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
