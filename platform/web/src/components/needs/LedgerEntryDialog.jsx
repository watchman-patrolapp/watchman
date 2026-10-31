import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { uploadCommunityImageWithProgress } from "../../utils/uploadWithProgress";
import {
  formatEstPrice,
  listWishlistOffers,
  randsToCents,
  recordWishlistContribution,
  recordWishlistCorrection,
  recordWishlistPurchase,
  wishlistErrorMessage,
} from "../../utils/equipmentWishlist";

const INPUT =
  "mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white";
const LABEL = "block text-sm font-medium text-gray-800 dark:text-gray-100";
const MAX_RECEIPT_BYTES = 24 * 1024 * 1024;

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Manager-only: record money the committee received or spent OUTSIDE the app,
 * or a correction. mode: "contribution" | "purchase" | "correction".
 */
export default function LedgerEntryDialog({ item, orgId, mode, offerId = null, pledgeCents = null, entry = null, maxCents = null, onClose, onSaved }) {
  const [amount, setAmount] = useState(pledgeCents ? String(Math.round(pledgeCents / 100)) : "");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [linkOffer, setLinkOffer] = useState(offerId || "");
  const [offers, setOffers] = useState([]);
  const [file, setFile] = useState(null);
  const [pct, setPct] = useState(null);
  const [busy, setBusy] = useState(false);
  const itemId = item?.id;

  useEffect(() => {
    if (mode !== "contribution" || !itemId) return undefined;
    let live = true;
    listWishlistOffers({ itemId, includeClosed: true }).then(({ data }) => {
      if (live) setOffers(data.filter((o) => o.kind === "contribute_cost"));
    });
    return () => {
      live = false;
    };
  }, [mode, itemId]);

  if (!item) return null;
  const title =
    mode === "purchase" ? "Record purchase" : mode === "correction" ? "Record correction" : "Record contribution";

  const pickFile = (e) => {
    const f = e.target.files?.[0] || null;
    e.target.value = "";
    if (f && !/^image\//.test(f.type)) {
      toast.error("Receipt must be a photo (JPG, PNG or WebP).");
      return;
    }
    if (f && f.size > MAX_RECEIPT_BYTES) {
      toast.error("Receipt photo is too large (max 24 MB).");
      return;
    }
    setFile(f);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const cents = randsToCents(amount);
    if (!cents || Number.isNaN(cents) || cents <= 0) {
      toast.error("Enter an amount in rand, more than 0.");
      return;
    }
    if (mode === "correction" && maxCents != null && cents > maxCents) {
      toast.error(`A correction can be at most ${formatEstPrice(maxCents)}.`);
      return;
    }
    if (mode === "correction" && !note.trim()) {
      toast.error("Give a reason for the correction.");
      return;
    }
    setBusy(true);
    try {
      let res;
      if (mode === "purchase") {
        let receiptPath = null;
        if (file) {
          setPct(0);
          const up = await uploadCommunityImageWithProgress({
            orgId,
            feature: "needs",
            entityId: item.id,
            subdir: "receipts",
            file,
            onProgress: setPct,
          });
          receiptPath = up.path;
        }
        res = await recordWishlistPurchase(item.id, { amountCents: cents, entryDate: date, note, receiptPath });
      } else if (mode === "correction") {
        res = await recordWishlistCorrection(entry.id, { amountCents: cents, reason: note });
      } else {
        res = await recordWishlistContribution(item.id, { amountCents: cents, entryDate: date, offerId: linkOffer || null, note });
      }
      if (res.error) throw res.error;
      toast.success("Recorded on the ledger.");
      onSaved?.();
      onClose?.();
    } catch (err) {
      toast.error(wishlistErrorMessage(err, "Could not record this entry."));
    } finally {
      setBusy(false);
      setPct(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 sm:items-center" role="presentation">
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ledger-dialog-title"
        className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-800"
      >
        <h3 id="ledger-dialog-title" className="break-words text-sm font-semibold text-gray-900 dark:text-white">
          {title} - {item.title}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {mode === "correction"
            ? "Corrections are added as a new, visible entry. The original stays on the ledger."
            : "Record money handled outside the app. Everyone in the neighbourhood can see this entry and who recorded it. It cannot be edited or deleted later."}
        </p>
        {mode === "correction" && entry ? (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
            Correcting a {entry.kind === "purchase" ? "purchase" : "contribution"} of {formatEstPrice(entry.amount_cents)} on {entry.entry_date}
            {maxCents != null ? ` (up to ${formatEstPrice(maxCents)} can still be reversed)` : ""}.
          </p>
        ) : null}
        {mode === "contribution" && pledgeCents ? (
          <p className="text-xs text-violet-700 dark:text-violet-300">
            Prefilled from the pledge. Change it to the amount actually received.
          </p>
        ) : null}
        <label className={LABEL}>
          Amount (R)
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 250" className={INPUT} required />
        </label>
        {mode !== "correction" ? (
          <label className={LABEL}>
            Date
            <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className={INPUT} />
          </label>
        ) : null}
        {mode === "contribution" ? (
          <label className={LABEL}>
            Linked offer (optional)
            <select
              value={linkOffer}
              onChange={(e) => {
                const id = e.target.value;
                setLinkOffer(id);
                const o = offers.find((x) => x.id === id);
                if (o?.pledged_amount_cents && !amount.trim()) setAmount(String(Math.round(o.pledged_amount_cents / 100)));
              }}
              className={INPUT}
            >
              <option value="">Not linked (shown as Anonymous)</option>
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.full_name || "Former member"} - {o.status}
                  {o.pledged_amount_cents ? ` - pledged ${formatEstPrice(o.pledged_amount_cents)}` : ""}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs font-normal text-gray-500 dark:text-gray-400">
              The contributor&apos;s own choice decides whether their name is shown publicly.
            </span>
          </label>
        ) : null}
        {mode === "purchase" ? (
          <div className={LABEL}>
            Receipt photo (optional)
            <input type="file" accept="image/*" onChange={pickFile} className="mt-1 block w-full text-xs text-gray-700 file:mr-2 file:rounded-lg file:border-0 file:bg-teal-50 file:px-3 file:py-1.5 file:text-teal-800 dark:text-gray-300 dark:file:bg-teal-900/40 dark:file:text-teal-200" />
            {file ? <span className="mt-1 block break-all text-xs font-normal text-gray-600 dark:text-gray-300">{file.name}</span> : null}
            {pct != null ? (
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-teal-600 transition-[width]" style={{ width: `${pct}%` }} />
              </div>
            ) : null}
          </div>
        ) : null}
        <label className={LABEL}>
          {mode === "correction" ? "Reason (required)" : "Note (optional)"}
          <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={2} className={INPUT} required={mode === "correction"} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:underline dark:text-gray-300">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:from-teal-700 hover:to-emerald-700 disabled:opacity-50">
            {busy ? (pct != null ? `Uploading ${pct}%` : "Saving.") : "Record"}
          </button>
        </div>
      </form>
    </div>
  );
}
