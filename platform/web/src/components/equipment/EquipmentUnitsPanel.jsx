import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { FaFileInvoice, FaPlus, FaPrint, FaQrcode, FaSpinner } from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { getSignedUrl, uploadPrivateFile } from "../../utils/communityMedia";
import { formatEstPrice, randsToCents } from "../../utils/equipmentWishlist";
import {
  EQUIPMENT_CONDITION_LABELS,
  EQUIPMENT_FUNDING_LABELS,
  addEquipmentUnit,
  adminStatusEndsLoan,
  adminUnitStatusTargets,
  centsToRandsInput,
  equipmentErrorMessage,
  equipmentStatusMeta,
  isValidAssetTag,
  listEquipmentUnitsAdmin,
  rotateEquipmentQr,
  setEquipmentUnitNotes,
  setEquipmentUnitStatusAdmin,
  suggestEquipmentAssetTag,
  updateEquipmentUnitDetails,
} from "../../utils/equipment";
import { BTN, BTN_PRIMARY, HELP, INPUT, LABEL } from "./EquipmentItemEditor";
import { DANGER_BTN, EquipmentSheet, FIELD, LABEL as SHEET_LABEL, PRIMARY_BTN, SECONDARY_BTN } from "./EquipmentLoanDialogs";

const STATUS_HINTS = Object.freeze({
  available: "Back in service. Patrollers can borrow it again.",
  under_repair: "Out of use while it is being fixed.",
  damaged: "Broken; decide later whether to repair or retire it.",
  lost: "Can't be found. Set it back to Available if it turns up.",
  stolen: "Reported stolen. Set it back to Available if it is recovered.",
  retired: "Permanently out of the catalogue. This can't be undone.",
});

const EMPTY_UNIT = {
  id: null,
  assetTag: "",
  serialNumber: "",
  condition: "good",
  priceRands: "",
  purchaseDate: "",
  supplier: "",
  fundingSource: "",
  locationNote: "",
  notes: "",
  invoicePath: "",
  photoPath: "",
};

function unitForm(u) {
  return {
    id: u.id,
    assetTag: u.asset_tag,
    serialNumber: u.serial_number || "",
    condition: u.condition || "good",
    priceRands: centsToRandsInput(u.purchase_price_cents),
    purchaseDate: u.purchase_date || "",
    supplier: u.supplier || "",
    fundingSource: u.funding_source || "",
    locationNote: u.location_note || "",
    notes: u.notes || "",
    invoicePath: u.invoice_path || "",
    photoPath: u.photo_path || "",
  };
}

