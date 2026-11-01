import { useEffect, useState } from "react";
import {
  ISSUE_KIND_LABELS,
  defaultReturnDate,
  equipmentErrorMessage,
  formatLoanLimit,
  latestReturnDate,
  reportEquipmentIssue,
  requestEquipmentLoan,
  requestEquipmentTransfer,
  toDateTimeLocalValue,
  validateReturnDate,
} from "../../utils/equipment";

export const PRIMARY_BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:from-teal-700 hover:to-emerald-700 disabled:cursor-not-allowed disabled:opacity-60";
export const SECONDARY_BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700";
export const DANGER_BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60 dark:border-rose-800 dark:bg-gray-800 dark:text-rose-300 dark:hover:bg-rose-900/30";
export const FIELD =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 dark:border-gray-600 dark:bg-gray-900 dark:text-white";
export const LABEL = "mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400";

/** Bottom sheet on phones, centred card from sm up. */
export function EquipmentSheet({ title, subtitle, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => (e.key === "Escape" ? onClose() : null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 !mt-0 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-800 sm:max-w-md sm:rounded-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-bold text-gray-900 dark:text-white">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">{subtitle}</p> : null}
        <div className="mt-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}

function ErrorText({ children }) {
  return children ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-900/30 dark:text-rose-200">{children}</p> : null;
}

function SheetButtons({ busy, onClose, submitLabel, disabled }) {
  return (
    <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
      <button type="button" onClick={onClose} className={SECONDARY_BTN}>
        Cancel
      </button>
      <button type="submit" disabled={busy || disabled} className={PRIMARY_BTN}>
        {busy ? "Sending..." : submitLabel}
      </button>
    </div>
  );
}

/** Request to borrow: optional note plus a return date (prefilled from the item's loan limit). */
export function BorrowDialog({ item, onClose, onDone }) {
  const [note, setNote] = useState("");
  const [due, setDue] = useState(() => toDateTimeLocalValue(defaultReturnDate(item.max_loan_hours)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const limit = formatLoanLimit(item.max_loan_hours);
  const invalid = validateReturnDate(due, item.max_loan_hours);

  const submit = async (e) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    const { error: err } = await requestEquipmentLoan(item.id, { note, desiredDueAt: due || null });
    setBusy(false);
    if (err) return setError(equipmentErrorMessage(err));
    onDone("Request sent. Your NW admin will let you know when it is ready to collect.");
  };

  return (
    <EquipmentSheet title={`Borrow ${item.name}`} subtitle={limit ? `${limit} per loan.` : "Your NW admin confirms the loan length."} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="eq-due" className={LABEL}>
            Return by
          </label>
          <input
            id="eq-due"
            type="datetime-local"
            value={due}
            min={toDateTimeLocalValue(new Date())}
            max={toDateTimeLocalValue(latestReturnDate(item.max_loan_hours))}
            onChange={(e) => setDue(e.target.value)}
            className={FIELD}
          />
          {invalid ? <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">{invalid}</p> : null}
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">The loan clock starts when an admin hands it over.</p>
        </div>
        <div>
          <label htmlFor="eq-note" className={LABEL}>
            Note (optional)
          </label>
          <textarea id="eq-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What it's for, when you'd like to collect..." className={FIELD} />
        </div>
        <ErrorText>{error}</ErrorText>
        <SheetButtons busy={busy} onClose={onClose} submitLabel="Send request" disabled={Boolean(invalid)} />
      </form>
    </EquipmentSheet>
  );
}

/** Ask the current holder to hand a unit over. */
export function TransferDialog({ unit, onClose, onDone }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { error: err } = await requestEquipmentTransfer(unit.id, note);
    setBusy(false);
    if (err) return setError(equipmentErrorMessage(err));
    onDone("Transfer requested. The current holder needs to accept it.");
  };
  return (
    <EquipmentSheet
      title={`Request ${unit.asset_tag}`}
      subtitle={`${unit.holder_name || "The holder"} gets a notification and must accept before it is yours. The return date stays the same.`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="eq-tnote" className={LABEL}>
            Note (optional)
          </label>
          <textarea id="eq-tnote" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where to meet for the handover..." className={FIELD} />
        </div>
        <ErrorText>{error}</ErrorText>
        <SheetButtons busy={busy} onClose={onClose} submitLabel="Request transfer" />
      </form>
    </EquipmentSheet>
  );
}

/** Damage / theft / malfunction report by the latest holder. */
export function IssueDialog({ unit, onClose, onDone }) {
  const [kind, setKind] = useState("damage");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tooShort = note.trim().length < 3;
  const submit = async (e) => {
    e.preventDefault();
    if (tooShort) return;
    setBusy(true);
    const { error: err } = await reportEquipmentIssue(unit.id, kind, note.trim());
    setBusy(false);
    if (err) return setError(equipmentErrorMessage(err));
    onDone("Issue reported. Your NW admin has been told and the unit is out of use for now.");
  };
  return (
    <EquipmentSheet title={`Report a problem with ${unit.asset_tag}`} subtitle="The unit is taken out of use until an admin checks it." onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <fieldset>
          <legend className={LABEL}>What happened</legend>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(ISSUE_KIND_LABELS).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={`rounded-lg border px-2 py-2 text-sm font-medium ${
                  kind === k
                    ? "border-teal-600 bg-teal-50 text-teal-800 dark:border-teal-500 dark:bg-teal-900/40 dark:text-teal-100"
                    : "border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="eq-inote" className={LABEL}>
            Details
          </label>
          <textarea id="eq-inote" rows={4} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened, when and where..." className={FIELD} />
        </div>
        <ErrorText>{error}</ErrorText>
        <SheetButtons busy={busy} onClose={onClose} submitLabel="Report issue" disabled={tooShort} />
      </form>
    </EquipmentSheet>
  );
}
