import { useState } from "react";
import { FaMedal } from "react-icons/fa";
import { BADGE_COUNT } from "../../utils/leaderboardBadges";

function BadgeTile({ badge, locked, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(badge.id)}
      title={
        locked
          ? `${badge.description} (${badge.current}/${badge.target})`
          : badge.description
      }
      className={`rounded-xl border p-3 text-center transition ${
        selected
          ? "ring-2 ring-teal-500 ring-offset-1 dark:ring-offset-gray-800"
          : ""
      } ${
        locked
          ? "border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 opacity-70"
          : "border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 shadow-sm"
      }`}
    >
      <div className={`text-2xl mb-1 ${locked ? "grayscale" : ""}`}>{badge.emoji}</div>
      <p className={`text-xs font-semibold ${
        locked ? "text-gray-500 dark:text-gray-400" : "text-gray-900 dark:text-white"
      }`}>
        {badge.name}
      </p>
      {locked ? (
        <div className="mt-2">
          <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-teal-500"
              style={{ width: `${Math.round(badge.ratio * 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
            {badge.current}/{badge.target}
          </p>
        </div>
      ) : (
        <p className="text-[10px] text-teal-700 dark:text-teal-300 mt-1">Earned</p>
      )}
    </button>
  );
}

export default function BadgesPanel({ badgeState, isSelf = true, name }) {
  const [selectedId, setSelectedId] = useState(null);
  if (!badgeState) return null;
  const { earned, next, earnedCount, total = BADGE_COUNT } = badgeState;
  if (!earned.length && !next.length) return null;

  const selected =
    earned.find((b) => b.id === selectedId) || next.find((b) => b.id === selectedId);

  const subtitle = isSelf
    ? (earnedCount
      ? `${earnedCount} of ${total} earned — keep patrolling to unlock more.`
      : "Complete patrols to start earning these.")
    : `${earnedCount} of ${total} earned${name ? ` by ${name}` : ""}.`;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <FaMedal className="text-amber-500" />
            Badges
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
        </div>
      </div>

      {earned.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 mb-4">
          {earned.map((badge) => (
            <BadgeTile
              key={badge.id}
              badge={badge}
              selected={selectedId === badge.id}
              onSelect={setSelectedId}
            />
          ))}
        </div>
      )}

      {next.length > 0 && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">
            {isSelf ? "Next up" : "Still chasing"}
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {next.map((badge) => (
              <BadgeTile
                key={badge.id}
                badge={badge}
                locked
                selected={selectedId === badge.id}
                onSelect={setSelectedId}
              />
            ))}
          </div>
        </>
      )}

      {selected && (
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50 rounded-xl px-3 py-2">
          <span className="mr-1">{selected.emoji}</span>
          <span className="font-medium text-gray-900 dark:text-white">{selected.name}.</span>{" "}
          {selected.description}
          {selected.earned ? "" : ` Progress: ${selected.current}/${selected.target}.`}
        </p>
      )}
    </div>
  );
}