async function openInvoice(path) {
  try {
    const url = await getSignedUrl(path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  } catch (err) {
    toast.error(equipmentErrorMessage(err, "Could not open the invoice."));
  }
}

function UnitForm({ itemId, orgId, initial, onCancel, onSaved }) {
  const [form, setForm] = useState(initial);
  const [invoiceFile, setInvoiceFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  useEffect(() => {
    if (initial.id || initial.assetTag) return undefined;
    let alive = true;
    suggestEquipmentAssetTag(itemId).then(({ data }) => {
      if (alive && data) setForm((f) => (f.assetTag ? f : { ...f, assetTag: data }));
    });
    return () => {
      alive = false;
    };
  }, [initial.id, initial.assetTag, itemId]);

  const save = async (e) => {
    e.preventDefault();
    if (busy) return;
    const tag = form.assetTag.trim().toUpperCase();
    if (!form.id && !isValidAssetTag(tag)) {
      toast.error("Asset tag: 2-24 capital letters, numbers or dashes (e.g. RAD-01).");
      return;
    }
    const cents = randsToCents(form.priceRands);
    if (Number.isNaN(cents)) {
      toast.error("Purchase price must be a number (or blank).");
      return;
    }
    setBusy(true);
    try {
      let invoicePath = form.invoicePath || null;
      if (invoiceFile) {
        const { path } = await uploadPrivateFile({ orgId, subPath: `equipment/invoices/${itemId}`, file: invoiceFile });
        invoicePath = path;
      }
      const payload = {
        id: form.id,
        itemId,
        assetTag: tag,
        condition: form.condition,
        locationNote: form.locationNote.trim(),
        serialNumber: form.serialNumber.trim(),
        purchasePriceCents: cents,
        purchaseDate: form.purchaseDate,
        supplier: form.supplier.trim(),
        invoicePath,
        fundingSource: form.fundingSource,
        photoPath: form.photoPath,
      };
      let unitId = form.id;
      if (form.id) {
        const { error } = await updateEquipmentUnitDetails(payload);
        if (error) throw error;
      } else {
        const { data, error } = await addEquipmentUnit(payload);
        if (error) throw error;
        unitId = data;
      }
      if ((form.notes || "") !== (initial.notes || "") || (!initial.id && form.notes)) {
        const { error } = await setEquipmentUnitNotes(unitId, form.notes.trim());
        if (error) throw error;
      }
      toast.success(form.id ? "Unit updated." : `Unit ${tag} added.`);
      onSaved?.();
    } catch (err) {
      toast.error(equipmentErrorMessage(err, "Could not save the unit."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-teal-200 bg-teal-50/40 p-3 dark:border-teal-800 dark:bg-teal-950/20">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{form.id ? `Edit ${form.assetTag}` : "Add unit"}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          Asset tag <span className="text-red-600">*</span>
          <input
            required
            disabled={Boolean(form.id)}
            maxLength={24}
            value={form.assetTag}
            onChange={(e) => setForm((f) => ({ ...f, assetTag: e.target.value.toUpperCase() }))}
            placeholder="RAD-01"
            className={`${INPUT} font-mono disabled:opacity-60`}
          />
          {!form.id ? <span className={HELP}>Suggested next free tag. Printed on the QR label.</span> : null}
        </label>
        <label className={LABEL}>
          Serial number
          <input maxLength={80} value={form.serialNumber} onChange={set("serialNumber")} className={INPUT} />
        </label>
        <label className={LABEL}>
          Condition
          <select value={form.condition} onChange={set("condition")} className={INPUT}>
            {Object.entries(EQUIPMENT_CONDITION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Purchase price (R)
          <input inputMode="decimal" value={form.priceRands} onChange={set("priceRands")} placeholder="e.g. 1500" className={INPUT} />
        </label>
        <label className={LABEL}>
          Purchase date
          <input type="date" value={form.purchaseDate} onChange={set("purchaseDate")} className={INPUT} />
        </label>
        <label className={LABEL}>
          Supplier
          <input maxLength={120} value={form.supplier} onChange={set("supplier")} className={INPUT} />
        </label>
        <label className={LABEL}>
          Funding source
          <select value={form.fundingSource} onChange={set("fundingSource")} className={INPUT}>
            <option value="">Not recorded</option>
            {Object.entries(EQUIPMENT_FUNDING_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Kept at
          <input maxLength={200} value={form.locationNote} onChange={set("locationNote")} placeholder="e.g. Guard house locker 2" className={INPUT} />
        </label>
      </div>
      <label className={LABEL}>
        Notes (admins only)
        <textarea maxLength={1000} rows={2} value={form.notes} onChange={set("notes")} className={`${INPUT} resize-y`} />
      </label>
      <div className={LABEL}>
        Invoice (PDF or photo, private)
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)}
            className="max-w-full text-xs text-gray-700 file:mr-2 file:rounded-lg file:border-0 file:bg-teal-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white dark:text-gray-200"
          />
          {form.invoicePath && !invoiceFile ? (
            <button type="button" className={`${BTN} inline-flex items-center gap-1`} onClick={() => openInvoice(form.invoicePath)}>
              <FaFileInvoice aria-hidden /> View current
            </button>
          ) : null}
        </div>
        <span className={HELP}>Stored privately; only equipment managers can open it.</span>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className={BTN} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className={`${BTN_PRIMARY} inline-flex items-center gap-1`} disabled={busy}>
          {busy ? <FaSpinner className="animate-spin" aria-hidden /> : null}
          {busy ? "Saving..." : "Save unit"}
        </button>
      </div>
    </form>
  );
}

/** Change a unit's status outside the loan flow (repair, write-off, back in service). */
function StatusSheet({ unit, onClose, onDone }) {
  const targets = adminUnitStatusTargets(unit.status);
  const [to, setTo] = useState(targets[0] || "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endsLoan = adminStatusEndsLoan(unit.status);
  const needsNote = endsLoan && note.trim().length < 3;
  const submit = async (e) => {
    e.preventDefault();
    if (!to || needsNote) return;
    setBusy(true);
    const { error: err } = await setEquipmentUnitStatusAdmin(unit.id, to, note.trim());
    setBusy(false);
    if (err) return setError(equipmentErrorMessage(err));
    onDone(`${unit.asset_tag} is now ${equipmentStatusMeta(to).label.toLowerCase()}.`);
  };
  return (
    <EquipmentSheet
      title={`Change status of ${unit.asset_tag}`}
      subtitle={endsLoan ? `On loan to ${unit.holder_name || "a patroller"}. This closes their loan and tells them.` : `Now ${equipmentStatusMeta(unit.status).label.toLowerCase()}.`}
      onClose={onClose}
    >
      {targets.length ? (
        <form onSubmit={submit} className="space-y-3">
          <fieldset>
            <legend className={SHEET_LABEL}>New status</legend>
            <div className="space-y-2">
              {targets.map((s) => (
                <label
                  key={s}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                    to === s ? "border-teal-600 bg-teal-50 dark:border-teal-500 dark:bg-teal-900/30" : "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/40"
                  }`}
                >
                  <input type="radio" name="eq-status" value={s} checked={to === s} onChange={() => setTo(s)} className="mt-1 accent-teal-600" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-gray-900 dark:text-white">{equipmentStatusMeta(s).label}</span>
                    <span className="block text-xs text-gray-600 dark:text-gray-300">{STATUS_HINTS[s]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="eq-snote" className={SHEET_LABEL}>
              {endsLoan ? "What happened" : "Note (optional)"}
            </label>
            <textarea id="eq-snote" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={FIELD} />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Saved on the unit's timeline.</p>
          </div>
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-900/30 dark:text-rose-200">{error}</p> : null}
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className={SECONDARY_BTN}>
              Cancel
            </button>
            <button type="submit" disabled={busy || needsNote} className={to === "available" || to === "under_repair" ? PRIMARY_BTN : DANGER_BTN}>
              {busy ? "Saving..." : `Mark ${equipmentStatusMeta(to).label.toLowerCase()}`}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="text-sm text-gray-700 dark:text-gray-200">
            {unit.status === "retired"
              ? "Retired units stay retired."
              : "This unit is part of an open loan or transfer. Use the Loan desk to approve, hand over or take it back."}
          </p>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className={SECONDARY_BTN}>
              Close
            </button>
          </div>
        </>
      )}
    </EquipmentSheet>
  );
}

function RotateQrSheet({ unit, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rotate = async () => {
    setBusy(true);
    const { error: err } = await rotateEquipmentQr(unit.id);
    setBusy(false);
    if (err) return setError(equipmentErrorMessage(err, "Could not replace the QR code."));
    onDone("New QR code made. Print a new label.");
  };
  return (
    <EquipmentSheet title={`Replace the QR label for ${unit.asset_tag}?`} subtitle="The old label stops working straight away. Print and stick on the new one." onClose={onClose}>
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-900/30 dark:text-rose-200">{error}</p> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} className={SECONDARY_BTN}>
          Keep current label
        </button>
        <button type="button" disabled={busy} onClick={rotate} className={DANGER_BTN}>
          {busy ? "Replacing..." : "Replace QR"}
        </button>
      </div>
    </EquipmentSheet>
  );
}

/** Units of one item, for managers: add/edit, status, invoice, rotate QR, print labels. */
export default function EquipmentUnitsPanel({ itemId, orgId, onChanged }) {
  const navigate = useNavigate();
  const [units, setUnits] = useState([]);
  const [editing, setEditing] = useState(null);
  const [hint, setHint] = useState("");
  const [sheet, setSheet] = useState(null); // { type: "status" | "qr", unit }

  const load = useCallback(async () => {
    const { data, error } = await listEquipmentUnitsAdmin(itemId);
    setHint(error ? equipmentErrorMessage(error) : "");
    setUnits(error ? [] : data);
  }, [itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sheetDone = (message) => {
    setSheet(null);
    toast.success(message);
    void load();
    onChanged?.();
  };

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Units ({units.length})</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${BTN} inline-flex items-center gap-1`} onClick={() => navigate(`/equipment/admin/labels?item=${itemId}`)} disabled={!units.length}>
            <FaPrint aria-hidden /> Labels
          </button>
          {!editing ? (
            <button type="button" className={`${BTN_PRIMARY} inline-flex items-center gap-1`} onClick={() => setEditing({ ...EMPTY_UNIT })}>
              <FaPlus aria-hidden /> Add unit
            </button>
          ) : null}
        </div>
      </div>
      {hint ? <p className="text-sm text-amber-800 dark:text-amber-200">{hint}</p> : null}
      {editing ? (
        <UnitForm
          key={editing.id || "new"}
          itemId={itemId}
          orgId={orgId}
          initial={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
            onChanged?.();
          }}
        />
      ) : null}
      {!units.length && !hint ? <p className="text-sm text-gray-500 dark:text-gray-400">No units yet. Add one for each physical piece of gear.</p> : null}
      <ul className="grid gap-2 md:grid-cols-2">
        {units.map((u) => {
          const meta = equipmentStatusMeta(u.status);
          return (
            <li key={u.id} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-gray-900 dark:text-white">{u.asset_tag}</p>
                  <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                    {[
                      EQUIPMENT_CONDITION_LABELS[u.condition] || u.condition,
                      u.purchase_price_cents != null ? formatEstPrice(u.purchase_price_cents) : null,
                      u.funding_source ? EQUIPMENT_FUNDING_LABELS[u.funding_source] : null,
                      u.serial_number ? `S/N ${u.serial_number}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {u.holder_name ? <p className="text-xs text-gray-500 dark:text-gray-400">With {u.holder_name}</p> : null}
                  {u.notes ? <p className="mt-1 line-clamp-2 text-xs italic text-gray-600 dark:text-gray-300">{u.notes}</p> : null}
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.tone}`}>{meta.label}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={BTN} onClick={() => setEditing(unitForm(u))}>
                  Edit
                </button>
                <button type="button" className={BTN} onClick={() => setSheet({ type: "status", unit: u })}>
                  Status
                </button>
                <button type="button" className={BTN} onClick={() => navigate(`/equipment/units/${u.id}`)}>
                  Timeline
                </button>
                <button type="button" className={`${BTN} inline-flex items-center gap-1`} onClick={() => setSheet({ type: "qr", unit: u })}>
                  <FaQrcode aria-hidden /> Rotate QR
                </button>
                {u.invoice_path ? (
                  <button type="button" className={`${BTN} inline-flex items-center gap-1`} onClick={() => openInvoice(u.invoice_path)}>
                    <FaFileInvoice aria-hidden /> Invoice
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {sheet?.type === "status" ? <StatusSheet unit={sheet.unit} onClose={() => setSheet(null)} onDone={sheetDone} /> : null}
      {sheet?.type === "qr" ? <RotateQrSheet unit={sheet.unit} onClose={() => setSheet(null)} onDone={sheetDone} /> : null}
    </section>
  );
}
