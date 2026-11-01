import { useCallback, useEffect, useState } from "react";
import { FaClock, FaExclamationTriangle, FaGraduationCap } from "react-icons/fa";
import { useNavigate, useParams } from "react-router-dom";
import NeedGallery from "../../components/needs/NeedGallery";
import { Chip } from "../../components/needs/NeedCard";
import { DANGER_BTN, IssueDialog, SECONDARY_BTN, TransferDialog } from "../../components/equipment/EquipmentLoanDialogs";
import {
  EQUIPMENT_CONDITION_LABELS,
  ISSUE_KIND_LABELS,
  LOAN_STATUS_META,
  cancelEquipmentTransfer,
  formatDueIn,
  listEquipmentUnitCustody,
  runEquipmentSweep,
  EQUIPMENT_LEDGER_EVENT_LABELS,
  equipmentCategoryEmoji,
  equipmentErrorMessage,
  equipmentStatusMeta,
  formatLoanLimit,
  getEquipmentUnit,
  listEquipmentUnitLedger,
} from "../../utils/equipment";
import EquipmentShell, { EquipmentNotice, InfoBox, InfoSection, StatusChip, Timeline } from "./EquipmentShell";

function formatWhen(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(iso);
  }
}

function unitPhotoPaths(unit) {
  const list = [];
  if (unit.photo_path) list.push(unit.photo_path);
  const itemPaths = Array.isArray(unit.item_photo_paths) && unit.item_photo_paths.length ? unit.item_photo_paths : [unit.item_photo_path];
  for (const p of itemPaths) if (p && !list.includes(p)) list.push(p);
  return list.slice(0, 5);
}

