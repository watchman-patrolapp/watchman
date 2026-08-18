import { FaCheck, FaMapMarkerAlt, FaMoon, FaSun } from "react-icons/fa";
import ThemeToggle from "../ThemeToggle";
import AppNotificationBell from "../layout/AppNotificationBell";
import AreaWeatherChip from "../layout/AreaWeatherChip";
import { initialsFromName } from "../../utils/residentVerification";
import { formatRelativeTime } from "../../utils/formatRelativeTime";

function greetingPeriod(date) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

function greetingLabel(period) {
  if (period === "morning") return "Good morning";
  if (period === "afternoon") return "Good afternoon";
  return "Good evening";
}

const PERIOD_THEME = {
  morning: "from-amber-400 via-orange-400 to-sky-700",
  afternoon: "from-sky-400 via-teal-500 to-teal-800",
  evening: "from-indigo-500 via-violet-600 to-purple-950",
  night: "from-slate-700 via-indigo-950 to-slate-950",
};

function AtmosphereMark({ period }) {
  const Icon = period === "night" || period === "evening" ? FaMoon : FaSun;
  return (
    <Icon className="pointer-events-none absolute -right-4 -top-6 h-28 w-28 text-white/10 sm:h-32 sm:w-32" aria-hidden />
  );
}

export default function ResidentHomeHero({
  firstName,
  fullName,
  avatarUrl,
  street,
  neighborhood,
  verified,
  showBadge,
  lastActivityAt,
  hasActiveSos,
  organizationId,
  awayLabel,
  onOpenProfile,
}) {
  const period = greetingPeriod(new Date());
  const displayName = String(firstName || fullName || "there").trim();
  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const badge = showBadge ? (
    verified ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-1 text-[11px] font-semibold leading-none">
        <FaCheck className="h-2.5 w-2.5" aria-hidden />
        Verified
      </span>
    ) : (
      <span className="rounded-full bg-amber-300/90 px-2 py-1 text-[11px] font-bold uppercase tracking-wide leading-none text-amber-950">
        Not verified
      </span>
    )
  ) : null;

  return (
    <article
      className={`overflow-hidden rounded-2xl bg-gradient-to-b ${PERIOD_THEME[period]} text-white shadow-xl ring-1 ring-black/10 dark:ring-white/10`}
    >
      <div className="relative px-4 pb-4 pt-5 sm:px-5 sm:pt-6">
        <AtmosphereMark period={period} />
        <div className="relative flex items-start gap-3">
          <button
            type="button"
            onClick={onOpenProfile}
            className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="Open profile"
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className="h-14 w-14 rounded-full object-cover shadow-md ring-2 ring-white/80"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20 text-sm font-bold shadow-md ring-2 ring-white/80">
                {initialsFromName(fullName || displayName)}
              </div>
            )}
          </button>
          <button
            type="button"
            onClick={onOpenProfile}
            className="min-w-0 flex-1 text-left"
          >
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/75">
              {greetingLabel(period)}
            </p>
            <h1 className="mt-0.5 truncate text-2xl font-bold leading-tight">{displayName}</h1>
            <p className="mt-1 text-sm text-white/85">{dateLabel}</p>
            <AreaWeatherChip organizationId={organizationId} className="mt-1 text-white/90" />
          </button>
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            {badge}
            <AppNotificationBell variant="brand" />
            <ThemeToggle variant="brand" />
          </div>
        </div>
      </div>

      <div className="space-y-2.5 border-t border-white/15 bg-black/20 px-4 py-3.5 backdrop-blur-[2px] sm:px-5">
        <p className="flex items-start gap-2.5 text-sm text-white/90">
          <FaMapMarkerAlt className="mt-0.5 h-4 w-4 shrink-0 text-white/70" aria-hidden />
          <span className="min-w-0 break-words">{street || "Add your home address on Profile"}</span>
        </p>
        <div className="ml-7 border-t border-white/15" />
        <p className="ml-7 text-sm font-medium text-white">{neighborhood}</p>
        {awayLabel ? (
          <p className="ml-7 text-xs font-medium text-amber-100">{awayLabel}</p>
        ) : hasActiveSos ? (
          <p className="ml-7 text-xs font-semibold text-amber-200">SOS active in this neighbourhood</p>
        ) : lastActivityAt ? (
          <p className="ml-7 text-xs text-white/65">
            Last neighbourhood activity {formatRelativeTime(lastActivityAt)}
          </p>
        ) : null}
      </div>
    </article>
  );
}
