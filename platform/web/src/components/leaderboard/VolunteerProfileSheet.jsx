import { useEffect, useMemo, useState } from "react";
import { FaTimes, FaTrophy, FaFire, FaClock } from "react-icons/fa";
import { supabase } from "../../supabase/client";
import { initialsFromName } from "../../utils/residentVerification";
import { buildLeaderboardFunFacts } from "../../utils/leaderboardFunFacts";
import { evaluateLeaderboardBadges } from "../../utils/leaderboardBadges";
import { buildVolunteerStats, logsForVolunteer } from "../../utils/volunteerStats";
import { summarizePatrolWeather } from "../../utils/patrolWeather";
import { fetchPatrolLocationPoints, fetchPatrolRouteRows } from "../../utils/patrolHistoryRoute";
import FunFactsPanel from "./FunFactsPanel";
import BadgesPanel from "./BadgesPanel";
import PatrolFuelCard from "./PatrolFuelCard";
import BrandedLoader from "../layout/BrandedLoader";

function formatHoursMinutes(totalMinutes) {
  const mins = Math.max(0, Math.round(totalMinutes || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function VolunteerProfileSheet({
  volunteer,
  allLogs,
  allTimeRank,
  avatarUrl,
  vehicle = null,
  petrolPrice = null,
  isSelf,
  hourlyWeather = null,
  weatherNow = null,
  onClose,
}) {
  const [routeRows, setRouteRows] = useState([]);
  const [locationPoints, setLocationPoints] = useState([]);
  const [loadingRoutes, setLoadingRoutes] = useState(true);

  const patrols = useMemo(
    () => logsForVolunteer(allLogs, volunteer),
    [allLogs, volunteer]
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingRoutes(true);
    setRouteRows([]);
    setLocationPoints([]);

    (async () => {
      if (!volunteer?.userId) {
        if (!cancelled) setLoadingRoutes(false);
        return;
      }
      try {
        const data = await fetchPatrolRouteRows(supabase, volunteer.userId);
        if (!cancelled) setRouteRows(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setRouteRows([]);
      } finally {
        if (!cancelled) setLoadingRoutes(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [volunteer?.userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!volunteer?.userId) {
        setLocationPoints([]);
        return;
      }
      const points = await fetchPatrolLocationPoints(supabase, {
        userId: volunteer.userId,
        logs: patrols,
      });
      if (!cancelled) setLocationPoints(points);
    })();
    return () => {
      cancelled = true;
    };
  }, [volunteer?.userId, patrols]);

  const stats = useMemo(
    () => buildVolunteerStats(patrols, routeRows, { globalRank: allTimeRank }),
    [patrols, routeRows, allTimeRank]
  );

  const weatherSummary = useMemo(
    () => summarizePatrolWeather(patrols, hourlyWeather),
    [patrols, hourlyWeather]
  );

  const facts = useMemo(
    () =>
      buildLeaderboardFunFacts({
        patrols,
        routeRows,
        stats,
        isSelf,
        subjectName: volunteer?.name,
        subjectId: volunteer?.userId,
        weather: weatherSummary,
        weatherNow,
      }),
    [patrols, routeRows, stats, isSelf, volunteer?.name, volunteer?.userId, weatherSummary, weatherNow]
  );

  const badgeState = useMemo(() => evaluateLeaderboardBadges(stats), [stats]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!volunteer) return null;

  const heading = isSelf ? "Your achievements" : `${volunteer.name}'s achievements`;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="volunteer-profile-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-gray-50 dark:bg-gray-900 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-teal-500 to-teal-700 text-white flex items-center justify-center font-bold shrink-0">
                {initialsFromName(volunteer.name, "?")}
              </div>
            )}
            <div className="min-w-0">
              <h2 id="volunteer-profile-title" className="text-lg font-bold text-gray-900 dark:text-white truncate">
                {heading}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {allTimeRank ? `All-time rank #${allTimeRank}` : "Volunteer"}
                {stats ? ` · ${formatHoursMinutes(stats.totalMinutes)} · ${stats.totalPatrols} patrols` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Close"
          >
            <FaTimes />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {loadingRoutes && !stats ? (
            <div className="py-10 flex justify-center">
              <BrandedLoader message="Loading achievements…" size="md" />
            </div>
          ) : !stats ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
              No patrols recorded for this volunteer yet.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-3 text-center">
                  <FaTrophy className="mx-auto text-amber-500 mb-1" />
                  <p className="text-lg font-bold text-gray-900 dark:text-white">
                    {stats.globalRank ? `#${stats.globalRank}` : "—"}
                  </p>
                  <p className="text-xs text-gray-500">Rank</p>
                </div>
                <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-3 text-center">
                  <FaClock className="mx-auto text-teal-500 mb-1" />
                  <p className="text-lg font-bold text-gray-900 dark:text-white">
                    {formatHoursMinutes(stats.totalMinutes)}
                  </p>
                  <p className="text-xs text-gray-500">Hours</p>
                </div>
                <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-3 text-center">
                  <FaFire className="mx-auto text-rose-500 mb-1" />
                  <p className="text-lg font-bold text-gray-900 dark:text-white">
                    {stats.currentStreak}d
                  </p>
                  <p className="text-xs text-gray-500">Streak</p>
                </div>
              </div>

              {stats.favoriteTime && (
                <div className="bg-gradient-to-r from-violet-500 to-purple-600 rounded-2xl p-5 text-white">
                  <p className="text-violet-100 text-sm font-medium mb-1">
                    {isSelf ? "Your patrol personality" : "Patrol personality"}
                  </p>
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <span className="text-2xl">{stats.favoriteTime.icon}</span>
                    {stats.favoriteTime.label}
                  </h3>
                  <p className="text-violet-100 text-sm mt-1">
                    {stats.favoriteTime.count} patrols during {stats.favoriteTime.period} hours
                  </p>
                </div>
              )}

              <FunFactsPanel facts={facts} isSelf={isSelf} name={volunteer.name} />
              <PatrolFuelCard
                vehicle={vehicle}
                stats={stats}
                logs={patrols}
                routeRows={routeRows}
                locationPoints={locationPoints}
                priceZarPerLitre={petrolPrice}
                isSelf={isSelf}
                name={volunteer.name}
                userId={volunteer.userId}
              />
              <BadgesPanel badgeState={badgeState} isSelf={isSelf} name={volunteer.name} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
