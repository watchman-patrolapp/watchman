import { useEffect, useState } from "react";
import { FaChevronRight, FaClock, FaGraduationCap } from "react-icons/fa";
import { useNavigate, useParams } from "react-router-dom";
import NeedGallery from "../../components/needs/NeedGallery";
import { Chip, NeedsEmpty } from "../../components/needs/NeedCard";
import {
  EQUIPMENT_CONDITION_LABELS,
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

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getEquipmentItem(id).then(({ data, error }) => {
      if (!alive) return;
      setLoading(false);
      setItem(error ? null : data);
      setHint(error ? equipmentErrorMessage(error) : "");
    });
    return () => {
      alive = false;
    };
  }, [id]);

  const units = item?.units || [];
  const free = units.filter((u) => u.status === "available").length;
  const loan = formatLoanLimit(item?.max_loan_hours);

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
                      <FaGraduationCap className="mr-1 h-3 w-3" aria-hidden /> Training recommended
                    </Chip>
                  ) : null}
                  {item.is_archived ? <Chip tone="bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200">Archived</Chip> : null}
                </div>
                <p className="whitespace-pre-line text-sm text-gray-700 dark:text-gray-200">{item.description || "No description yet."}</p>
              </div>
            </div>
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
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/equipment/units/${u.id}`)}
                      className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-semibold text-gray-900 dark:text-white">{u.asset_tag}</p>
                        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                          {[
                            EQUIPMENT_CONDITION_LABELS[u.condition] || u.condition,
                            u.is_mine ? "With you" : u.holder_name ? `With ${u.holder_name}` : null,
                            u.location_note,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <span className="flex shrink-0 items-center gap-2">
                        <StatusChip meta={equipmentStatusMeta(u.status)} />
                        <FaChevronRight className="h-3 w-3 text-gray-400" aria-hidden />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </InfoSection>
          </div>
        </div>
      ) : null}
    </EquipmentShell>
  );
}
