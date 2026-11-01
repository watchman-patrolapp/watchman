import { useCallback, useEffect, useState } from "react";
import { FaChevronRight, FaClock, FaExclamationTriangle, FaGraduationCap, FaLock } from "react-icons/fa";
import { useNavigate, useParams } from "react-router-dom";
import NeedGallery from "../../components/needs/NeedGallery";
import { Chip, NeedsEmpty } from "../../components/needs/NeedCard";
import { BorrowDialog, DANGER_BTN, IssueDialog, PRIMARY_BTN, SECONDARY_BTN, TransferDialog } from "../../components/equipment/EquipmentLoanDialogs";
import {
  EQUIPMENT_CONDITION_LABELS,
  ISSUE_KIND_LABELS,
  cancelEquipmentLoanRequest,
  cancelEquipmentTransfer,
  formatDueIn,
  loanStatusMeta,
  runEquipmentSweep,
  equipmentCategoryEmoji,
  equipmentErrorMessage,
  equipmentItemPhotoPaths,
  equipmentStatusMeta,
  formatLoanLimit,
  getEquipmentItem,
} from "../../utils/equipment";
import EquipmentShell, { EquipmentNotice, InfoBox, InfoSection, StatusChip } from "./EquipmentShell";

/** /equipment/items/:id: gallery, details and the item's units (no prices, serials or QR tokens). */
export default function EquipmentItemPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState(null);
  const [hint, setHint] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null); // { type: "borrow" | "transfer" | "issue", unit? }
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (sweep = false) => {
      if (sweep) await runEquipmentSweep(); // flags overdue loans and expires stale requests; errors ignored
      const { data, error } = await getEquipmentItem(id);
      setLoading(false);
      setItem(error ? null : data);
      setHint(error ? equipmentErrorMessage(error) : "");
    },
    [id],
  );

  useEffect(() => {
    setLoading(true);
    void load(true);
  }, [load]);

  const done = (message) => {
    setDialog(null);
    setFlash(message);
    void load();
  };

  const act = async (fn, message) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) return setFlash(equipmentErrorMessage(error));
    done(message);
  };

  const units = item?.units || [];
  const free = units.filter((u) => u.status === "available").length;
  const loan = formatLoanLimit(item?.max_loan_hours);
  const myLoan = item?.my_open_loan || null;
  const certBlocked = Boolean(item?.requires_certification && !item?.has_certification);

  return (
    <EquipmentShell
      title={item?.name || "Equipment"}
      subtitle={item?.category_name || "Watch gear"}
      backTo="/equipment"
      backLabel="Back to equipment"
      rightSlot={
        item?.can_manage ? (
          <button
            type="button"
            onClick={() => navigate(`/equipment/admin/items?edit=${item.id}`)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            Manage
          </button>
        ) : null
      }
    >
      {hint ? <EquipmentNotice>{hint}</EquipmentNotice> : null}
      {flash ? (
        <p role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900 dark:border-teal-800 dark:bg-teal-900/30 dark:text-teal-100">
          {flash}
        </p>
      ) : null}
      {loading ? <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p> : null}
      {item ? (
        <div className="space-y-4 lg:grid lg:grid-cols-5 lg:gap-4 lg:space-y-0">
          <div className="space-y-4 lg:col-span-3">
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <NeedGallery paths={equipmentItemPhotoPaths(item)} title={item.name} fullscreen />
              <div className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip tone="bg-teal-50 text-teal-800 ring-1 ring-teal-200 dark:bg-teal-900/40 dark:text-teal-200 dark:ring-teal-800">
                    <span aria-hidden className="mr-1">{equipmentCategoryEmoji(item.category_name)}</span>
                    {item.category_name || "Other"}
                  </Chip>
                  <Chip
                    tone={
                      free
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                    }
                  >
                    {units.length ? `${free} of ${units.length} free` : "No units yet"}
                  </Chip>
                  {item.requires_certification ? (
                    <Chip tone="bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
                      <FaGraduationCap className="mr-1 h-3 w-3" aria-hidden /> {item.has_certification ? "Signed off" : "Training required"}
                    </Chip>
                  ) : null}
                  {item.is_archived ? <Chip tone="bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200">Archived</Chip> : null}
                </div>
                <p className="whitespace-pre-line text-sm text-gray-700 dark:text-gray-200">{item.description || "No description yet."}</p>
              </div>
            </div>
            <BorrowPanel
              item={item}
              myLoan={myLoan}
              free={free}
              certBlocked={certBlocked}
              busy={busy}
              onBorrow={() => setDialog({ type: "borrow" })}
              onCancel={() => act(() => cancelEquipmentLoanRequest(myLoan.id), "Request cancelled.")}
              onMine={() => navigate("/equipment/mine")}
            />
            <div className="grid grid-cols-2 gap-2">
              <InfoBox label="Available">{units.length ? `${free} of ${units.length}` : "None yet"}</InfoBox>
              <InfoBox label="Loan limit">
                {loan ? (
                  <span className="inline-flex items-center gap-1">
                    <FaClock className="h-3 w-3" aria-hidden /> {loan}
                  </span>
                ) : (
                  "Ask your admin"
                )}
              </InfoBox>
            </div>
            {item.kit_contents ? (
              <InfoSection title="In the kit">
                <ul className="list-disc space-y-0.5 pl-5 text-sm text-gray-700 dark:text-gray-200">
                  {item.kit_contents
                    .split(/\n|,/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                </ul>
              </InfoSection>
            ) : null}
          </div>
          <div className="lg:col-span-2">
            <InfoSection title={`Units (${units.length})`}>
              {units.length === 0 ? <NeedsEmpty title="No units yet" body="Your NW admin adds units with asset tags." /> : null}
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {units.map((u) => (
                  <UnitRow
                    key={u.id}
                    unit={u}
                    canRequestTransfer={Boolean(item.can_borrow && !certBlocked && !myLoan)}
                    busy={busy}
                    onOpen={() => navigate(`/equipment/units/${u.id}`)}
                    onTransfer={() => setDialog({ type: "transfer", unit: u })}
                    onCancelTransfer={() => act(() => cancelEquipmentTransfer(u.my_transfer_id), "Transfer request cancelled.")}
                    onIssue={() => setDialog({ type: "issue", unit: u })}
                  />
                ))}
              </ul>
            </InfoSection>
          </div>
        </div>
      ) : null}
      {dialog?.type === "borrow" ? <BorrowDialog item={item} onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog?.type === "transfer" ? <TransferDialog unit={dialog.unit} onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog?.type === "issue" ? <IssueDialog unit={dialog.unit} onClose={() => setDialog(null)} onDone={done} /> : null}
    </EquipmentShell>
  );
}

/** Borrow card: request button, cert-gated state, or the status of my open request/loan. */
function BorrowPanel({ item, myLoan, free, certBlocked, busy, onBorrow, onCancel, onMine }) {
  if (!item.can_borrow && !myLoan) {
    return item.can_manage ? null : (
      <InfoSection title="Borrow">
        <p className="text-sm text-gray-600 dark:text-gray-300">Only patrol members of this neighbourhood can borrow equipment.</p>
      </InfoSection>
    );
  }
  if (myLoan) {
    const meta = loanStatusMeta(myLoan);
    return (
      <InfoSection title="Your request">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip meta={meta} />
            {myLoan.status === "active" && myLoan.due_at ? (
              <span className="text-sm text-gray-600 dark:text-gray-300">{formatDueIn(myLoan.due_at)}</span>
            ) : null}
            {myLoan.status === "requested" ? <span className="text-sm text-gray-600 dark:text-gray-300">Waiting for your NW admin.</span> : null}
            {myLoan.status === "approved" ? <span className="text-sm text-gray-600 dark:text-gray-300">Collect it from your NW admin.</span> : null}
          </div>
          <div className="flex gap-2">
            {myLoan.status === "requested" || myLoan.status === "approved" ? (
              <button type="button" disabled={busy} onClick={onCancel} className={SECONDARY_BTN}>
                Cancel
              </button>
            ) : null}
            <button type="button" onClick={onMine} className={SECONDARY_BTN}>
              My gear
            </button>
          </div>
        </div>
      </InfoSection>
    );
  }
  if (certBlocked) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-900/30">
        <FaLock className="mt-0.5 h-4 w-4 shrink-0 text-violet-700 dark:text-violet-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-violet-900 dark:text-violet-100">Training sign-off needed</p>
          <p className="text-sm text-violet-800 dark:text-violet-200">Ask your NW admin to sign you off on this item, then you can request it.</p>
          <button type="button" disabled className={`${PRIMARY_BTN} mt-3 w-full sm:w-auto`}>
            Request to borrow
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-gray-700 dark:text-gray-200">
        {free ? "Ask to borrow this for patrol. An admin approves and hands it over." : "No unit is free right now. You can ask a current holder for a transfer below."}
      </p>
      <button type="button" disabled={!free || busy || item.is_archived} onClick={onBorrow} className={`${PRIMARY_BTN} w-full shrink-0 sm:w-auto`}>
        Request to borrow
      </button>
    </div>
  );
}

function UnitRow({ unit: u, canRequestTransfer, busy, onOpen, onTransfer, onCancelTransfer, onIssue }) {
  const greyed = Boolean(u.issue) || ["damaged", "stolen", "lost", "retired"].includes(u.status);
  const sub = [
    EQUIPMENT_CONDITION_LABELS[u.condition] || u.condition,
    u.is_mine ? "With you" : u.holder_name ? `With ${u.holder_name}` : null,
    u.due_at && (u.status === "checked_out" || u.status === "overdue") ? formatDueIn(u.due_at) : null,
    u.location_note,
  ].filter(Boolean);
  const showTransfer = canRequestTransfer && !u.is_mine && u.status === "checked_out";
  const showIssue = u.i_am_latest_holder && !u.issue && !["damaged", "stolen", "lost", "retired"].includes(u.status);
  return (
    <li className={`py-3 ${greyed ? "opacity-60" : ""}`}>
      <button type="button" onClick={onOpen} className="flex w-full items-center justify-between gap-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold text-gray-900 dark:text-white">{u.asset_tag}</p>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">{sub.join(" · ")}</p>
        </div>
        <span className="flex shrink-0 items-center gap-2">
          <StatusChip meta={equipmentStatusMeta(u.status)} />
          <FaChevronRight className="h-3 w-3 text-gray-400" aria-hidden />
        </span>
      </button>
      {u.issue ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-rose-800 dark:text-rose-200">
          <FaExclamationTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">
            {ISSUE_KIND_LABELS[u.issue.kind] || u.issue.kind} reported{u.issue.holder_name ? ` · last with ${u.issue.holder_name}` : ""}
            {u.issue.note ? `: ${u.issue.note}` : ""}
          </span>
        </p>
      ) : null}
      {showTransfer || u.my_transfer_id || showIssue ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {u.my_transfer_id ? (
            <button type="button" disabled={busy} onClick={onCancelTransfer} className={`${SECONDARY_BTN} px-3 py-1.5 text-xs`}>
              Transfer requested · Cancel
            </button>
          ) : showTransfer ? (
            <button type="button" onClick={onTransfer} className={`${SECONDARY_BTN} px-3 py-1.5 text-xs`}>
              Request transfer
            </button>
          ) : null}
          {showIssue ? (
            <button type="button" onClick={onIssue} className={`${DANGER_BTN} px-3 py-1.5 text-xs`}>
              Report issue
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
