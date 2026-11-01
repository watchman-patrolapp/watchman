import { useCallback, useEffect, useMemo, useState } from "react";
import { FaChevronRight, FaExchangeAlt } from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { NeedsEmpty } from "../../components/needs/NeedCard";
import { PRIMARY_BTN, SECONDARY_BTN } from "../../components/equipment/EquipmentLoanDialogs";
import {
  TRANSFER_STATUS_LABELS,
  cancelEquipmentLoanRequest,
  cancelEquipmentTransfer,
  equipmentErrorMessage,
  formatDueIn,
  listMyEquipmentLoans,
  listMyEquipmentTransfers,
  loanStatusMeta,
  respondEquipmentTransfer,
  runEquipmentSweep,
  splitMyLoans,
} from "../../utils/equipment";
import EquipmentShell, { EquipmentBanner, EquipmentNotice, FilterPills, InfoSection, StatusChip } from "./EquipmentShell";

function formatWhen(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(iso);
  }
}

function loanLine(l) {
  if (l.status === "active") return [l.due_at ? `Due ${formatWhen(l.due_at)}` : null, l.due_at ? formatDueIn(l.due_at) : null].filter(Boolean).join(" · ");
  if (l.status === "approved") return "Approved. Collect it from your NW admin.";
  if (l.status === "requested") return `Asked ${formatWhen(l.created_at)}${l.desired_due_at ? ` · return by ${formatWhen(l.desired_due_at)}` : ""}`;
  return formatWhen(l.ended_at || l.created_at);
}

