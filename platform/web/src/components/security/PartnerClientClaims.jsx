import { useState } from "react";
import toast from "react-hot-toast";
import {
  membershipRpcMessage,
  reviewSecurityMembership,
} from "../../utils/securityMembershipActions";

function statusClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "verified") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200";
  if (s === "self_reported") return "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-200";
  if (s === "rejected" || s === "withdrawn") return "bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-200";
  return "bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300";
}

function ClaimCard({
  row,
  busyId,
  rejectingId,
  rejectReason,
  onRejectReason,
  onStartReject,
  onCancelReject,
  onReview,
}) {
  const pending = row.membership_status === "self_reported";
  const rejecting = rejectingId === row.id;
  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 dark:text-white">{row.full_name || "Resident"}</p>
          <p className="text-xs text-gray-500">
            {[row.street_label, row.neighborhood_name].filter(Boolean).join(" · ") || "Area unknown"}
          </p>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-[10px] uppercase ${statusClass(row.membership_status)}`}>
          {row.membership_status === "self_reported" ? "pending" : row.membership_status}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
        <span>Ref {row.member_reference || "—"}</span>
        <span>·</span>
        <span>{row.household_verified ? "Household verified" : "Household not verified"}</span>
      </div>
      {pending && rejecting ? (
        <div className="mt-3 space-y-2">
          <textarea
            value={rejectReason}
            onChange={(event) => onRejectReason(event.target.value)}
            rows={2}
            placeholder="Short reason the resident will see"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busyId === row.id}
              onClick={() => onReview(row, "rejected")}
              className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              Confirm reject
            </button>
            <button
              type="button"
              onClick={onCancelReject}
              className="rounded-xl px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : pending ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busyId === row.id}
            onClick={() => onReview(row, "verified")}
            className="rounded-xl bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
          >
            Verify client
          </button>
          <button
            type="button"
            disabled={busyId === row.id}
            onClick={() => onStartReject(row.id)}
            className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      ) : null}
    </article>
  );
}

export default function PartnerClientClaims({ claims, history, loading, onChanged }) {
  const [tab, setTab] = useState("pending");
  const [busyId, setBusyId] = useState("");
  const [rejectingId, setRejectingId] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  const onReview = async (row, status) => {
    if (status === "rejected" && rejectReason.trim().length < 3) {
      toast.error("Add a short reason the resident will see.");
      return;
    }
    setBusyId(row.id);
    try {
      const { error } = await reviewSecurityMembership(
        row.id,
        status,
        status === "rejected" ? rejectReason.trim() : null
      );
      if (error) throw error;
      toast.success(status === "verified" ? "Client verified." : "Claim rejected.");
      setRejectingId("");
      setRejectReason("");
      await onChanged?.();
    } catch (err) {
      toast.error(membershipRpcMessage(err));
    } finally {
      setBusyId("");
    }
  };

  const rows = tab === "pending" ? claims : history;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab("pending")}
          className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${
            tab === "pending"
              ? "bg-slate-800 text-white ring-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:ring-slate-200"
              : "bg-white text-gray-700 ring-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-600"
          }`}
        >
          Pending ({claims.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("history")}
          className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${
            tab === "history"
              ? "bg-slate-800 text-white ring-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:ring-slate-200"
              : "bg-white text-gray-700 ring-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-600"
          }`}
        >
          History ({history.length})
        </button>
      </div>

      {loading ? (
        <p className="rounded-2xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800">
          Loading client claims…
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800">
          {tab === "pending"
            ? "No pending claims. Residents who name your company appear here for you to verify."
            : "No verified, rejected, or transferred claims yet."}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((row) => (
            <ClaimCard
              key={row.id}
              row={row}
              busyId={busyId}
              rejectingId={rejectingId}
              rejectReason={rejectReason}
              onRejectReason={setRejectReason}
              onStartReject={(id) => {
                setRejectingId(id);
                setRejectReason("");
              }}
              onCancelReject={() => {
                setRejectingId("");
                setRejectReason("");
              }}
              onReview={onReview}
            />
          ))}
        </div>
      )}
    </div>
  );
}
