import { useCallback, useEffect, useState } from "react";
import { FaCheck, FaTimes, FaInbox, FaCodeBranch } from "react-icons/fa";
import toast from "../../utils/notify";
import {
  approveOrganizationRequest,
  listOrganizationRequests,
  mergeSuburbRequest,
  rejectOrganizationRequest,
  reviewWatchJoin,
} from "../../utils/organizationRequests";
import {
  canMergeRequest,
  duplicateReasonLabel,
  isMemberJoinPerson,
  joinRequestNote,
  mergeConfirmText,
  mergeResultMessage,
  requestDuplicates,
  requestPeople,
  requestSuburbLine,
  requestSummary,
  requestedRoleLabel,
  sortRequests,
} from "../../utils/organizationRequestsView";
import MergeRequestPicker from "./MergeRequestPicker";

function formatWhen(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Pending watch and security-company requests. Platform staff, global admins and
 * technical support approve or reject here; approval unlocks the requester's admin tools.
 */
export default function OrganizationRequestsPanel({ onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [mergingId, setMergingId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(sortRequests(await listOrganizationRequests()));
      setMessage("");
    } catch (err) {
      setItems([]);
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const merge = async (item, target) => {
    if (!window.confirm(mergeConfirmText(item, target))) return;
    const note = window.prompt("Optional note for the record (not sent to them):", "");
    setBusy(`merge:${item.organization_id}`);
    try {
      const result = await mergeSuburbRequest(item.organization_id, target.id, note || null);
      toast.success(mergeResultMessage(result));
      setMergingId("");
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy("");
    }
  };

  const reviewMember = async (approve, item, person) => {
    if (!approve && !window.confirm(`Decline ${person.name}'s request to join ${item.name}?`)) return;
    setBusy(`member:${item.organization_id}:${person.user_id}`);
    try {
      await reviewWatchJoin(item.organization_id, person.user_id, approve, null);
      toast.success(approve ? `${person.name} is now a member of ${item.name}.` : `${person.name}'s request was declined.`);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy("");
    }
  };

  const act = async (kind, item, person = null) => {
    if (person && isMemberJoinPerson(person)) {
      await reviewMember(kind === "approve", item, person);
      return;
    }
    const who = person ? person.name : item.name;
    if (kind === "reject") {
      const ok = window.confirm(
        person
          ? `Reject ${who}'s admin request for ${item.name}? They stay a resident.`
          : `Reject “${item.name}”? It is hidden, the name is freed for a real group, and the requester stays a resident.`
      );
      if (!ok) return;
    }
    const note = kind === "reject" ? window.prompt("Optional note for the record (not sent to them):", "") : null;
    const key = `${kind}:${item.organization_id}:${person?.user_id || ""}`;
    setBusy(key);
    try {
      if (kind === "approve") {
        await approveOrganizationRequest(item.organization_id, person?.user_id || null, null);
        toast.success(person ? `${who} is now an admin of ${item.name}.` : `${item.name} is approved. Admin tools are unlocked.`);
      } else {
        await rejectOrganizationRequest(item.organization_id, person?.user_id || null, note || null);
        toast.success(person ? `${who}'s request was rejected.` : `${item.name} was rejected.`);
      }
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow" aria-labelledby="org-requests-heading">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="org-requests-heading" className="text-lg font-semibold text-gray-900 dark:text-white">
            Pending requests
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            New watches, suburbs and security companies, and people waiting to join a watch. Nobody gets access
            until you approve. Merge a duplicate into the existing watch instead of approving it.
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="btn-ghost text-sm" disabled={loading}>
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Loading requests…</p>
      ) : message ? (
        <p className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-100">
          {message}
        </p>
      ) : items.length === 0 ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <FaInbox className="h-4 w-4" aria-hidden />
          Nothing waiting for review.
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          {items.map((item) => {
            const people = requestPeople(item);
            const isJoin = item.kind === "join";
            const duplicates = requestDuplicates(item);
            const mergeable = canMergeRequest(item);
            const suburbLine = requestSuburbLine(item);
            return (
              <li key={`${item.kind}-${item.organization_id}`} className="rounded-lg border p-3 dark:border-gray-700">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white break-words">{item.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{requestSummary(item)}</p>
                    {suburbLine ? (
                      <p className="text-xs text-gray-500 dark:text-gray-400">Suburb: {suburbLine}</p>
                    ) : null}
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      Requested {formatWhen(item.requested_at)}
                      {item.registration ? ` · Registration ${item.registration}` : ""}
                    </p>
                  </div>
                  {!isJoin ? (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        className="btn-primary text-sm inline-flex items-center gap-1"
                        disabled={Boolean(busy)}
                        onClick={() => void act("approve", item)}
                      >
                        <FaCheck className="h-3 w-3" aria-hidden /> Approve
                      </button>
                      {mergeable ? (
                        <button
                          type="button"
                          className="btn-secondary text-sm inline-flex items-center gap-1"
                          disabled={Boolean(busy)}
                          aria-expanded={mergingId === item.organization_id}
                          onClick={() => setMergingId((id) => (id === item.organization_id ? "" : item.organization_id))}
                        >
                          <FaCodeBranch className="h-3 w-3" aria-hidden /> Merge into…
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn-ghost text-sm inline-flex items-center gap-1 text-red-700 dark:text-red-300"
                        disabled={Boolean(busy)}
                        onClick={() => void act("reject", item)}
                      >
                        <FaTimes className="h-3 w-3" aria-hidden /> Reject
                      </button>
                    </div>
                  ) : null}
                </div>
                {!isJoin && duplicates.length ? (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-sm dark:border-amber-800 dark:bg-amber-900/20">
                    <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">Possible duplicates</p>
                    <ul className="mt-1 space-y-1">
                      {duplicates.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span className="min-w-0 text-amber-900 dark:text-amber-100">
                            {d.name}
                            {d.suburb ? <span className="text-xs"> · {d.suburb}</span> : null}
                            <span className="ml-1 text-xs opacity-80">({duplicateReasonLabel(d.reason)})</span>
                          </span>
                          {mergeable ? (
                            <button
                              type="button"
                              className="btn-ghost text-xs inline-flex items-center gap-1"
                              disabled={Boolean(busy)}
                              onClick={() => void merge(item, d)}
                            >
                              <FaCodeBranch className="h-3 w-3" aria-hidden /> Merge into this
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {mergingId === item.organization_id && mergeable ? (
                  <MergeRequestPicker
                    item={item}
                    busy={Boolean(busy)}
                    onPick={(target) => void merge(item, target)}
                    onCancel={() => setMergingId("")}
                  />
                ) : null}
                {people.length ? (
                  <ul className="mt-2 space-y-1.5">
                    {people.map((p) => (
                      <li
                        key={p.user_id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-gray-50 px-2 py-1.5 text-sm dark:bg-gray-900/40"
                      >
                        <span className="min-w-0">
                          <span className="font-medium text-gray-800 dark:text-gray-100">{p.name}</span>
                          <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                            {isJoin && isMemberJoinPerson(p) ? joinRequestNote(p) : requestedRoleLabel(p.member_role)}
                            {p.membership_status === "pending" ? " · waiting" : " · already active"}
                          </span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400 break-all">
                            {[p.email, p.phone].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        {isJoin && p.membership_status === "pending" ? (
                          <span className="flex gap-2">
                            <button
                              type="button"
                              className="btn-primary text-xs inline-flex items-center gap-1"
                              disabled={Boolean(busy)}
                              onClick={() => void act("approve", item, p)}
                            >
                              <FaCheck className="h-3 w-3" aria-hidden /> Approve
                            </button>
                            <button
                              type="button"
                              className="btn-ghost text-xs inline-flex items-center gap-1 text-red-700 dark:text-red-300"
                              disabled={Boolean(busy)}
                              onClick={() => void act("reject", item, p)}
                            >
                              <FaTimes className="h-3 w-3" aria-hidden /> Reject
                            </button>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">No requester recorded.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
