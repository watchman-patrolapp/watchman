import { useState } from "react";
import { createPortal } from "react-dom";
import toast from "../../utils/notify";
import useDialogA11y from "../../hooks/useDialogA11y";
import { blockUser, unblockUser, useBlockedUserIds } from "../../utils/userBlocks";

/**
 * Quiet Block / Unblock control that sits next to Report.
 * variant: "menuItem" (inside a ⋯ menu) or "quietLink" (small grey text).
 */
export default function BlockUserButton({
  targetUserId,
  currentUserId,
  targetName,
  variant = "menuItem",
  className = "",
  onChanged,
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dialogRef = useDialogA11y(open);
  const blocked = useBlockedUserIds(currentUserId);

  if (!targetUserId || !currentUserId || String(targetUserId) === String(currentUserId)) return null;
  const isBlocked = blocked.has(String(targetUserId));
  const who = targetName?.trim() || "this member";

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      const err = isBlocked
        ? await unblockUser(currentUserId, targetUserId)
        : await blockUser(currentUserId, targetUserId);
      if (err) {
        toast.error(err);
        return;
      }
      toast.success(isBlocked ? "Member unblocked." : "Member blocked. You won't see their messages or posts.");
      setOpen(false);
      onChanged?.(!isBlocked);
    } finally {
      setBusy(false);
    }
  }

  const label = isBlocked ? "Unblock" : "Block";
  const trigger =
    variant === "quietLink" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={"text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 " + className}
      >
        {label}
      </button>
    ) : (
      <button
        type="button"
        role="menuitem"
        onClick={() => setOpen(true)}
        className={"block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800 " + className}
      >
        {label}
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
            aria-label={isBlocked ? "Unblock member" : "Block member"}
            className="w-full max-w-sm rounded-xl bg-white p-4 shadow-lg dark:bg-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
              {isBlocked ? `Unblock ${who}?` : `Block ${who}?`}
            </h3>
            <p className="mb-4 text-xs text-gray-600 dark:text-gray-300">
              {isBlocked
                ? "You'll see their chat messages and City Hub posts again."
                : "You won't see their chat messages or City Hub posts. They won't be told. Emergency messages and suspect alerts still show, for everyone's safety."}
            </p>
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
                type="button"
                onClick={confirm}
                disabled={busy}
                className={
                  "rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60 " +
                  (isBlocked ? "bg-teal-600 hover:bg-teal-700" : "bg-red-600 hover:bg-red-700")
                }
              >
                {busy ? "Saving..." : label}
              </button>
            </div>
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
