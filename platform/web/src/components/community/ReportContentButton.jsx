import { useState } from "react";
import { createPortal } from "react-dom";
import { FaEllipsisH } from "react-icons/fa";
import toast from "../../utils/notify";
import { isRpcNotFoundError } from "../../utils/isRpcNotFound";
import useDialogA11y from "../../hooks/useDialogA11y";
import {
  reportCommunityContent,
  REPORT_REASONS,
  friendlyReportError,
} from "../../utils/communityReports";

export { REPORT_REASONS };

/** Subtle overflow menu. Children stay mounted when closed so a Report dialog can stay open. */
export function OverflowMenu({ children, align = "right", label = "More actions" }) {
  const [open, setOpen] = useState(false);
  const menuPos = align === "left" ? "left-0" : "right-0";
  const hidden = open ? "" : "hidden";
  return (
    <div className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
      >
        <FaEllipsisH className="h-3.5 w-3.5" />
      </button>
      <div
        role="menu"
        onClick={() => setOpen(false)}
        className={"absolute z-30 mt-1 min-w-[9rem] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-900 " + menuPos + " " + hidden}
      >
        {children}
      </div>
      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-20 cursor-default"
          onClick={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** Unobtrusive report trigger that opens a shared reason dialog. */
export default function ReportContentButton({
  contentType,
  contentId,
  currentUserId,
  authorUserId,
  variant = "button",
  className = "",
  onReported,
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useDialogA11y(open);

  if (!contentType || !contentId) return null;
  if (currentUserId && authorUserId && currentUserId === authorUserId) return null;

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await reportCommunityContent({
        contentType,
        contentId,
        reason,
        details,
      });
      if (error) {
        if (isRpcNotFoundError(error)) {
          toast.error("Reporting isn't available yet. Please try again later.");
        } else {
          toast.error(friendlyReportError(error));
        }
        return;
      }
      toast.success("Thanks, a moderator will review it.");
      setOpen(false);
      setDetails("");
      onReported?.();
    } finally {
      setBusy(false);
    }
  }

  const trigger =
    variant === "menuItem" ? (
      <button
        type="button"
        role="menuitem"
        onClick={() => setOpen(true)}
        className={"block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800 " + className}
      >
        Report
      </button>
    ) : variant === "quietLink" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={"text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 " + className}
      >
        Report
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={"text-xs font-medium text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 " + className}
      >
        Report
      </button>
    );

  const dialog = open
    ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !busy && setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Report content"
            className="w-full max-w-sm rounded-xl bg-white p-4 shadow-lg dark:bg-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-200">
              Report this content
            </h3>
            <form onSubmit={submit} className="space-y-3">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Why are you reporting this?
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
                >
                  {REPORT_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
                rows={2}
                placeholder="Optional details"
                className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {busy ? "Sending..." : "Submit report"}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      {trigger}
      {dialog}
    </>
  );
}
