import { FaCalendarAlt, FaCheck, FaMapMarkerAlt } from "react-icons/fa";
import { initialsFromName } from "../../utils/residentVerification";
import { formatWatchDate } from "../../utils/watchTime";

function formatJoined(iso) {
  if (!iso) return null;
  return formatWatchDate(iso) || null;
}

/**
 * Household card for resident home, verify-neighbours, and My sector.
 * Other residents only get a street label (no house number, email, or phone).
 */
export default function ResidentHouseholdCard({
  name,
  greeting,
  avatarUrl,
  street,
  neighborhood,
  verified,
  verifiedBy,
  joinedAt,
  isSelf,
  showBadge = true,
  compact = false,
  rightSlot,
  onClick,
  distanceLabel,
  children,
}) {
  const displayName = String(name || "").trim() || "Resident";
  const joined = formatJoined(joinedAt);
  const isButton = Boolean(onClick) && !rightSlot;
  const Wrapper = isButton ? "button" : "article";
  const wrapperProps = isButton
    ? {
        type: "button",
        onClick,
        className:
          "flex w-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600",
      }
    : {
        className: `relative flex w-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800${
          onClick ? " cursor-pointer transition hover:-translate-y-0.5 hover:border-gray-300 dark:hover:border-gray-600" : ""
        }`,
        onClick: onClick && rightSlot ? onClick : undefined,
        role: onClick && rightSlot ? "button" : undefined,
        tabIndex: onClick && rightSlot ? 0 : undefined,
        onKeyDown:
          onClick && rightSlot
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onClick();
                }
              }
            : undefined,
      };

  const avatar = avatarUrl ? (
    <img
      src={avatarUrl}
      alt=""
      className={`h-14 w-14 shrink-0 rounded-full object-cover ring-2 ${
        verified ? "ring-emerald-200 dark:ring-emerald-800" : "ring-amber-200 dark:ring-amber-800"
      }`}
    />
  ) : (
    <div
      className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
        verified
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200"
          : "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"
      }`}
    >
      {initialsFromName(displayName)}
    </div>
  );

  const badge = showBadge ? (
    verified ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
        <FaCheck className="h-2.5 w-2.5" aria-hidden />
        Verified
      </span>
    ) : (
      <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
        Not verified
      </span>
    )
  ) : null;

  const placeLine = (
    <p className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300">
      <FaMapMarkerAlt className="mt-0.5 h-4 w-4 shrink-0 text-teal-500" aria-hidden />
      <span className="min-w-0 break-words">
        {street || "Street not listed"}
        {neighborhood ? ` · ${neighborhood}` : ""}
        {distanceLabel ? ` · ${distanceLabel}` : ""}
      </span>
    </p>
  );

  if (compact) {
    return (
      <Wrapper {...wrapperProps}>
        <div className="flex items-center gap-3 p-4 sm:px-5">
          {avatar}
          <div className="min-w-0 flex-1">
            {greeting ? (
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{greeting}</p>
            ) : null}
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="truncate text-lg font-semibold leading-tight text-gray-900 dark:text-white">
                {displayName}
                {isSelf ? <span className="ml-2 text-xs font-medium text-gray-400">You</span> : null}
              </h2>
              {badge}
            </div>
          </div>
          {rightSlot ? (
            <div
              className="shrink-0"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {rightSlot}
            </div>
          ) : null}
        </div>
        <div className="border-t border-gray-100 px-4 py-3 dark:border-gray-700 sm:px-5">
          {placeLine}
          {verified && verifiedBy ? (
            <p className="mt-2 flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300">
              <FaCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
              <span className="min-w-0 break-words">{verifiedBy}</span>
            </p>
          ) : null}
          {children}
        </div>
      </Wrapper>
    );
  }

  return (
    <Wrapper {...wrapperProps}>
      <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-4 dark:border-gray-700 sm:px-5">
        {avatar}
        <div className="min-w-0 flex-1">
          {greeting ? (
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{greeting}</p>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="truncate text-lg font-semibold leading-tight text-gray-900 dark:text-white">
              {displayName}
              {isSelf ? <span className="ml-2 text-xs font-medium text-gray-400">You</span> : null}
            </h2>
            {badge}
          </div>
        </div>
        {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
      </div>
      <div className="flex flex-1 flex-col space-y-2.5 p-4 sm:p-5">
        {placeLine}
        {joined ? (
          <p className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-300">
            <FaCalendarAlt className="h-4 w-4 shrink-0 text-teal-500" aria-hidden />
            <span>Joined {joined}</span>
          </p>
        ) : null}
        {verified && verifiedBy ? (
          <p className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300">
            <FaCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
            <span className="min-w-0 break-words">{verifiedBy}</span>
          </p>
        ) : null}
        {children}
      </div>
    </Wrapper>
  );
}
