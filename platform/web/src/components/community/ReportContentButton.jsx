import { useState } from "react";
import toast from "react-hot-toast";
import { supabase } from "../../supabase/client";
import { isRpcNotFoundError } from "../../utils/isRpcNotFound";

export const REPORT_REASONS = [
  { value: "spam", label: "Spam" },
  { value: "scam", label: "Scam" },
  { value: "offensive", label: "Offensive" },
  { value: "false_info", label: "False information" },
  { value: "privacy", label: "Privacy concern" },
  { value: "duplicate", label: "Duplicate" },
  { value: "other", label: "Other" },
];

function friendlyReportError(error) {
  const msg = String(error?.message || "").toLowerCase();
  if (msg.includes("already reported")) return "You have already reported this.";
  if (msg.includes("too many reports")) return "You've reached today's report limit. Try again tomorrow.";
  if (msg.includes("not found")) return "This item is no longer available.";
  if (msg.includes("cannot be reported")) return "This item can't be reported yet.";
  return "Could not send the report. Please try again.";
}

/** Small "Report" menu that calls report_community_content. */
export default function ReportContentButton({ contentType, contentId, className = "", onReported }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  if (!contentType || !contentId) return null;

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("report_community_content", {
        p_content_type: contentType,
        p_content_id: contentId,
        p_reason: reason,
        p_details: details.trim() || null,
      });
      if (error) {
        if (isRpcNotFoundError(error)) {
          toast.error("Reporting isn't available yet. Run the P0b SQL in Supabase first.");
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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`text-xs font-medium text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 ${className}`}
      >
        Report
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className={`mt-2 space-y-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800 ${className}`}
    >
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
          {busy ? "Sending." : "Send report"}
        </button>
      </div>
    </form>
  );
}
