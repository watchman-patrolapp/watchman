import { useCallback, useEffect, useState } from "react";
import { FaArrowDown, FaArrowUp, FaReceipt, FaUndo } from "react-icons/fa";
import { formatWatchDateTime } from "../../utils/watchTime";
import {
  LEDGER_KIND_META,
  formatEstPrice,
  listWishlistLedger,
  wishlistErrorMessage,
  wishlistLedgerSummary,
  wishlistPhotoUrl,
} from "../../utils/equipmentWishlist";

const ICONS = { contribution_received: FaArrowDown, purchase: FaArrowUp, correction: FaUndo };

/**
 * Transparent, append-only ledger for one item: contributions in, purchases out,
 * corrections, balance. Read by every member; managers may pass onCorrect.
 * Money is never collected in the app - this only records what happened outside it.
 */
export default function NeedLedger({ itemId, refreshKey = 0, onCorrect = null }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!itemId) return;
    const { data, error: err } = await listWishlistLedger(itemId);
    if (err) {
      setRows([]);
      setError(wishlistErrorMessage(err, "Could not load the ledger."));
      return;
    }
    setError("");
    setRows(data);
  }, [itemId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const sum = wishlistLedgerSummary(rows || []);
  const corrected = new Map();
  for (const r of rows || []) {
    if (r.kind === "correction" && r.corrects_entry_id) {
      corrected.set(r.corrects_entry_id, (corrected.get(r.corrects_entry_id) || 0) + Number(r.amount_cents || 0));
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800" aria-labelledby={`ledger-${itemId}`}>
      <div>
        <h3 id={`ledger-${itemId}`} className="text-sm font-semibold text-gray-900 dark:text-white">
          Contributions ledger
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Every amount the committee received or spent for this item, recorded by a named admin. Entries can never be edited or deleted; mistakes are fixed with a visible correction. No money is collected in the app.
        </p>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-emerald-50 px-2 py-2 dark:bg-emerald-900/30">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Received</dt>
          <dd className="break-words text-sm font-bold text-emerald-900 dark:text-emerald-100">{formatEstPrice(sum.receivedCents)}</dd>
        </div>
        <div className="rounded-xl bg-rose-50 px-2 py-2 dark:bg-rose-900/30">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">Spent</dt>
          <dd className="break-words text-sm font-bold text-rose-900 dark:text-rose-100">{formatEstPrice(sum.spentCents)}</dd>
        </div>
        <div className="rounded-xl bg-sky-50 px-2 py-2 dark:bg-sky-900/30">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">Balance</dt>
          <dd className={`break-words text-sm font-bold ${sum.balanceCents < 0 ? "text-rose-700 dark:text-rose-300" : "text-sky-900 dark:text-sky-100"}`}>
            {sum.balanceCents < 0 ? "-" : ""}
            {formatEstPrice(Math.abs(sum.balanceCents))}
          </dd>
        </div>
      </dl>

      {error ? <p className="text-xs text-amber-700 dark:text-amber-300">{error}</p> : null}
      {rows === null ? <p className="text-xs text-gray-500 dark:text-gray-400">Loading.</p> : null}
      {rows && rows.length === 0 && !error ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">Nothing recorded yet.</p>
      ) : null}

      {rows && rows.length ? (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {rows.map((r) => {
            const meta = LEDGER_KIND_META[r.kind] || LEDGER_KIND_META.correction;
            const Icon = ICONS[r.kind] || FaUndo;
            const receiptUrl = r.receipt_path ? wishlistPhotoUrl(r.receipt_path) : null;
            const left = Number(r.amount_cents || 0) - (corrected.get(r.id) || 0);
            const sign = r.kind === "contribution_received" ? "+" : "-";
            return (
              <li key={r.id} className="flex gap-3 py-2.5 text-sm">
                <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${meta.icon}`} aria-hidden>
                  <Icon className="text-xs" />
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="font-medium text-gray-900 dark:text-white">
                      {r.kind === "correction"
                        ? `Correction of a ${r.corrects_kind === "purchase" ? "purchase" : "contribution"}`
                        : r.kind === "purchase"
                          ? "Purchase"
                          : `Contribution - ${r.contributor_name || "Anonymous"}`}
                    </span>
                    <span className={`font-semibold tabular-nums ${meta.amount}`}>
                      {r.kind === "correction" ? "-" : sign}
                      {formatEstPrice(r.amount_cents)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {r.entry_date} - recorded by {r.recorded_by_name || "Former member"}
                    <span className="sr-only"> at {formatWatchDateTime(r.created_at)}</span>
                  </p>
                  {r.note ? (
                    <p className="whitespace-pre-line break-words text-xs text-gray-700 dark:text-gray-300">
                      {r.kind === "correction" ? "Reason: " : ""}
                      {r.note}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {receiptUrl ? (
                      <a href={receiptUrl} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-2 text-xs font-medium text-teal-700 hover:underline dark:text-teal-400">
                        <img src={receiptUrl} alt="Receipt" loading="lazy" className="h-12 w-12 rounded-lg border border-gray-200 object-cover dark:border-gray-600" />
                        <FaReceipt aria-hidden /> View receipt
                      </a>
                    ) : null}
                    {onCorrect && r.kind !== "correction" && left > 0 ? (
                      <button type="button" onClick={() => onCorrect(r, left)} className="rounded-lg border border-amber-300 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/30">
                        Correct
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
