import { useEffect, useState } from "react";
import { FaClock, FaGraduationCap } from "react-icons/fa";
import { useNavigate, useParams } from "react-router-dom";
import NeedGallery from "../../components/needs/NeedGallery";
import { Chip } from "../../components/needs/NeedCard";
import {
  EQUIPMENT_CONDITION_LABELS,
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

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([getEquipmentUnit(unitId), listEquipmentUnitLedger(unitId, 20)]).then(([u, l]) => {
      if (!alive) return;
      setLoading(false);
      setUnit(u.error ? null : u.data);
      setHint(u.error ? equipmentErrorMessage(u.error) : "");
      setHistory(l.error ? [] : l.data);
    });
    return () => {
      alive = false;
    };
  }, [unitId]);

  const meta = equipmentStatusMeta(unit?.status);
  const holder = unit?.is_mine ? "You" : unit?.holder_name;
  const loan = formatLoanLimit(unit?.max_loan_hours);

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
      {loading ? <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p> : null}
      {unit ? (
        <div className="space-y-4 lg:grid lg:grid-cols-5 lg:gap-4 lg:space-y-0">
          <div className="space-y-4 lg:col-span-3">
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
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
              <InfoBox label="With">{holder || "In the store"}</InfoBox>
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
            <p className="text-xs text-gray-500 dark:text-gray-400">Checkout and return arrive in the next update.</p>
          </div>
        </div>
      ) : null}
    </EquipmentShell>
  );
}
