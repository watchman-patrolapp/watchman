import { useState } from "react";
import Button from "../ui/Button";
import FormField from "../ui/FormField";
import { EquipmentSheet, FIELD, LABEL, PRIMARY_BTN, SECONDARY_BTN } from "./EquipmentLoanDialogs";
import {
  LIABILITY_OPTIONS,
  addEquipmentIssueCaseNumber,
  approveEquipmentWriteOff,
  casNumberError,
  decideEquipmentLiability,
  equipmentErrorMessage,
  formatRandsFromCents,
  normalizeCasNumber,
  randsInputToCents,
  writeOffNeedsSecondAdmin,
} from "../../utils/equipment";

/** Case number, second-admin write-off, and NW-admin liability on one issue card. */
export default function EquipmentIssueActions({ row, onResolve, onChanged }) {
  const [mode, setMode] = useState(null);
  const [caseNo, setCaseNo] = useState("");
  const [station, setStation] = useState("");
  const [decision, setDecision] = useState("no_fault");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const casError = casNumberError(caseNo);
  const cents = randsInputToCents(amount);
  const high = writeOffNeedsSecondAdmin(row.purchase_price_cents);

  const close = () => {
    setMode(null);
    setError("");
    setBusy(false);
  };

  const saveCase = async (e) => {
    e.preventDefault();
    const normalized = normalizeCasNumber(caseNo);
    if (!normalized) return;
    setBusy(true);
    const { error: err } = await addEquipmentIssueCaseNumber(row.id, normalized, station);
    setBusy(false);
    if (err) return setError(equipmentErrorMessage(err));
    close();
    onChanged("Case number saved. Reminders will stop.");
  };

  const saveLiability = async (e) => {
    e.preventDefault();
    if (decision === "contribution_requested" && cents == null) return;
    setBusy(true);
    const { error: err } = await decideEquipmentLiability(row.id, decision, decision === "contribution_requested" ? cents : null, note);
    setBusy(false);
    if (err) return setError(equipmentErrorMessage(err));
    close();
    onChanged("Liability recorded. No charge was created.");
  };

  const approve = async () => {
    setBusy(true);
    const { data, error: err } = await approveEquipmentWriteOff(row.unit_id, note);
    setBusy(false);
    if (err) return setError(equipmentErrorMessage(err));
    close();
    onChanged(data === "pending" ? "Still waiting for a different admin." : "Write-off approved. The unit is retired. No charge was created.");
  };

  return (
    <div className="mt-3 space-y-2">
      {row.kind === "theft" ? (
        <p className="text-sm text-text-secondary">
          {row.cas_pending ? "SAPS case number missing. A reminder goes out every 48 hours until it is added." : `Case ${row.saps_case_number}`}
        </p>
      ) : null}
      {row.liability_decision && row.liability_decision !== "undecided" ? (
        <p className="text-sm text-text-secondary">Liability: {String(row.liability_decision).replace(/_/g, " ")}. No charge was created.</p>
      ) : null}
      {high ? <p className="text-sm text-text-secondary">Value {formatRandsFromCents(row.purchase_price_cents)}. A write-off needs a second admin.</p> : null}
      {row.write_off_status === "pending" ? (
        <p className="text-sm text-amber-800 dark:text-amber-200">{row.i_proposed_write_off ? "You proposed the write-off. A different admin must approve it." : "A write-off is waiting for a second admin."}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onResolve} className={PRIMARY_BTN}>Resolve</button>
        {row.cas_pending ? <button type="button" onClick={() => setMode("cas")} className={SECONDARY_BTN}>Add case number</button> : null}
        {row.write_off_status === "pending" && !row.i_proposed_write_off ? (
          <Button type="button" variant="danger" loading={busy} onClick={approve}>Approve write-off</Button>
        ) : null}
        {row.can_decide_liability ? <button type="button" onClick={() => setMode("liability")} className={SECONDARY_BTN}>Liability</button> : null}
      </div>
      {error && !mode ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p> : null}
      {mode === "cas" ? (
        <EquipmentSheet title="SAPS case number" subtitle={row.asset_tag} onClose={close}>
          <form onSubmit={saveCase} className="space-y-3">
            <FormField id="eq-cas" label="CAS number" required error={casError || ""} hint="For example CAS 123/10/2026.">
              <input id="eq-cas" value={caseNo} onChange={(e) => setCaseNo(e.target.value)} className={FIELD} />
            </FormField>
            <FormField id="eq-station" label="Police station">
              <input id="eq-station" value={station} maxLength={80} onChange={(e) => setStation(e.target.value)} className={FIELD} />
            </FormField>
            {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
            <Button type="submit" loading={busy} disabled={Boolean(casError) || !normalizeCasNumber(caseNo)}>Save</Button>
          </form>
        </EquipmentSheet>
      ) : null}
      {mode === "liability" ? (
        <EquipmentSheet title="Liability" subtitle="This is a record only. The app does not create a charge." onClose={close}>
          <form onSubmit={saveLiability} className="space-y-3">
            <div>
              <label htmlFor="eq-liab" className={LABEL}>Decision</label>
              <select id="eq-liab" value={decision} onChange={(e) => setDecision(e.target.value)} className={FIELD}>
                {LIABILITY_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
            {decision === "contribution_requested" ? (
              <FormField id="eq-amt" label="Amount (R)" required error={cents === undefined ? "Enter rands, for example 500." : ""}>
                <input id="eq-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={FIELD} />
              </FormField>
            ) : null}
            <FormField id="eq-lnote" label="Note">
              <textarea id="eq-lnote" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={FIELD} />
            </FormField>
            {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
            <Button type="submit" loading={busy} disabled={decision === "contribution_requested" && (cents == null || cents === undefined)}>Save decision</Button>
          </form>
        </EquipmentSheet>
      ) : null}
    </div>
  );
}
