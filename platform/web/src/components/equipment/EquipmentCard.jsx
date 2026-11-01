import { FaClock, FaGraduationCap, FaToolbox } from "react-icons/fa";
import NeedGallery from "../needs/NeedGallery";
import { Chip } from "../needs/NeedCard";
import {
  equipmentAvailabilityBadge,
  equipmentCategoryEmoji,
  equipmentItemPhotoPaths,
  formatLoanLimit,
} from "../../utils/equipmentMeta";

/** Top strip: share of units free (emerald) over the rest (amber); grey when there are no units. */
function AvailabilityStrip({ item }) {
  const total = Math.max(Number(item.unit_count) || 0, 0);
  const free = Math.max(Number(item.available_count) || 0, 0);
  if (!total || item.is_archived) {
    return <div className="h-1.5 w-full bg-gradient-to-r from-slate-300 to-slate-400 dark:from-slate-600 dark:to-slate-500" aria-hidden />;
  }
  const pct = Math.round((free / total) * 100);
  return (
    <div
      className="relative h-1.5 w-full overflow-hidden bg-gradient-to-r from-amber-300 to-orange-400 dark:from-amber-500 dark:to-orange-600"
      role="img"
      aria-label={`${free} of ${total} free`}
    >
      <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-400 to-emerald-600 dark:from-emerald-500 dark:to-emerald-400" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Catalogue card in the Neighbourhood Watch Needs style: strip, 4:3 gallery, chips,
 * title, description, an info box (free units + loan limit), then an optional footer.
 */
export default function EquipmentCard({ item, onOpen, children }) {
  const badge = equipmentAvailabilityBadge(item);
  const total = Math.max(Number(item.unit_count) || 0, 0);
  const free = Math.max(Number(item.available_count) || 0, 0);
  const out = Math.max(Number(item.out_count) || 0, 0);
  const loan = formatLoanLimit(item.max_loan_hours);
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
      <AvailabilityStrip item={item} />
      <div
        className={`flex-1 ${onOpen ? "cursor-pointer" : ""}`}
        onClick={onOpen}
        onKeyDown={onOpen ? (e) => (e.key === "Enter" ? onOpen() : null) : undefined}
        role={onOpen ? "button" : undefined}
        tabIndex={onOpen ? 0 : undefined}
      >
        <NeedGallery paths={equipmentItemPhotoPaths(item)} title={item.name} />
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone="bg-teal-50 text-teal-800 ring-1 ring-teal-200 dark:bg-teal-900/40 dark:text-teal-200 dark:ring-teal-800">
              <span aria-hidden className="mr-1">{equipmentCategoryEmoji(item.category_name)}</span>
              {item.category_name || "Other"}
            </Chip>
            <Chip tone={badge.tone}>{badge.label}</Chip>
            {item.requires_certification ? (
              <Chip tone="bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
                <FaGraduationCap className="mr-1 h-3 w-3" aria-hidden /> Training
              </Chip>
            ) : null}
          </div>
          <h3 className="text-base font-semibold leading-snug text-gray-900 dark:text-white">{item.name}</h3>
          {item.description ? <p className="line-clamp-3 text-sm text-gray-600 dark:text-gray-300">{item.description}</p> : null}
          <div className="flex flex-wrap items-end justify-between gap-2 rounded-xl border border-teal-200 bg-gradient-to-r from-teal-50 to-emerald-100 px-3 py-2 dark:border-teal-800 dark:from-teal-900/40 dark:to-emerald-900/30">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Available now</p>
              <p className="text-xl font-extrabold text-teal-900 dark:text-white">
                {total ? (
                  <>
                    {free} <span className="text-sm font-medium text-gray-600 dark:text-gray-300">of {total}</span>
                  </>
                ) : (
                  <span className="text-sm font-medium text-gray-500 dark:text-gray-400">No units yet</span>
                )}
              </p>
            </div>
            <div className="text-right text-xs text-gray-600 dark:text-gray-300">
              {out ? <p>{out} out on patrol</p> : null}
              {loan ? (
                <p className="inline-flex items-center gap-1">
                  <FaClock className="h-3 w-3" aria-hidden /> {loan}
                </p>
              ) : null}
              {!out && !loan ? (
                <p className="inline-flex items-center gap-1">
                  <FaToolbox className="h-3 w-3" aria-hidden /> Watch gear
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {children ? <div className="border-t border-gray-100 px-4 py-3 dark:border-gray-700">{children}</div> : null}
    </article>
  );
}