/** /equipment/mine: my requests, the gear I hold, transfers to answer, and history. */
export default function EquipmentMine() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loans, setLoans] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hint, setHint] = useState("");
  const [flash, setFlash] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [tab, setTab] = useState("now");

  const load = useCallback(async (sweep = false) => {
    if (sweep) await runEquipmentSweep();
    const [l, t] = await Promise.all([listMyEquipmentLoans(), listMyEquipmentTransfers()]);
    setLoading(false);
    setHint(l.error ? equipmentErrorMessage(l.error) : "");
    setLoans(l.data || []);
    setTransfers(t.data || []);
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  useLiveRefresh(load, { userId: user?.id, kind: "equipment", intervalMs: 30000 });

  const act = async (id, fn, message) => {
    setBusyId(id);
    const { error } = await fn();
    setBusyId(null);
    setFlash(error ? equipmentErrorMessage(error) : message);
    if (!error) void load();
  };

  const { open, past } = useMemo(() => splitMyLoans(loans), [loans]);
  const incoming = transfers.filter((t) => t.direction === "incoming" && t.status === "requested");
  const outgoing = transfers.filter((t) => t.direction === "outgoing" && t.status === "requested");
  const holding = open.filter((l) => l.status === "active").length;

  return (
    <EquipmentShell title="My gear" subtitle="What you've borrowed and asked for." backTo="/equipment" backLabel="Back to equipment">
      <EquipmentBanner title="My gear" subtitle={holding ? `You have ${holding} item${holding === 1 ? "" : "s"} out` : "Nothing out right now"}>
        <button type="button" onClick={() => navigate("/equipment")} className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/30 hover:bg-white/25">
          Browse gear
        </button>
      </EquipmentBanner>
      {hint ? <EquipmentNotice>{hint}</EquipmentNotice> : null}
      {flash ? (
        <p role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900 dark:border-teal-800 dark:bg-teal-900/30 dark:text-teal-100">
          {flash}
        </p>
      ) : null}

      {incoming.length ? (
        <InfoSection title={`Asked to hand over (${incoming.length})`}>
          <ul className="space-y-3">
            {incoming.map((t) => (
              <li key={t.id} className="rounded-xl border border-violet-200 bg-violet-50 p-3 dark:border-violet-800 dark:bg-violet-900/30">
                <p className="flex items-center gap-2 text-sm font-semibold text-violet-900 dark:text-violet-100">
                  <FaExchangeAlt className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="min-w-0 break-words">
                    {t.other_name} wants {t.item_name} <span className="font-mono">{t.asset_tag}</span>
                  </span>
                </p>
                {t.note ? <p className="mt-1 text-sm text-violet-800 dark:text-violet-200">"{t.note}"</p> : null}
                <p className="mt-1 text-xs text-violet-700 dark:text-violet-300">Accept once you've handed it over. They take on your return date.</p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <button type="button" disabled={busyId === t.id} onClick={() => act(t.id, () => respondEquipmentTransfer(t.id, true), "Handed over. It's now theirs.")} className={PRIMARY_BTN}>
                    Accept
                  </button>
                  <button type="button" disabled={busyId === t.id} onClick={() => act(t.id, () => respondEquipmentTransfer(t.id, false), "Transfer declined.")} className={SECONDARY_BTN}>
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </InfoSection>
      ) : null}

      <FilterPills
        options={[
          { id: "now", label: `Current (${open.length + outgoing.length})` },
          { id: "past", label: `History (${past.length})` },
        ]}
        value={tab}
        onChange={setTab}
      />

      {loading ? <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p> : null}

      {tab === "now" && !loading ? (
        open.length + outgoing.length === 0 ? (
          <NeedsEmpty title="Nothing borrowed" body="Open an item in the catalogue and tap Request to borrow." />
        ) : (
          <div className="space-y-3">
            {open.map((l) => (
              <LoanCard key={l.id} loan={l} onOpen={() => navigate(l.unit_id ? `/equipment/units/${l.unit_id}` : `/equipment/items/${l.item_id}`)}>
                {l.status === "requested" || l.status === "approved" ? (
                  <button type="button" disabled={busyId === l.id} onClick={() => act(l.id, () => cancelEquipmentLoanRequest(l.id), "Request cancelled.")} className={`${SECONDARY_BTN} px-3 py-1.5 text-xs`}>
                    Cancel request
                  </button>
                ) : null}
              </LoanCard>
            ))}
            {outgoing.map((t) => (
              <article key={t.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-gray-900 dark:text-white">{t.item_name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      <span className="font-mono">{t.asset_tag}</span> · from {t.other_name}
                    </p>
                  </div>
                  <StatusChip meta={{ label: "Transfer", tone: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200" }} />
                </div>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{TRANSFER_STATUS_LABELS.requested}</p>
                <button type="button" disabled={busyId === t.id} onClick={() => act(t.id, () => cancelEquipmentTransfer(t.id), "Transfer request cancelled.")} className={`${SECONDARY_BTN} mt-2 px-3 py-1.5 text-xs`}>
                  Cancel
                </button>
              </article>
            ))}
          </div>
        )
      ) : null}

      {tab === "past" && !loading ? (
        past.length === 0 ? (
          <NeedsEmpty title="No history yet" body="Returned and closed requests show here." />
        ) : (
          <div className="space-y-3">
            {past.map((l) => (
              <LoanCard key={l.id} loan={l} onOpen={() => navigate(`/equipment/items/${l.item_id}`)} />
            ))}
          </div>
        )
      ) : null}
    </EquipmentShell>
  );
}

function LoanCard({ loan: l, onOpen, children }) {
  const meta = loanStatusMeta(l);
  return (
    <article className={`rounded-2xl border bg-white p-4 shadow-sm dark:bg-gray-800 ${l.is_overdue && l.status === "active" ? "border-red-300 dark:border-red-800" : "border-gray-200 dark:border-gray-700"}`}>
      <button type="button" onClick={onOpen} className="flex w-full items-start justify-between gap-2 text-left">
        <div className="min-w-0">
          <p className="truncate font-semibold text-gray-900 dark:text-white">{l.item_name}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {l.asset_tag ? <span className="font-mono">{l.asset_tag}</span> : "Unit assigned on approval"}
            {l.source === "transfer" ? " · via transfer" : ""}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-2">
          <StatusChip meta={meta} />
          <FaChevronRight className="h-3 w-3 text-gray-400" aria-hidden />
        </span>
      </button>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{loanLine(l)}</p>
      {l.decision_note ? <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Admin note: {l.decision_note}</p> : null}
      {children ? <div className="mt-2 flex flex-wrap gap-2">{children}</div> : null}
    </article>
  );
}
