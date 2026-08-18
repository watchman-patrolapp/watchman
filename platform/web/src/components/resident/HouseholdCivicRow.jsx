import { FaCheck, FaClipboardList, FaUserFriends } from "react-icons/fa";

export default function HouseholdCivicRow({ civic, compact = false }) {
  if (!civic) return null;
  const chips = [];
  if (civic.verified && !compact) {
    chips.push({
      key: "verified",
      label: "Verified",
      icon: FaCheck,
      className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    });
  }
  if (civic.street_watch) {
    chips.push({
      key: "watch",
      label: `Looking out · ${civic.streak_days} days`,
      icon: null,
      className: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
    });
  }
  if (civic.good_neighbour) {
    chips.push({
      key: "neighbour",
      label: "Good neighbour",
      icon: FaUserFriends,
      className: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
    });
  }
  if (civic.first_report) {
    chips.push({
      key: "report",
      label: "First report",
      icon: FaClipboardList,
      className: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
    });
  }
  if (!chips.length) {
    if (compact) return null;
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Keep showing up, vouch for people you know, and log what you see.
      </p>
    );
  }

  return (
    <div className={compact ? "flex flex-wrap gap-1.5" : "flex flex-wrap gap-2"}>
      {chips.map((chip) => {
        const Icon = chip.icon;
        return (
          <span
            key={chip.key}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip.className}`}
          >
            {Icon ? <Icon className="h-2.5 w-2.5" aria-hidden /> : null}
            {chip.label}
          </span>
        );
      })}
    </div>
  );
}
