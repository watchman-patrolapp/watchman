import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaExclamationTriangle, FaGraduationCap } from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import { useLiveRefresh } from "../../../hooks/useLiveRefresh";
import { NeedsEmpty } from "../../../components/needs/NeedCard";
import EquipmentAdminNav from "../../../components/equipment/EquipmentAdminNav";
import { DANGER_BTN, EquipmentSheet, FIELD, LABEL, PRIMARY_BTN, SECONDARY_BTN } from "../../../components/equipment/EquipmentLoanDialogs";
import {
  EQUIPMENT_CONDITION_LABELS,
  ISSUE_KIND_LABELS,
  approveEquipmentLoan,
  clearEquipmentIssue,
  confirmEquipmentCollection,
  confirmEquipmentReturn,
  defaultReturnDate,
  equipmentErrorMessage,
  equipmentStatusMeta,
  extendEquipmentLoan,
  formatDueIn,
  formatLoanLimit,
  listEquipmentIssuesAdmin,
  listEquipmentRequestsAdmin,
  loanStatusMeta,
  rejectEquipmentLoan,
  runEquipmentSweep,
  setEquipmentUnitStatusAdmin,
  toDateTimeLocalValue,
} from "../../../utils/equipment";
import EquipmentShell, { EquipmentBanner, EquipmentNotice, FilterPills, StatusChip } from "../EquipmentShell";

function formatWhen(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(iso);
  }
}

const CARD = "rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800";
const SMALL = "px-3 py-1.5 text-xs";
const TAB_ORDER = ["requested", "approved", "active", "issues"];

