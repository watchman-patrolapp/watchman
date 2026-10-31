import { useEffect, useState } from "react";
import { FaMinus, FaPlus } from "react-icons/fa";
import { wishlistAcquiredPct } from "../../utils/equipmentWishlist";

/** Set quantity acquired (0..needed). Status follows: all in = acquired, otherwise needed. */
export default function AcquiredDialog({ item, busy, onClose, onSubmit }) {
  const needed = Math.max(Number(item.quantity_needed) || 1, 1);
  const [qty, setQty] = useState(Math.min(Number(item.quantity_acquired) || 0, needed));
  const { pct } = wishlistAcquiredPct(qty, needed);

  useEffect(() => {
    const onKey = (e) => (e.key === "Escape" && !busy ? onClose() : null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const clamp = (n) => Math.max(0, Math.min(needed, Math.trunc(Number(n) || 0)));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Update acquired">
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl dark:bg-gray-800">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">Update acquired</h2>
        <p className="mt-0.5 truncate text-sm text-gray-600 dark:text-gray-300">{item.title}</p>
        <div className="mt-4 flex items-center justify-center gap-3">
          <button type="button" onClick={() => setQty((q) => clamp(q - 1))} disabled={busy || qty <= 0} aria-label="One less"
            className="rounded-full border border-gray-300 p-3 text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">
            <FaMinus />
          </button>
          <label className="text-center">
            <span className="sr-only">Quantity acquired</span>
            <input
              type="number"
              min={0}
              max={needed}
              value={qty}
              onChange={(e) => setQty(clamp(e.target.value))}
              className="w-20 rounded-lg border border-gray-400 bg-white px-2 py-2 text-center text-xl font-bold text-gray-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
            />
            <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">of {needed}</span>
          </label>
          <button type="button" onClick={() => setQty((q) => clamp(q + 1))} disabled={busy || qty >= needed} aria-label="One more"
            className="rounded-full border border-gray-300 p-3 text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">
            <FaPlus />
          </button>
        </div>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-amber-200 dark:bg-amber-900/50">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-center text-xs text-gray-600 dark:text-gray-300">
          {qty >= needed ? "All in: the item will be marked acquired and offerers thanked." : "Stays on the board as needed."}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">
            Cancel
          </button>
          <button type="button" onClick={() => onSubmit(qty)} disabled={busy}
            className="rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:from-teal-700 hover:to-emerald-700 disabled:opacity-50">
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
