import { FaArrowLeft, FaBell, FaChartBar, FaMapMarkerAlt, FaShieldAlt, FaShareAlt, FaUsers } from "react-icons/fa";

const CAPABILITIES = [
  { icon: FaShareAlt, label: "Share intel", className: "text-cyan-300 bg-cyan-400/10 ring-cyan-400/30" },
  { icon: FaBell, label: "Pattern alerts", className: "text-lime-300 bg-lime-400/10 ring-lime-400/30" },
  { icon: FaUsers, label: "Resources", fullLabel: "Resource coordination", className: "text-sky-300 bg-sky-400/10 ring-sky-400/30" },
  { icon: FaShieldAlt, label: "Stronger together", className: "text-emerald-300 bg-emerald-400/10 ring-emerald-400/30" },
];

function formatStat(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("en-ZA").format(Number(value));
}

function StatItem({ icon: Icon, value, label }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5 px-1 text-center sm:flex-row sm:items-center sm:gap-1.5 sm:px-2.5 sm:text-left">
      <Icon className="hidden h-2.5 w-2.5 shrink-0 text-cyan-300/80 sm:block" aria-hidden />
      <span className="text-[11px] font-semibold tabular-nums tracking-tight text-white">
        {formatStat(value)}
      </span>
      <span className="text-[9px] font-medium uppercase leading-tight tracking-[0.08em] text-slate-300/90 sm:tracking-[0.1em]">
        {label}
      </span>
    </div>
  );
}

export default function CityHubBanner({
  backLabel,
  allowPublish,
  stats,
  onBack,
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
        >
          <FaArrowLeft className="h-3 w-3" aria-hidden />
          {backLabel}
        </button>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
            allowPublish
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
              : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
          }`}
        >
          {allowPublish ? "Can publish" : "View only"}
        </span>
      </div>

      <section
        className="relative overflow-hidden rounded-2xl ring-1 ring-black/10 sm:h-[12.5rem] dark:ring-white/10"
        aria-labelledby="city-hub-banner-title"
      >
        <div className="absolute inset-0 bg-[#07111f]" />
        <img
            src="/city-hub-banner.webp"
          alt=""
          className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-[58%] object-cover object-center sm:block"
        />
        <div
          className="pointer-events-none absolute inset-0 hidden sm:block"
          style={{
            background:
              "linear-gradient(90deg, #07111f 0%, #07111f 38%, rgba(7,17,31,0.88) 52%, rgba(7,17,31,0.35) 68%, rgba(7,17,31,0.12) 100%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 sm:hidden"
          style={{
            background:
              "radial-gradient(120% 80% at 100% 50%, rgba(20,184,166,0.18), transparent 55%), linear-gradient(180deg, #07111f, #0b1a2e)",
          }}
        />

        <div className="relative z-10 flex flex-col px-4 py-5 sm:h-full sm:px-6 sm:pb-14 sm:pt-6">
          <h1
            id="city-hub-banner-title"
            className="text-3xl font-semibold leading-none tracking-tight sm:text-5xl"
          >
            <span className="text-white">City </span>
            <span className="text-lime-400">Hub</span>
          </h1>
          <p className="sr-only">
            Cross-neighborhood intelligence, pattern alerts, and resource coordination.
          </p>
          <ul className="mt-3 flex flex-wrap items-center gap-1.5 sm:mt-4">
            {CAPABILITIES.map((item) => (
              <li
                key={item.label}
                className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ring-1 sm:tracking-[0.1em] ${item.className}`}
              >
                <item.icon className="h-3 w-3 shrink-0" aria-hidden />
                <span className="min-w-0 sm:hidden">{item.label}</span>
                <span className="hidden min-w-0 sm:inline sm:whitespace-nowrap">{item.fullLabel || item.label}</span>
              </li>
            ))}
          </ul>

          <aside className="mt-4 grid grid-cols-3 gap-1 sm:absolute sm:inset-x-0 sm:bottom-2.5 sm:mt-0 sm:flex sm:justify-center sm:px-3">
            <StatItem
              icon={FaMapMarkerAlt}
              value={stats?.neighborhoods}
              label={stats?.neighborhoods === 1 ? "Neighborhood" : "Neighborhoods"}
            />
            <span className="hidden h-3 w-px shrink-0 bg-white/15 sm:block" aria-hidden />
            <StatItem
              icon={FaBell}
              value={stats?.activeAlerts}
              label={stats?.activeAlerts === 1 ? "Active alert" : "Active alerts"}
            />
            <span className="hidden h-3 w-px shrink-0 bg-white/15 sm:block" aria-hidden />
            <StatItem
              icon={FaChartBar}
              value={stats?.sharedReports}
              label={stats?.sharedReports === 1 ? "Shared report" : "Shared reports"}
            />
          </aside>
        </div>
      </section>
    </div>
  );
}
