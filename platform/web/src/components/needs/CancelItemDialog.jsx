import { useEffect, useState } from "react";

const NOTE_MAX = 500; // set_wishlist_item_status (20261031070000)

/** Confirm "no longer needed" with an optional reason. Replaces window.prompt. */
export default function CancelItemDialog({ item, busy, onClose, onConfirm }) {
  const [note, setNote] = useState("");

  useEffect(() => {
    const onKey = (e) => (e.key === "Escape" && !busy ? onClose() : null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Cancel item">
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl dark:bg-gray-800">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">Cancel this item?</h2>
        <p className="mt-0.5 truncate text-sm text-gray-600 dark:text-gray-300">{item.title}</p>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          It leaves the residents&apos; board and anyone with an open offer is told it is no longer needed. You can reopen it later.
        </p>
        <label className="mt-3 block text-sm font-medium text-gray-800 dark:text-gray-100">
          Why is it no longer needed? (optional)
          <textarea
            rows={3}
            maxLength={NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
            placeholder="e.g. Donated by a local business"
            className="mt-1 w-full resize-y rounded-lg border border-gray-400 bg-white px-3 py-2 text-sm font-normal text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
          />
          <span className="mt-1 block text-right text-xs font-normal text-gray-500 dark:text-gray-400">
            {note.length} / {NOTE_MAX}
          </span>
        </label>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">
            Keep item
          </button>
          <button type="button" onClick={() => onConfirm(note.trim() || null)} disabled={busy}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50">
            {busy ? "Cancelling..." : "Cancel item"}
          </button>
        </div>
      </div>
    </div>
  );
}