/** /equipment/units/:id (and the QR landing): one physical unit plus its history. */
export default function EquipmentUnitPage() {
  const { id: unitId } = useParams();
  const navigate = useNavigate();
  const [unit, setUnit] = useState(null);
  const [history, setHistory] = useState([]);
  const [hint, setHint] = useState("");
  const [loading, setLoading] = useState(true);
  const [custody, setCustody] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [flash, setFlash] = useState("");

  const load = useCallback(
    async (sweep = false) => {
      if (sweep) await runEquipmentSweep();
      const [u, l, c] = await Promise.all([getEquipmentUnit(unitId), listEquipmentUnitLedger(unitId, 20), listEquipmentUnitCustody(unitId)]);
      setLoading(false);
      setUnit(u.error ? null : u.data);
      setHint(u.error ? equipmentErrorMessage(u.error) : "");
      setHistory(l.error ? [] : l.data);
      setCustody(c.error ? [] : c.data);
    },
    [unitId],
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

  const cancelTransfer = async () => {
    const { error } = await cancelEquipmentTransfer(unit.my_transfer_id);
    if (error) return setFlash(equipmentErrorMessage(error));
    done("Transfer request cancelled.");
  };

  const meta = equipmentStatusMeta(unit?.status);
  const holder = unit?.is_mine ? "You" : unit?.holder_name;
  const loan = formatLoanLimit(unit?.max_loan_hours);
  const outOfUse = ["damaged", "stolen", "lost", "retired"].includes(unit?.status);
  const certOk = !unit?.requires_certification || unit?.has_certification;
  const canTransfer = Boolean(unit?.can_borrow && certOk && !unit?.is_mine && unit?.status === "checked_out" && !unit?.my_transfer_id);
  const canReport = Boolean(unit?.i_am_latest_holder && !unit?.issue && !outOfUse);

  return (
    <EquipmentShell
      title={unit ? unit.asset_tag : "Equipment"}
      subtitle={unit?.item_name || ""}
      backTo={unit ? `/equipment/items/${unit.item_id}` : "/equipment"}
      backLabel={unit ? "Back to item" : "Back to equipment"}
      rightSlot={
        unit?.can_manage ? (
          <button
            type="button"
            onClick={() => navigate(`/equipment/admin/items?edit=${unit.item_id}`)}
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
      {unit ? (
        <div className="space-y-4 lg:grid lg:grid-cols-5 lg:gap-4 lg:space-y-0">
          <div className="space-y-4 lg:col-span-3">
            {unit.issue ? (
              <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-800 dark:bg-rose-900/30">
                <FaExclamationTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700 dark:text-rose-300" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-rose-900 dark:text-rose-100">
                    {ISSUE_KIND_LABELS[unit.issue.kind] || unit.issue.kind} reported {formatWhen(unit.issue.reported_at)}
                  </p>
                  <p className="text-sm text-rose-800 dark:text-rose-200">
                    {unit.issue.holder_name ? `Last with ${unit.issue.holder_name}. ` : ""}
                    {unit.issue.note}
                  </p>
                </div>
              </div>
            ) : null}
            <div className={`overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 ${outOfUse ? "opacity-70 grayscale" : ""}`}>
              <NeedGallery paths={unitPhotoPaths(unit)} title={`${unit.item_name} ${unit.asset_tag}`} fullscreen />
              <div className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusChip meta={meta} />
                  <Chip tone="bg-teal-50 text-teal-800 ring-1 ring-teal-200 dark:bg-teal-900/40 dark:text-teal-200 dark:ring-teal-800">
                    <span aria-hidden className="mr-1">{equipmentCategoryEmoji(unit.category_name)}</span>
                    {unit.category_name || "Other"}
                  </Chip>
                  {unit.requires_certification ? (
                    <Chip tone="bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
                      <FaGraduationCap className="mr-1 h-3 w-3" aria-hidden /> Training
                    </Chip>
                  ) : null}
                </div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{unit.item_name}</h2>
                <p className="font-mono text-sm text-gray-500 dark:text-gray-400">{unit.asset_tag}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <InfoBox label="Condition">{EQUIPMENT_CONDITION_LABELS[unit.condition] || unit.condition}</InfoBox>
              <InfoBox label="With">{holder || (unit.last_holder_name && outOfUse ? `Last: ${unit.last_holder_name}` : "In the store")}</InfoBox>
              {unit.due_at ? <InfoBox label="Due back">{`${formatWhen(unit.due_at)} · ${formatDueIn(unit.due_at)}`}</InfoBox> : null}
              <InfoBox label="Kept at">{unit.location_note || "Not set"}</InfoBox>
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
            {canTransfer || unit.my_transfer_id || canReport ? (
              <InfoSection title="Actions">
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {canTransfer ? (
                    <button type="button" onClick={() => setDialog("transfer")} className={SECONDARY_BTN}>
                      Request transfer
                    </button>
                  ) : null}
                  {unit.my_transfer_id ? (
                    <button type="button" onClick={cancelTransfer} className={SECONDARY_BTN}>
                      Transfer requested · Cancel
                    </button>
                  ) : null}
                  {canReport ? (
                    <button type="button" onClick={() => setDialog("issue")} className={DANGER_BTN}>
                      Report issue
                    </button>
                  ) : null}
                </div>
              </InfoSection>
            ) : null}
            {unit.kit_contents ? (
              <InfoSection title="In the kit">
                <p className="whitespace-pre-line text-sm text-gray-700 dark:text-gray-200">{unit.kit_contents}</p>
              </InfoSection>
            ) : null}
          </div>
          <div className="space-y-4 lg:col-span-2">
            <InfoSection title="History">
              <Timeline
                rows={history}
                labelFor={(h) =>
                  h.event === "status_changed" && h.to_status ? equipmentStatusMeta(h.to_status).label : EQUIPMENT_LEDGER_EVENT_LABELS[h.event] || h.event
                }
                whenFor={(h) => formatWhen(h.occurred_at)}
                metaFor={(h) => [h.actor_name ? `by ${h.actor_name}` : null, h.holder_name ? `to ${h.holder_name}` : null].filter(Boolean).join(" · ")}
              />
            </InfoSection>
            <InfoSection title="Who had it">
              {custody.length === 0 ? <p className="text-sm text-gray-600 dark:text-gray-300">Not borrowed yet.</p> : null}
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {custody.map((c) => (
                  <li key={c.loan_id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{c.holder_name || "Someone"}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {formatWhen(c.collected_at)}
                        {c.ended_at ? ` – ${formatWhen(c.ended_at)}` : c.due_at ? ` · due ${formatWhen(c.due_at)}` : ""}
                      </p>
                    </div>
                    <StatusChip meta={c.status === "active" ? { ...LOAN_STATUS_META.active, label: "Has it now" } : LOAN_STATUS_META[c.status] || LOAN_STATUS_META.cancelled} />
                  </li>
                ))}
              </ul>
            </InfoSection>
          </div>
        </div>
      ) : null}
      {dialog === "transfer" && unit ? <TransferDialog unit={unit} onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog === "issue" && unit ? <IssueDialog unit={unit} onClose={() => setDialog(null)} onDone={done} /> : null}
    </EquipmentShell>
  );
}