/** /equipment/admin/requests: approve, hand over, take back, extend, write off, and clear issue reports. */
export default function EquipmentAdminRequests() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hint, setHint] = useState("");
  const [flash, setFlash] = useState("");
  const [tab, setTab] = useState("requested");
  const [sheet, setSheet] = useState(null); // { type, row }
  const [navKey, setNavKey] = useState(0);
  const tabPicked = useRef(false);

  const load = useCallback(async (sweep = false) => {
    if (sweep) await runEquipmentSweep();
    const [r, i] = await Promise.all([listEquipmentRequestsAdmin(), listEquipmentIssuesAdmin()]);
    setLoading(false);
    const err = r.error || i.error;
    setHint(err ? equipmentErrorMessage(err) : "");
    setRows(r.data || []);
    setIssues(i.data || []);
    setNavKey((k) => k + 1);
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  useLiveRefresh(load, { enabled: !sheet, userId: user?.id, kind: "equipment", intervalMs: 20000 });

  const groups = useMemo(
    () => ({
      requested: rows.filter((r) => r.status === "requested"),
      approved: rows.filter((r) => r.status === "approved"),
      active: rows.filter((r) => r.status === "active"),
      issues,
    }),
    [rows, issues],
  );
  const overdue = groups.active.filter((r) => r.is_overdue).length;

  // Land on the first queue with work in it (once, so live refreshes don't move the admin).
  useEffect(() => {
    if (loading || tabPicked.current) return;
    tabPicked.current = true;
    const first = overdue ? "active" : TAB_ORDER.find((t) => groups[t].length);
    if (first) setTab(first);
  }, [loading, groups, overdue]);

  const done = (message) => {
    setSheet(null);
    setFlash(message);
    void load();
  };

  const tabs = [
    { id: "requested", label: `Requests (${groups.requested.length})` },
    { id: "approved", label: `To collect (${groups.approved.length})` },
    { id: "active", label: overdue ? `Out (${groups.active.length} · ${overdue} overdue)` : `Out (${groups.active.length})` },
    { id: "issues", label: `Issues (${issues.length})` },
  ];
  const list = groups[tab];
  const summary =
    [
      groups.requested.length ? `${groups.requested.length} to decide` : null,
      groups.approved.length ? `${groups.approved.length} to hand over` : null,
      groups.active.length ? `${groups.active.length} out` : null,
      overdue ? `${overdue} overdue` : null,
      issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Nothing waiting. All gear is in.";

  return (
    <EquipmentShell wide title="Loan desk" subtitle="Approve, hand over and take back gear." backTo="/admin" backLabel="Back to Admin Dashboard">
      <EquipmentAdminNav refreshKey={navKey} />
      <EquipmentBanner title="Equipment desk" subtitle={loading ? "Loading..." : summary} />
      {hint ? <EquipmentNotice>{hint}</EquipmentNotice> : null}
      {flash ? (
        <div role="status" className="flex items-start justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900 dark:border-teal-800 dark:bg-teal-900/30 dark:text-teal-100">
          <span>{flash}</span>
          <button type="button" onClick={() => setFlash("")} className="shrink-0 text-xs font-semibold text-teal-800 hover:underline dark:text-teal-200">
            Dismiss
          </button>
        </div>
      ) : null}
      <FilterPills options={tabs} value={tab} onChange={setTab} />
      {loading ? <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p> : null}
      {!loading && !hint && list.length === 0 ? <NeedsEmpty title="All clear" body={EMPTY_COPY[tab]} /> : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {tab === "issues"
          ? issues.map((r) => (
              <article key={r.id} className={CARD}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-gray-900 dark:text-white">{r.item_name}</p>
                    <p className="font-mono text-xs text-gray-500 dark:text-gray-400">{r.asset_tag}</p>
                  </div>
                  <StatusChip meta={equipmentStatusMeta(r.unit_status)} />
                </div>
                <p className="mt-2 flex items-start gap-1.5 text-sm text-rose-800 dark:text-rose-200">
                  <FaExclamationTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  <span className="min-w-0 break-words">
                    {ISSUE_KIND_LABELS[r.kind] || r.kind} by {r.reporter_name} · {formatWhen(r.created_at)}
                  </span>
                </p>
                <p className="mt-1 whitespace-pre-line break-words text-sm text-gray-700 dark:text-gray-200">{r.note}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setSheet({ type: "clear", row: r })} className={PRIMARY_BTN}>
                    Resolve
                  </button>
                  <button type="button" onClick={() => navigate(`/equipment/units/${r.unit_id}`)} className={SECONDARY_BTN}>
                    Timeline
                  </button>
                </div>
              </article>
            ))
          : list.map((r) => {
              const certMissing = r.requires_certification && !r.has_certification;
              return (
                <article key={r.id} className={`${CARD} ${r.is_overdue ? "border-red-300 dark:border-red-800" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-gray-900 dark:text-white">{r.item_name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {r.requester_name}
                        {r.asset_tag ? (
                          <>
                            {" · "}
                            <span className="font-mono">{r.asset_tag}</span>
                          </>
                        ) : null}
                        {r.source === "transfer" ? " · via transfer" : ""}
                      </p>
                    </div>
                    <StatusChip meta={r.status === "active" && !r.is_overdue ? { ...loanStatusMeta(r), label: "Out" } : loanStatusMeta(r)} />
                  </div>
                  <dl className="mt-2 space-y-0.5 text-sm text-gray-600 dark:text-gray-300">
                    {r.status === "active" ? (
                      <div className={r.is_overdue ? "font-medium text-red-700 dark:text-red-300" : ""}>
                        Due {formatWhen(r.due_at)} · {formatDueIn(r.due_at)}
                      </div>
                    ) : (
                      <div>
                        Asked {formatWhen(r.created_at)}
                        {r.desired_due_at ? ` · return by ${formatWhen(r.desired_due_at)}` : ""}
                      </div>
                    )}
                    {r.note ? <div className="break-words">"{r.note}"</div> : null}
                    {r.requires_certification ? (
                      <div className={`flex items-center gap-1 text-xs ${r.has_certification ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
                        <FaGraduationCap className="h-3 w-3" aria-hidden />
                        {r.has_certification ? "Signed off" : "No training sign-off yet"}
                      </div>
                    ) : null}
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {r.status === "requested" ? (
                      <>
                        {certMissing ? (
                          <button type="button" onClick={() => navigate(`/equipment/admin/certifications?item=${r.item_id}`)} className={PRIMARY_BTN}>
                            Sign off first
                          </button>
                        ) : (
                          <button type="button" onClick={() => setSheet({ type: "approve", row: r })} className={PRIMARY_BTN}>
                            Approve
                          </button>
                        )}
                        <button type="button" onClick={() => setSheet({ type: "reject", row: r })} className={DANGER_BTN}>
                          Decline
                        </button>
                      </>
                    ) : null}
                    {r.status === "approved" ? (
                      <>
                        <button type="button" onClick={() => setSheet({ type: "collect", row: r })} className={PRIMARY_BTN}>
                          Handed over
                        </button>
                        <button type="button" onClick={() => setSheet({ type: "reject", row: r })} className={SECONDARY_BTN}>
                          Withdraw
                        </button>
                      </>
                    ) : null}
                    {r.status === "active" ? (
                      <>
                        <button type="button" onClick={() => setSheet({ type: "return", row: r })} className={PRIMARY_BTN}>
                          Returned
                        </button>
                        <button type="button" onClick={() => setSheet({ type: "extend", row: r })} className={`${SECONDARY_BTN} ${SMALL}`}>
                          More time
                        </button>
                        <button type="button" onClick={() => setSheet({ type: "writeoff", row: r })} className={`${DANGER_BTN} ${SMALL}`}>
                          Lost or damaged
                        </button>
                      </>
                    ) : null}
                  </div>
                </article>
              );
            })}
      </div>
      {sheet ? <ActionSheet sheet={sheet} onClose={() => setSheet(null)} onDone={done} /> : null}
    </EquipmentShell>
  );
}

const EMPTY_COPY = {
  requested: "No requests waiting for a decision.",
  approved: "Nothing approved and waiting to be handed over.",
  active: "No gear is out on loan.",
  issues: "No open damage, theft or fault reports.",
};

const WRITE_OFF = { damaged: "Came back damaged", lost: "Lost", stolen: "Stolen" };

function extendDefault(row) {
  const from = Math.max(Date.now(), new Date(row.due_at || Date.now()).getTime());
  return toDateTimeLocalValue(defaultReturnDate(row.max_loan_hours, new Date(from)));
}

function ActionSheet({ sheet, onClose, onDone }) {
  const { type, row } = sheet;
  const units = Array.isArray(row.available_units) ? row.available_units : [];
  const [unitId, setUnitId] = useState(units[0]?.id || "");
  const [note, setNote] = useState("");
  const [due, setDue] = useState(() => {
    if (type === "extend") return extendDefault(row);
    return row.desired_due_at ? toDateTimeLocalValue(row.desired_due_at) : "";
  });
  const [condition, setCondition] = useState("good");
  const [afterReturn, setAfterReturn] = useState("available");
  const [outcome, setOutcome] = useState(type === "writeoff" ? "lost" : "available");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const limit = formatLoanLimit(row.max_loan_hours)?.replace(/^Up to /, "") || null;
  const noteRequired = type === "writeoff" || (type === "return" && afterReturn === "under_repair");
  const blocked = (type === "approve" && !units.length) || (noteRequired && note.trim().length < 3) || (type === "extend" && !due);

  const cfg = {
    approve: { title: `Approve ${row.item_name}`, subtitle: `For ${row.requester_name}. A unit is reserved until they collect it.`, submit: "Approve" },
    reject: { title: row.status === "approved" ? "Withdraw approval" : "Decline request", subtitle: `${row.item_name} for ${row.requester_name}.`, submit: row.status === "approved" ? "Withdraw" : "Decline" },
    collect: { title: `Hand over ${row.asset_tag || row.item_name}`, subtitle: `To ${row.requester_name}. The loan clock starts now.`, submit: "Confirm hand-over" },
    return: { title: `Take back ${row.asset_tag || row.item_name}`, subtitle: `From ${row.requester_name}.`, submit: "Confirm return" },
    extend: { title: `More time for ${row.asset_tag || row.item_name}`, subtitle: `${row.requester_name} is told the new return time.`, submit: "Save new time" },
    writeoff: { title: `${row.asset_tag || row.item_name} lost or damaged`, subtitle: `Closes ${row.requester_name}'s loan and takes the unit out of use.`, submit: "Close loan" },
    clear: { title: `Resolve ${row.asset_tag}`, subtitle: "Choose where the unit goes next.", submit: "Resolve issue" },
  }[type];

  const submit = async (e) => {
    e.preventDefault();
    if (blocked) return;
    setBusy(true);
    let res;
    if (type === "approve") res = await approveEquipmentLoan(row.id, { unitId, note });
    else if (type === "reject") res = await rejectEquipmentLoan(row.id, note);
    else if (type === "collect") res = await confirmEquipmentCollection(row.id, due || null);
    else if (type === "extend") res = await extendEquipmentLoan(row.id, due);
    else if (type === "writeoff") res = await setEquipmentUnitStatusAdmin(row.unit_id, outcome, note.trim());
    else if (type === "return") {
      res = await confirmEquipmentReturn(row.id, { condition, note });
      if (!res.error && afterReturn === "under_repair") {
        const repair = await setEquipmentUnitStatusAdmin(row.unit_id, "under_repair", note.trim());
        if (repair.error) {
          setBusy(false);
          return onDone(`Returned, but it could not be sent to repair: ${equipmentErrorMessage(repair.error)}`);
        }
      }
    } else res = await clearEquipmentIssue(row.id, outcome, note);
    setBusy(false);
    if (res.error) return setError(equipmentErrorMessage(res.error));
    onDone(
      {
        approve: "Approved. The borrower has been told to collect it.",
        reject: "Done. The borrower has been told.",
        collect: "Handed over. The loan is running.",
        return: afterReturn === "under_repair" ? "Returned and sent for repair." : "Returned. The unit is available again.",
        extend: "Return time updated. The borrower has been told.",
        writeoff: "Loan closed. The unit is out of use until you change its status.",
        clear: "Issue resolved.",
      }[type],
    );
  };

  return (
    <EquipmentSheet title={cfg.title} subtitle={cfg.subtitle} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {type === "approve" ? (
          units.length ? (
            <div>
              <label htmlFor="eq-unit" className={LABEL}>
                Unit
              </label>
              <select id="eq-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)} className={FIELD}>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.asset_tag}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-sm text-rose-700 dark:text-rose-300">No unit is free right now. Approve again once one is returned.</p>
          )
        ) : null}
        {type === "collect" || type === "extend" ? (
          <div>
            <label htmlFor="eq-cdue" className={LABEL}>
              {type === "extend" ? "New return time" : "Due back"}
            </label>
            <input id="eq-cdue" type="datetime-local" value={due} min={toDateTimeLocalValue(new Date())} onChange={(e) => setDue(e.target.value)} className={FIELD} />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {type === "extend"
                ? `Currently due ${formatWhen(row.due_at)}.${row.is_overdue ? " The unit stops showing as overdue." : ""}`
                : `${row.desired_due_at ? `Prefilled with the time ${row.requester_name} asked for.` : `Leave empty to use ${limit ? `the ${limit} loan limit` : "7 days"}.`}${limit ? ` Capped at ${limit} from now.` : ""}`}
            </p>
          </div>
        ) : null}
        {type === "return" ? (
          <>
            <div>
              <label htmlFor="eq-cond" className={LABEL}>
                Condition now
              </label>
              <select id="eq-cond" value={condition} onChange={(e) => setCondition(e.target.value)} className={FIELD}>
                {Object.entries(EQUIPMENT_CONDITION_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="eq-after" className={LABEL}>
                Unit goes to
              </label>
              <select id="eq-after" value={afterReturn} onChange={(e) => setAfterReturn(e.target.value)} className={FIELD}>
                <option value="available">Back on the shelf (available)</option>
                <option value="under_repair">Needs repair</option>
              </select>
            </div>
          </>
        ) : null}
        {type === "writeoff" ? (
          <div>
            <label htmlFor="eq-wo" className={LABEL}>
              What happened
            </label>
            <select id="eq-wo" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={FIELD}>
              {Object.entries(WRITE_OFF).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">If it turns up or gets fixed, set it back to Available from the unit's Status button.</p>
          </div>
        ) : null}
        {type === "clear" ? (
          <div>
            <label htmlFor="eq-out" className={LABEL}>
              Unit goes to
            </label>
            <select id="eq-out" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={FIELD}>
              <option value="available">Available (fixed or found)</option>
              <option value="under_repair">Under repair</option>
              <option value="retired">Retired</option>
            </select>
          </div>
        ) : null}
        {type !== "collect" && type !== "extend" ? (
          <div>
            <label htmlFor="eq-anote" className={LABEL}>
              {noteRequired ? "Details" : "Note (optional)"}
            </label>
            <textarea id="eq-anote" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={FIELD} />
          </div>
        ) : null}
        {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-900/30 dark:text-rose-200">{error}</p> : null}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={SECONDARY_BTN}>
            Cancel
          </button>
          <button type="submit" disabled={busy || blocked} className={type === "reject" || type === "writeoff" ? DANGER_BTN : PRIMARY_BTN}>
            {busy ? "Saving..." : cfg.submit}
          </button>
        </div>
      </form>
    </EquipmentSheet>
  );
}
