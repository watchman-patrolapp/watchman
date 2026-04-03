import { useState, useEffect } from 'react';
import { FaTimes } from 'react-icons/fa';

export default function AddIncidentSectionUpdateModal({
  open,
  onClose,
  sectionLabel,
  entryHint,
  onSubmit,
  busy,
}) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (open) setText('');
  }, [open, sectionLabel, entryHint]);

  if (!open) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    void onSubmit(t);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center p-0 sm:p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="section-update-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-600 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-600">
          <h2 id="section-update-title" className="text-lg font-semibold text-gray-900 dark:text-white">
            Add official update
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Close"
          >
            <FaTimes />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Section:{' '}
              <span className="font-medium text-gray-900 dark:text-white">{sectionLabel}</span>
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              This is appended to the original record. It does not replace or edit the first submission.
            </p>
            {entryHint ? (
              <p className="text-xs font-medium text-amber-900 dark:text-amber-200 mt-2">
                Applies only to: {entryHint} (one evidence entry in this section).
              </p>
            ) : null}
          </div>
          <div className="px-4 py-3 flex-1 min-h-0">
            <label htmlFor="section-update-body" className="sr-only">
              Update text
            </label>
            <textarea
              id="section-update-body"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-y min-h-[120px]"
              placeholder="Describe the correction, clarification, or new information…"
              disabled={busy}
              autoFocus
            />
          </div>
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-600 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !text.trim()}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Saving…' : 'Publish update'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
