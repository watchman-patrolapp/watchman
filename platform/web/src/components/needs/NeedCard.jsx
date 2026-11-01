import { useState } from "react";
import { FaBan, FaBarcode, FaBoxOpen, FaCheckCircle, FaChevronRight, FaExternalLinkAlt, FaEye, FaHourglassHalf, FaLightbulb, FaStore, FaTrophy } from "react-icons/fa";
import NeedGallery from "./NeedGallery";
import {
  OFFER_STATUS_META,
  OPEN_OFFER_STATUSES,
  WISHLIST_PRIORITY_META,
  WISHLIST_STATUS_META,
  formatEstPrice,
  wishlistItemTotals,
  safeStoreUrl,
  wishlistAcquiredPct,
  wishlistCoverage,
  wishlistItemPhotoPaths,
} from "../../utils/equipmentWishlist";

export function Chip({ tone, children }) {
  if (!children) return null;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tone || "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200"}`}>
      {children}
    </span>
  );
}

function storeHost(url) {
  const safe = safeStoreUrl(url);
  if (!safe) return null;
  try {
    return { safe, host: new URL(safe).hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

/** Store link: https only, opened outside the app (12.7 / 7.9). */
export function StoreLink({ url }) {
  const s = storeHost(url);
  if (!s) return null;
  return (
    <a
      href={s.safe}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 break-all font-medium text-teal-700 hover:underline dark:text-teal-400"
    >
      {s.host}
      <FaExternalLinkAlt className="h-2.5 w-2.5 shrink-0" aria-hidden />
    </a>
  );
}

export const GRADIENT_BTN = "bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-sm hover:from-teal-700 hover:to-emerald-700";

/** "R X of R Y covered" from the public ledger (shown once anything is recorded). */
function CoveredBar({ item }) {
  if (item.status === "cancelled") return null;
  if (!(Number(item.received_cents) > 0 || Number(item.spent_cents) > 0)) return null;
  const { covered, target, pct } = wishlistCoverage(item);
  const label = target
    ? `${formatEstPrice(covered)} of ${formatEstPrice(target)} covered`
    : `${formatEstPrice(covered)} received`;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
        <span className="font-semibold text-violet-800 dark:text-violet-200">{label}</span>
        {target ? <span className="text-gray-500 dark:text-gray-400">{pct}%</span> : null}
      </div>
      {target ? (
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-violet-100 dark:bg-violet-950/60"
          role="progressbar"
          aria-label={`${label} (${pct}%)`}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-[width] duration-700" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

const STAT_COLS = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" };

/**
 * Gradient page banner shared by the resident and admin needs pages.
 * stats = [{ key, label, value, onClick?, active? }]: tappable figures under the title.
 */
export function NeedsBanner({ title, subtitle, stats, children }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-teal-600 via-emerald-600 to-cyan-600 p-4 text-white shadow-md sm:p-5 dark:from-teal-800 dark:via-emerald-800 dark:to-cyan-900">
      <FaBoxOpen className="pointer-events-none absolute -right-3 -top-3 h-24 w-24 text-white/10" aria-hidden />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-sm text-teal-50/90">{subtitle}</p> : null}
        </div>
        {children}
      </div>
      {stats?.length ? (
        <div className={`relative mt-3 grid grid-cols-2 gap-2 ${STAT_COLS[stats.length] || "sm:grid-cols-4"}`}>
          {stats.map((s) => {
            const body = (
              <>
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-teal-50/90">{s.label}</span>
                <span className="block text-lg font-extrabold leading-tight">{s.value}</span>
              </>
            );
            const tone = `rounded-xl px-3 py-2 text-left ring-1 backdrop-blur-sm ${s.active ? "bg-white/30 ring-white/60" : "bg-white/15 ring-white/25"}`;
            return s.onClick ? (
              <button key={s.key} type="button" onClick={s.onClick} aria-pressed={Boolean(s.active)} className={`${tone} transition hover:bg-white/25`}>
                {body}
              </button>
            ) : (
              <div key={s.key} className={tone}>
                {body}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Pill segmented control used for the needs filters. options = [{ key, label, count?, ariaLabel? }]. */
export function Segmented({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-lg border border-gray-200 bg-white p-0.5 text-xs dark:border-gray-700 dark:bg-gray-800">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          aria-label={o.ariaLabel}
          title={o.ariaLabel}
          onClick={() => onChange(o.key)}
          className={`shrink-0 rounded-md px-3 py-1.5 font-medium ${
            value === o.key ? `${GRADIENT_BTN}` : "text-gray-600 hover:text-teal-700 dark:text-gray-300 dark:hover:text-teal-300"
          }`}
        >
          {o.label}
          {o.count != null ? <span className={`ml-1.5 rounded-full px-1.5 text-[10px] font-bold ${value === o.key ? "bg-white/25" : "bg-gray-100 dark:bg-gray-700"}`}>{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Colourful empty state. */
export function NeedsEmpty({ title, body }) {
  return (
    <div className="rounded-2xl border border-dashed border-teal-300 bg-gradient-to-br from-teal-50 to-emerald-50 p-6 text-center dark:border-teal-800 dark:from-teal-950/40 dark:to-emerald-950/30">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 text-white shadow">
        <FaBoxOpen className="h-5 w-5" aria-hidden />
      </div>
      <p className="mt-3 text-sm font-semibold text-teal-900 dark:text-teal-100">{title}</p>
      {body ? <p className="mt-1 text-xs text-teal-800/80 dark:text-teal-200/80">{body}</p> : null}
    </div>
  );
}

/** Progress bar for "X of Y acquired". */
export function AcquiredProgress({ acquired, needed }) {
  const { acquired: a, needed: n, pct } = wishlistAcquiredPct(acquired, needed);
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className={`font-semibold ${pct >= 100 ? "text-emerald-700 dark:text-emerald-300" : pct >= 50 ? "text-teal-700 dark:text-teal-300" : "text-amber-700 dark:text-amber-300"}`}>
          {a} of {n} acquired
        </span>
        <span className="text-gray-500 dark:text-gray-400">{pct}%</span>
      </div>
      <div
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={n}
        aria-valuenow={a}
        aria-label={`${a} of ${n} acquired`}
      >
        <div
          className={`h-full rounded-full bg-gradient-to-r transition-all ${
            pct >= 100 ? "from-emerald-400 to-emerald-600" : pct >= 50 ? "from-teal-400 to-teal-600" : "from-amber-400 to-amber-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const SECTION_LABEL = "text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400";

/**
 * Needs-board card (admin + resident). Mobile first: whole photo (object-contain,
 * 4:3), divider, title, price block, progress, labelled reason, labelled meta,
 * then an action footer that wraps.
 */
const MY_OFFER_PILL = {
  new: { Icon: FaHourglassHalf, tone: "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-700" },
  acknowledged: { Icon: FaEye, tone: "bg-sky-100 text-sky-800 ring-sky-300 dark:bg-sky-900/40 dark:text-sky-200 dark:ring-sky-700" },
  accepted: { Icon: FaCheckCircle, tone: "bg-green-100 text-green-800 ring-green-300 dark:bg-green-900/40 dark:text-green-200 dark:ring-green-700" },
  fulfilled: { Icon: FaTrophy, tone: "bg-emerald-100 text-emerald-800 ring-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 dark:ring-emerald-700" },
  declined: { Icon: FaBan, tone: "bg-gray-200 text-gray-700 ring-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:ring-gray-600" },
  withdrawn: { Icon: FaBan, tone: "bg-gray-200 text-gray-700 ring-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:ring-gray-600" },
};

export default function NeedCard({ item, onOpen, onOffer, fullscreenPhotos = false, showProductCode = false, children }) {
  const [expanded, setExpanded] = useState(false);
  const status = WISHLIST_STATUS_META[item.status] || WISHLIST_STATUS_META.needed;
  const priority = WISHLIST_PRIORITY_META[item.priority];
  const photoPaths = wishlistItemPhotoPaths(item);
  const est = formatEstPrice(item.est_unit_price_cents);
  const totals = wishlistItemTotals(item);
  const myOpen = item.my_offer_status && OPEN_OFFER_STATUSES.includes(item.my_offer_status);
  const myMeta = item.my_offer_status ? OFFER_STATUS_META[item.my_offer_status] : null;
  const store = storeHost(item.store_url);
  const productCode = showProductCode ? item.product_code : null;
  const acquiredOn = item.acquired_at
    ? new Date(item.acquired_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })
    : null;
  const longReason = (item.reason || "").length > 160 || (item.reason || "").split("\n").length > 3;
  const showOffer = onOffer && item.status === "needed" && !myOpen;
  const myPill = myMeta && onOffer ? MY_OFFER_PILL[item.my_offer_status] || MY_OFFER_PILL.new : null;
  const myPledge = item.my_pledged_amount_cents ? formatEstPrice(item.my_pledged_amount_cents) : null;
  // Resident cards always render the footer so buttons line up across the grid.
  const hasFooter = Boolean(children) || Boolean(onOffer);

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
      <div
        className={`flex-1 ${onOpen ? "cursor-pointer" : ""}`}
        onClick={onOpen}
        onKeyDown={onOpen ? (e) => (e.key === "Enter" ? onOpen() : null) : undefined}
        role={onOpen ? "button" : undefined}
        tabIndex={onOpen ? 0 : undefined}
      >
        <NeedGallery paths={photoPaths} title={item.title} fullscreen={fullscreenPhotos} compact={!fullscreenPhotos} />

        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone={status.tone}>{status.label}</Chip>
            {priority?.tone && item.priority !== "normal" ? <Chip tone={priority.tone}>{priority.label}</Chip> : null}
          </div>
          <h3 className="text-base font-semibold leading-snug text-gray-900 dark:text-white">{item.title}</h3>

          <div className="flex flex-wrap items-end justify-between gap-2 rounded-xl border border-teal-200 bg-gradient-to-r from-teal-50 to-emerald-100 px-3 py-2 dark:border-teal-800 dark:from-teal-900/40 dark:to-emerald-900/30">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Estimated price</p>
              <p className="text-xl font-extrabold text-teal-900 dark:text-white">
                {est ? (
                  <>
                    {est} <span className="text-sm font-medium text-gray-600 dark:text-gray-300">each</span>
                  </>
                ) : (
                  <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Price not set</span>
                )}
              </p>
            </div>
            <div className="text-right text-xs text-gray-600 dark:text-gray-300">
              <p>
                Qty needed: <span className="font-semibold">{item.quantity_needed}</span>
              </p>
              {totals && item.status !== "cancelled" ? (
                <p title="Estimate for the quantity still outstanding. No money is collected in the app.">
                  Est. total:{" "}
                  <span className="font-semibold text-teal-800 dark:text-teal-200">
                    {item.status === "acquired" ? "R 0 remaining" : formatEstPrice(totals.remainingCents)}
                  </span>
                  {item.status === "needed" && totals.remainingCents !== totals.fullCents ? (
                    <span className="text-gray-500 dark:text-gray-400"> of {formatEstPrice(totals.fullCents)}</span>
                  ) : null}
                </p>
              ) : null}
            </div>
          </div>

          <AcquiredProgress acquired={item.quantity_acquired} needed={item.quantity_needed} />
          <CoveredBar item={item} />

          {(myMeta && !onOffer) || item.open_offer_count ? (
            <div className="flex flex-wrap gap-1.5">
              {myMeta && !onOffer ? <Chip tone={myMeta.tone}>My offer: {myMeta.label}</Chip> : null}
              {item.open_offer_count ? (
                <Chip tone="bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">
                  {item.open_offer_count} open offer{item.open_offer_count === 1 ? "" : "s"}
                </Chip>
              ) : null}
            </div>
          ) : null}

          {item.reason ? (
            <div className="border-t border-gray-100 pt-3 dark:border-gray-700">
              <p className={`${SECTION_LABEL} flex items-center gap-1.5`}>
                <FaLightbulb className="text-amber-500" aria-hidden /> Why we need it
              </p>
              <p className={`mt-1 whitespace-pre-line break-words text-sm text-gray-700 dark:text-gray-300 ${expanded ? "" : "line-clamp-3"}`}>
                {item.reason}
              </p>
              {longReason ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded((v) => !v);
                  }}
                  className="mt-1 text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
                >
                  {expanded ? "Show less" : "Show more"}
                </button>
              ) : null}
            </div>
          ) : null}

          {productCode || store ? (
            <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 border-t border-gray-100 pt-3 text-xs dark:border-gray-700">
              {productCode ? (
                <>
                  <dt className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                    <FaBarcode className="text-violet-500 dark:text-violet-400" aria-hidden /> Product code
                  </dt>
                  <dd className="break-all font-mono text-gray-800 dark:text-gray-200">{productCode}</dd>
                </>
              ) : null}
              {store ? (
                <>
                  <dt className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                    <FaStore className="text-sky-500 dark:text-sky-400" aria-hidden /> Store
                  </dt>
                  <dd>
                    <StoreLink url={item.store_url} />
                  </dd>
                </>
              ) : null}
            </dl>
          ) : null}
        </div>
      </div>

      {hasFooter ? (
        <div className="mt-auto flex min-h-[3.75rem] flex-wrap items-center gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/40">
          {children}
          {myPill ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpen?.();
              }}
              title="See my offer"
              className={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 hover:brightness-95 ${myPill.tone}`}
            >
              <myPill.Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">My offer: {myMeta.label}</span>
              {myPledge ? <span className="shrink-0 rounded-full bg-white/70 px-1.5 text-violet-800 dark:bg-black/30 dark:text-violet-200">{myPledge}</span> : null}
              <FaChevronRight className="h-2.5 w-2.5 shrink-0 opacity-70" aria-hidden />
            </button>
          ) : null}
          {!showOffer && !myPill && onOffer ? (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {item.status === "acquired"
                ? `${acquiredOn ? `Acquired ${acquiredOn}` : "All acquired"} - thank you, neighbours!`
                : "No longer needed"}
            </span>
          ) : null}
          {showOffer && !myPill ? (
            <span className="text-xs text-gray-500 dark:text-gray-400">Give, lend, source or chip in</span>
          ) : null}
          {showOffer ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOffer();
              }}
              className={myPill
                ? "ml-auto rounded-lg border border-teal-600 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 dark:border-teal-500 dark:text-teal-300 dark:hover:bg-teal-950/40"
                : `w-full rounded-lg px-3 py-2 text-sm font-semibold sm:ml-auto sm:w-auto ${GRADIENT_BTN}`}
            >
              {myPill ? "Offer again" : "Offer to help"}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}