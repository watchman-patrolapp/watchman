import { useEffect, useState, useRef } from "react";
import toast from "react-hot-toast";
import PageHeader from "../components/layout/PageHeader";
import {
  deleteSecurityMembershipClaim,
  listSecurityMembershipClaims,
  listSecurityMembershipEvents,
  membershipRpcMessage,
  reviewSecurityMembership,
} from "../utils/securityMembershipActions";
import { formatWatchDateTime } from "../utils/watchTime";

function statusClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "verified") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
  if (s === "self_reported") return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  if (s === "transferred") return "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200";
  if (s === "rejected" || s === "withdrawn" || s === "deleted") return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
  return "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200";
}

export default function SecurityMembershipReview() {
  const [tab, setTab] = useState("pending");
  const [pending, setPending] = useState([]);
  const [history, setHistory] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [rejectingId, setRejectingId] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const loadGen = useRef(0);

  const loadRows = async () => {
    const gen = ++loadGen.current;
    setLoading(true);
    try {
      const [pendingRes, historyRes, eventsRes] = await Promise.all([
        listSecurityMembershipClaims("pending", false),
        listSecurityMembershipClaims("history", false),
        listSecurityMembershipEvents(false),
      ]);
      if (gen !== loadGen.current) return;
      if (pendingRes.error) throw pendingRes.error;
      if (historyRes.error) throw historyRes.error;
      setPending(pendingRes.data || []);
      setHistory(historyRes.data || []);
      setEvents(eventsRes.error ? [] : eventsRes.data || []);
    } catch (err) {
      if (gen !== loadGen.current) return;
      console.error(err);
      toast.error(membershipRpcMessage(err) || "Could not load membership queue.");
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  };

  useEffect(() => {
    void loadRows();
  }, []);

  const runReview = async (row, status) => {
    if (busyId) return;
    if (status === "rejected") {
      if (rejectingId !== row.id) {
        setRejectingId(row.id);
        setRejectReason("");
        return;
      }
      if (rejectReason.trim().length < 3) {
        toast.error("Add a short reason the resident will see.");
        return;
      }
    }
    setBusyId(row.id);
    try {
      const { error } = await reviewSecurityMembership(
        row.id,
        status,
        status === "rejected" ? rejectReason.trim() : null
      );
      if (error) throw error;
      toast.success(
        status === "verified" ? "Membership verified." : status === "rejected" ? "Claim rejected." : "Membership updated."
      );
      setRejectingId("");
      setRejectReason("");
      await loadRows();
    } catch (err) {
      toast.error(membershipRpcMessage(err));
    } finally {
      setBusyId("");
    }
  };

  const runDelete = async (row) => {
    if (busyId) return;
    if (!window.confirm(`Delete the ${row.security_company_name || "company"} claim for ${row.full_name || "this resident"}? This is for mistaken extra companies only.`)) {
      return;
    }
    setBusyId(row.id);
    try {
      const { error } = await deleteSecurityMembershipClaim(row.id);
      if (error) throw error;
      toast.success("Mistaken claim deleted.");
      await loadRows();
    } catch (err) {
      toast.error(membershipRpcMessage(err));
    } finally {
      setBusyId("");
    }
  };

  const rows = tab === "pending" ? pending : tab === "history" ? history : null;

  return (
    <div className="min-h-screen bg-gray-100 p-6 dark:bg-gray-900">
      <div className="mx-auto max-w-5xl space-y-4 rounded-xl bg-white p-5 shadow dark:bg-gray-800">
        <PageHeader
          title="Security membership verification"
          subtitle="Pending claims only. Companies should verify their own clients; use this queue for mistakes, duplicates, and oversight."
          backTo="/admin"
          backLabel="Back to admin"
          className="bg-transparent p-0 shadow-none dark:bg-transparent"
        />

        <div className="flex flex-wrap gap-2">
          {[
            ["pending", `Pending (${pending.length})`],
            ["history", `History (${history.length})`],
            ["moves", `Transfers (${events.filter((e) => e.event_type === "transferred").length})`],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                tab === id
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading queue…</p>
        ) : tab === "moves" ? (
          events.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No membership moves logged yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{event.full_name || "Resident"}</p>
                    <p className="text-xs text-gray-500">
                      {event.event_type === "transferred"
                        ? `${event.from_company_name || "—"} → ${event.to_company_name || "—"}`
                        : `${event.event_type}${event.to_company_name ? ` · ${event.to_company_name}` : event.from_company_name ? ` · ${event.from_company_name}` : ""}`}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400">
                    {event.created_at ? formatWatchDateTime(event.created_at) || "" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {tab === "pending" ? "No pending claims. Extra companies chosen by mistake should appear here until withdrawn or deleted." : "No historical memberships yet."}
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.id} className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white">{row.full_name || "Resident"}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-300">{row.security_company_name || "Company"}</p>
                    <p className="text-xs text-gray-500">
                      {[row.street_label, row.neighborhood_name].filter(Boolean).join(" · ") || "Area unknown"}
                      {row.household_verified ? " · household verified" : ""}
                    </p>
                    <p className="text-xs text-gray-400">Ref {row.member_reference || "—"}</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${statusClass(row.membership_status)}`}>
                    {row.membership_status === "self_reported" ? "pending" : row.membership_status}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {row.membership_status === "self_reported" ? (
                    <>
                      <button
                        type="button"
                        disabled={Boolean(busyId)}
                        onClick={() => runReview(row, "verified")}
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        Verify
                      </button>
                      {rejectingId === row.id ? (
                        <div className="w-full space-y-2">
                          <textarea
                            value={rejectReason}
                            onChange={(event) => setRejectReason(event.target.value)}
                            rows={2}
                            placeholder="Short reason the resident will see"
                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                          />
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={Boolean(busyId)}
                              onClick={() => runReview(row, "rejected")}
                              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              Confirm reject
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRejectingId("");
                                setRejectReason("");
                              }}
                              className="rounded-lg px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={Boolean(busyId)}
                          onClick={() => runReview(row, "rejected")}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={Boolean(busyId)}
                        onClick={() => runReview(row, "withdrawn")}
                        className="rounded-lg bg-gray-600 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
                      >
                        Withdraw
                      </button>
                    </>
                  ) : null}
                  {row.membership_status === "verified" ? (
                    <button
                      type="button"
                      disabled={Boolean(busyId)}
                      onClick={() => runReview(row, "expired")}
                      className="rounded-lg bg-gray-600 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
                    >
                      Mark expired
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={Boolean(busyId)}
                      onClick={() => runDelete(row)}
                      className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
