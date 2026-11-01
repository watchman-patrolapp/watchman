import { FaToolbox } from "react-icons/fa";
import PageHeader from "../../components/layout/PageHeader";
import ThemeToggle from "../../components/ThemeToggle";

/**
 * Page frame shared by the equipment pages, same layout as Neighbourhood Watch Needs:
 * grey page, PageHeader with theme toggle, wide grid container (or a narrow one for
 * detail pages).
 */
export default function EquipmentShell({ title, subtitle, backTo, backLabel = "Back", wide = false, rightSlot = null, children }) {
  const width = wide ? "max-w-7xl 2xl:max-w-[100rem]" : "max-w-xl lg:max-w-4xl";
  return (
    <div className="min-h-screen bg-gray-100 p-4 dark:bg-gray-900 sm:p-6">
      <div className={`mx-auto w-full ${width} space-y-4 lg:px-4`}>
        <PageHeader
          title={title}
          subtitle={subtitle}
          backTo={backTo}
          backLabel={backLabel}
          rightSlot={
            <div className="flex items-center gap-2">
              {rightSlot}
              <ThemeToggle variant="toolbar" />
            </div>
          }
        />
        {children}
      </div>
    </div>
  );
}

/** Gradient banner in the Needs style, with a toolbox watermark. */
export function EquipmentBanner({ title, subtitle, children }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-teal-600 via-emerald-600 to-cyan-600 p-4 text-white shadow-md dark:from-teal-800 dark:via-emerald-800 dark:to-cyan-900 sm:p-5">
      <FaToolbox className="pointer-events-none absolute -right-3 -top-3 h-24 w-24 text-white/10" aria-hidden />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-sm text-teal-50/90">{subtitle}</p> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export function StatusChip({ meta }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.tone}`}>{meta.label}</span>;
}

export function EquipmentNotice({ children }) {
  return (
    <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
      {children}
    </p>
  );
}

/** White rounded section used on detail pages. */
export function InfoSection({ title, children, className = "" }) {
  return (
    <section className={`rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 ${className}`}>
      {title ? <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</h2> : null}
      {children}
    </section>
  );
}

/** Small labelled value box (2-up grid on phones). */
export function InfoBox({ label, children }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-0.5 break-words text-sm font-medium text-gray-900 dark:text-gray-100">{children}</p>
    </div>
  );
}

/** Pill row used for the category filter (Needs filter style, scrolls on phones). */
export function FilterPills({ options, value, onChange }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="inline-flex min-w-max rounded-lg border border-gray-200 bg-white p-0.5 text-xs dark:border-gray-700 dark:bg-gray-800">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 font-medium ${
              value === o.id ? "bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-sm" : "text-gray-600 hover:text-teal-700 dark:text-gray-300 dark:hover:text-teal-300"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export const SEARCH_INPUT =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 dark:border-gray-600 dark:bg-gray-800 dark:text-white sm:max-w-xs";

/** Ledger timeline (unit page + admin). */
export function Timeline({ rows, labelFor, whenFor, metaFor }) {
  if (!rows.length) return <p className="text-sm text-gray-600 dark:text-gray-300">No history yet.</p>;
  return (
    <ol className="relative ml-2 space-y-4 border-l-2 border-teal-200 pl-4 dark:border-teal-800">
      {rows.map((h) => (
        <li key={h.id} className="relative">
          <span className="absolute -left-[1.4rem] top-1 h-3 w-3 rounded-full border-2 border-white bg-gradient-to-br from-teal-500 to-emerald-500 dark:border-gray-800" aria-hidden />
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{labelFor(h)}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">{whenFor(h)}</span>
          </div>
          {metaFor(h) ? <p className="text-xs text-gray-500 dark:text-gray-400">{metaFor(h)}</p> : null}
        </li>
      ))}
    </ol>
  );
}
