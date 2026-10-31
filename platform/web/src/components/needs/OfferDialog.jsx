import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  CONTRIBUTE_COST_HELP,
  NO_QUANTITY_OFFER_KINDS,
  OFFER_KINDS,
  PLEDGE_HINT,
  pledgeRandsToCents,
  formatEstPrice,
  getWishlistItemCoveredCents,
  wishlistPledgeSummary,
  OFFER_NOTE_HINT,
  contributionContactText,
  contributionThanksText,
  createWishlistOffer,
  listContributionContacts,
  notifyWishlistOfferPush,
  noteLooksLikePaymentDetails,
  wishlistErrorMessage,
} from "../../utils/equipmentWishlist";

/** "Offer to help" dialog: kind, quantity, note (500 chars). No money, no payment details. */
export default function OfferDialog({ item, onClose, onSent }) {
  const [kind, setKind] = useState("contribute_item");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [contacts, setContacts] = useState(null);
  const [showName, setShowName] = useState(false);
  const [pledge, setPledge] = useState("");
  const itemId = item?.id;
  const knownCovered = item?.covered_cents;
  const [fetchedCovered, setFetchedCovered] = useState(null);

  useEffect(() => {
    if (kind !== "contribute_cost" || !itemId) return undefined;
    let live = true;
    listContributionContacts(itemId).then(({ names }) => {
      if (live) setContacts(names);
    });
    return () => {
      live = false;
    };
  }, [kind, itemId]);

  useEffect(() => {
    if (kind !== "contribute_cost" || !itemId || knownCovered != null) return undefined;
    let live = true;
    getWishlistItemCoveredCents(itemId).then((c) => {
      if (live) setFetchedCovered(c);
    });
    return () => {
      live = false;
    };
  }, [kind, itemId, knownCovered]);

  if (!item) return null;
  const blocked = noteLooksLikePaymentDetails(note);
  const noQuantity = NO_QUANTITY_OFFER_KINDS.includes(kind);
  const coveredCents = knownCovered != null ? Number(knownCovered) || 0 : fetchedCovered;
  const typedPledge = pledgeRandsToCents(pledge);
  const summary = wishlistPledgeSummary(item, coveredCents ?? 0, Number.isNaN(typedPledge) ? 0 : typedPledge || 0);

  const submit = async (event) => {
    event.preventDefault();
    if (busy || blocked) return;
    const q = !noQuantity && quantity ? Number(quantity) : null;
    if (q != null && (!Number.isInteger(q) || q < 1 || q > 500)) {
      toast.error("Quantity must be 1 to 500.");
      return;
    }
    const pledgeCents = noQuantity ? pledgeRandsToCents(pledge) : null;
    if (Number.isNaN(pledgeCents)) {
      toast.error("Pledge must be whole rands from R 1 to R 1,000,000.");
      return;
    }
    setBusy(true);
    try {
      const { data: newOfferId, error } = await createWishlistOffer(item.id, { kind, quantity: q, note, showName, pledgeCents });
      if (error) throw error;
      void notifyWishlistOfferPush(newOfferId);
      if (noQuantity) toast.success(contributionThanksText(contacts), { duration: 8000 });
      else toast.success("Thanks! The committee will be in touch.");
      onSent?.();
      onClose?.();
    } catch (err) {
      toast.error(wishlistErrorMessage(err, "Could not send your offer."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 sm:items-center" role="presentation">
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="offer-dialog-title"
        className="w-full max-w-md space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-800"
      >
        <h3 id="offer-dialog-title" className="text-sm font-semibold text-gray-900 dark:text-white">
          Offer to help - {item.title}
        </h3>
        <fieldset className="space-y-1.5">
          {OFFER_KINDS.map((k) => (
            <label key={k.value} className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
              <input type="radio" name="offer-kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} />
              {k.label}
            </label>
          ))}
        </fieldset>
        {noQuantity ? (
          <p className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100">
            {CONTRIBUTE_COST_HELP}
            <span className="mt-1 block font-medium">
              {contacts ? `After sending, please contact ${contributionContactText(contacts)}.` : "Loading contacts."}
            </span>
          </p>
        ) : null}
        {noQuantity ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-200">
            {summary.priced ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
                <dt>Total required</dt>
                <dd className="text-right font-semibold text-gray-900 dark:text-white">{formatEstPrice(summary.fullCents)}</dd>
                <dt>Est. total needed (outstanding)</dt>
                <dd className="text-right">{formatEstPrice(summary.outstandingCents)}</dd>
                <dt>Already covered</dt>
                <dd className="text-right text-emerald-700 dark:text-emerald-300">
                  {coveredCents == null ? "Loading." : formatEstPrice(summary.covered)}
                </dd>
                <dt className="font-medium">Still to cover</dt>
                <dd className="text-right font-semibold text-gray-900 dark:text-white">{formatEstPrice(summary.stillToCover)}</dd>
              </dl>
            ) : (
              <p>No estimated price yet, so there is no target amount. Any pledge helps.</p>
            )}
            {summary.pledge ? (
              <p className="mt-1.5 border-t border-gray-200 pt-1.5 font-medium text-violet-800 dark:border-gray-700 dark:text-violet-200">
                Your pledge: {formatEstPrice(summary.pledge)}
                {summary.pct != null ? ` (${summary.pct}% of what is still to cover)` : ""}
              </p>
            ) : null}
            {summary.exceeds ? (
              <p className="mt-1 text-amber-700 dark:text-amber-300">
                {summary.stillToCover > 0
                  ? "This is more than what is still needed. That is fine, the committee will use any extra wisely."
                  : "This item is already fully covered. You can still pledge; the committee will use it wisely."}
              </p>
            ) : null}
          </div>
        ) : null}
        {noQuantity ? (
          <label className="block text-sm font-medium text-gray-800 dark:text-gray-100">
            Amount I&apos;d like to pledge (R)
            <input
              type="number"
              min={1}
              max={1000000}
              step={1}
              inputMode="numeric"
              value={pledge}
              onChange={(e) => setPledge(e.target.value.replace(/[^\d]/g, "").slice(0, 7))}
              placeholder="e.g. 500"
              className="mt-1 w-40 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
            />
            <span className="mt-1 block text-xs font-normal text-gray-500 dark:text-gray-400">{PLEDGE_HINT}</span>
          </label>
        ) : null}
        {noQuantity ? (
          <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-100">
            <input type="checkbox" className="mt-0.5" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
            <span>
              Show my name publicly on the contributions ledger
              <span className="block text-xs text-gray-500 dark:text-gray-400">Off: you appear as Anonymous. The committee records the amount, never you.</span>
            </span>
          </label>
        ) : (
        <label className="block text-sm font-medium text-gray-800 dark:text-gray-100">
          How many (optional)
          <input
            type="number"
            min={1}
            max={500}
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="mt-1 w-28 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
          />
        </label>
        )}
        <label className="block text-sm font-medium text-gray-800 dark:text-gray-100">
          Note (optional)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            rows={3}
            placeholder="e.g. I have a spare torch I can drop off"
            className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
          />
          <span className="mt-1 block text-xs font-normal text-gray-500 dark:text-gray-400">
            {OFFER_NOTE_HINT} ({note.length}/500)
          </span>
          {blocked ? (
            <span className="mt-1 block text-xs font-medium text-red-600 dark:text-red-400">
              Please remove account, card or ID numbers. The committee will contact you.
            </span>
          ) : null}
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:underline dark:text-gray-300">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || blocked}
            className="rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:from-teal-700 hover:to-emerald-700 disabled:opacity-50"
          >
            {busy ? "Sending." : "Send offer"}
          </button>
        </div>
      </form>
    </div>
  );
}