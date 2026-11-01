import { FaBoxOpen } from "react-icons/fa";
import { Chip } from "./NeedCard";
import {
  WISHLIST_PRIORITY_META,
  WISHLIST_STATUS_META,
  formatEstPrice,
  wishlistAcquiredPct,
  wishlistItemPhotoPaths,
  wishlistItemTotals,
  wishlistPhotoUrl,
} from "../../utils/equipmentWishlist";

// Every row is its own grid, so only the title column may flex; the rest need fixed widths to align.
const COLS = "lg:grid lg:grid-cols-[minmax(0,1fr)_8rem_7rem_4rem_21rem] lg:items-center lg:gap-3";

/** Dense admin list: one row per need. renderActions(item) supplies the row's buttons. */
export default function NeedsList({ items, renderActions }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className={`hidden border-b border-gray-200 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400 ${COLS}`}>
        <span>Item</span>
        <span>Acquired</span>
        <span className="text-right">Est. remaining</span>
        <span className="text-right">Offers</span>
        <span className="text-right">Actions</span>
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {items.map((item) => (
          <NeedRow key={item.id} item={item} actions={renderActions(item)} />
        ))}
      </ul>
    </div>
  );
}

function NeedRow({ item, actions }) {
  const status = WISHLIST_STATUS_META[item.status] || WISHLIST_STATUS_META.needed;
  const priority = WISHLIST_PRIORITY_META[item.priority];
  const thumb = wishlistPhotoUrl(wishlistItemPhotoPaths(item)[0]);
  const { acquired, needed, pct } = wishlistAcquiredPct(item.quantity_acquired, item.quantity_needed);
  const totals = wishlistItemTotals(item);
  const remaining = item.status === "cancelled" ? "-" : totals ? formatEstPrice(totals.remainingCents) : "No price";
  const offers = Number(item.open_offer_count) || 0;

  return (
    <li className={`space-y-3 px-4 py-3 lg:space-y-0 ${COLS} ${item.status === "cancelled" ? "opacity-70" : ""}`}>
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
          {thumb ? <img src={thumb} alt="" loading="lazy" className="h-full w-full object-contain p-0.5" /> : <FaBoxOpen className="h-5 w-5 text-gray-300 dark:text-gray-600" aria-hidden />}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900 dark:text-white" title={item.title}>
            {item.title}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Chip tone={status.tone}>{status.label}</Chip>
            {priority?.tone && item.priority !== "normal" ? <Chip tone={priority.tone}>{priority.label}</Chip> : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs lg:contents">
        <div>
          <span className="block text-gray-500 lg:hidden dark:text-gray-400">Acquired</span>
          <span className="font-semibold text-gray-800 dark:text-gray-100">
            {acquired} of {needed}
          </span>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700" aria-hidden>
            <div className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="lg:text-right">
          <span className="block text-gray-500 lg:hidden dark:text-gray-400">Est. remaining</span>
          <span className="font-semibold text-teal-800 dark:text-teal-200">{remaining}</span>
        </div>
        <div className="lg:text-right">
          <span className="block text-gray-500 lg:hidden dark:text-gray-400">Open offers</span>
          {offers ? (
            <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[11px] font-bold text-white">{offers}</span>
          ) : (
            <span className="text-gray-400 dark:text-gray-500">0</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
    </li>
  );
}
