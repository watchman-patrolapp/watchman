import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabase/client";
import { useAuth } from "../auth/useAuth";
import { 
  FaArrowLeft, 
  FaTrophy, 
  FaFire,
  FaClock,
  FaCalendarAlt,
  FaChartLine,
  FaMapMarkerAlt,
  FaSync,
  FaExclamationTriangle,
  FaUser,
  FaRuler,
  FaRoute
} from "react-icons/fa";
import { DEFAULT_PATROL_ZONE, displayPatrolZone } from "../config/neighborhoodRegions";
import { initialsFromName } from "../utils/residentVerification";
import { buildLeaderboardFunFacts } from "../utils/leaderboardFunFacts";
import { evaluateLeaderboardBadges } from "../utils/leaderboardBadges";
import { TIME_RANGES, buildVolunteerStats } from "../utils/volunteerStats";
import { periodStartDate, logOverlapsSince, watchDayStamp, addCalendarDays, parsePatrolTime, activePatrolAsLog, durationMinutesFromLog } from "../utils/watchTime";
import { fetchAllQueryPages } from "../utils/fetchPagedRows";
import ThemeToggle from "../components/ThemeToggle";
import BrandedLoader from "../components/layout/BrandedLoader";
import FunFactsPanel from "../components/leaderboard/FunFactsPanel";
import BadgesPanel from "../components/leaderboard/BadgesPanel";
import VolunteerProfileSheet from "../components/leaderboard/VolunteerProfileSheet";
import PatrolFuelCard from "../components/leaderboard/PatrolFuelCard";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar
} from "recharts";
import toast from "react-hot-toast";
import PatrolRouteHistorySection from "../components/leaderboard/PatrolRouteHistorySection";
import MyUpcomingPatrolSignups from "../components/leaderboard/MyUpcomingPatrolSignups";
import { useScopedOrganization } from "../utils/organizationScope";
import { useAreaWeather } from "../hooks/useAreaWeather";
import { useAreaHourlyWeather } from "../hooks/useAreaHourlyWeather";
import { describeCurrentPatrolWeather, summarizePatrolWeather } from "../utils/patrolWeather";
import { mergeFuelVehicles } from "../utils/patrolFuelEstimate";
import { fetchPatrolLocationPoints, fetchPatrolRouteRows } from "../utils/patrolHistoryRoute";
import { usePetrolPrice } from "../hooks/usePetrolPrice";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Recharts 3 defaults initial size to -1; flex/grid parents need a positive seed to avoid console warnings. */
const CHART_INITIAL = { width: 800, height: 256 };
const CHART_INITIAL_SHORT = { width: 800, height: 224 };

const PERIODS = [
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
];

function resolveVolunteerName(log, nameByUserId = {}) {
  const fromLog = String(log?.user_name || "").trim();
  if (fromLog) return fromLog;
  const fromProfile = log?.user_id ? String(nameByUserId?.[log.user_id] || "").trim() : "";
  return fromProfile;
}

/** Stable key so active_patrols + patrol_logs with different timestamp string forms still dedupe. */
function patrolIdentityKey(userId, startTime) {
  const t = parsePatrolTime(startTime);
  return `${userId || ""}|${t ? t.toISOString() : String(startTime || "")}`;
}

function chartAxisName(name) {
  const raw = String(name || "").trim();
  if (!raw) return "Volunteer";
  return raw.split(/\s+/)[0];
}

function aggregateLeaderboard(logs, nameByUserId = {}) {
  const stats = {};
  (logs || []).forEach((log) => {
    const key = log.user_id || log.user_name;
    if (!key) return;
    const resolved = resolveVolunteerName(log, nameByUserId);
    if (!stats[key]) {
      stats[key] = {
        name: resolved,
        totalMinutes: 0,
        patrols: 0,
        userId: log.user_id || null,
      };
    }
    stats[key].totalMinutes += durationMinutesFromLog(log);
    stats[key].patrols += 1;
    if (log.user_id && !stats[key].userId) stats[key].userId = log.user_id;
    if (resolved) stats[key].name = resolved;
  });

  return Object.values(stats)
    .sort((a, b) => b.totalMinutes - a.totalMinutes || String(a.name).localeCompare(String(b.name)))
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      name: item.name || "Volunteer",
    }));
}

function formatHoursMinutes(totalMinutes) {
  const mins = Math.max(0, Math.round(totalMinutes || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function minutesToChartHours(totalMinutes) {
  return Math.round((Math.max(0, Number(totalMinutes) || 0) / 60) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub, color = 'teal', icon: Icon }) {
  const colors = {
    teal: 'bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400',
    emerald: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
    rose: 'bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400',
    violet: 'bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400',
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 shadow-sm hover:shadow-md transition">
      <div className="flex items-start justify-between">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${colors[color] || colors.teal}`}>
          {Icon ? <Icon className="w-6 h-6" /> : <FaChartLine className="w-6 h-6" />}
        </div>
      </div>
      <div className="mt-3">
        <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
        {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

function PodiumAvatar({ name, avatarUrl, rank }) {
  const ring =
    rank === 1
      ? "ring-2 ring-yellow-400"
      : rank === 2
        ? "ring-2 ring-gray-300 dark:ring-gray-500"
        : "ring-2 ring-orange-300";

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className={`w-14 h-14 rounded-full object-cover mx-auto mb-2 ${ring}`}
      />
    );
  }

  return (
    <div className={`w-14 h-14 rounded-full mx-auto mb-2 flex items-center justify-center font-bold text-white bg-gradient-to-br from-teal-500 to-teal-700 ${ring}`}>
      {initialsFromName(name, "?")}
    </div>
  );
}

function PodiumCard({ rank, entry, isCurrentUser, avatarUrl, onSelect }) {
  const rankStyles = {
    1: "bg-gradient-to-b from-yellow-100 to-yellow-50 dark:from-yellow-900/40 dark:to-yellow-900/10 border-yellow-300 dark:border-yellow-700 shadow-md min-h-[16.5rem] pt-5",
    2: "bg-gradient-to-b from-gray-100 to-gray-50 dark:from-gray-700/40 dark:to-gray-800/20 border-gray-300 dark:border-gray-600 min-h-[15rem]",
    3: "bg-gradient-to-b from-orange-100 to-orange-50 dark:from-orange-900/30 dark:to-orange-900/10 border-orange-300 dark:border-orange-700 min-h-[15rem]",
  };
  const medals = { 1: "🥇", 2: "🥈", 3: "🥉" };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(entry)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect?.(entry);
        }
      }}
      className={`relative flex flex-col items-center overflow-visible rounded-2xl border-2 px-2.5 py-4 sm:p-4 text-center transition hover:shadow-lg cursor-pointer ${
      rankStyles[rank] || "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
    } ${isCurrentUser ? "ring-2 ring-teal-500 ring-offset-2 dark:ring-offset-gray-900" : ""}`}
    >
      <div className="text-3xl mb-1">{medals[rank] || rank}</div>
      <PodiumAvatar name={entry.name} avatarUrl={avatarUrl} rank={rank} />
      <p className="w-full px-0.5 font-bold text-sm sm:text-base text-gray-900 dark:text-white leading-tight break-words [overflow-wrap:anywhere] line-clamp-2 hover:underline">
        {entry.name}
      </p>
      <p className="text-xl sm:text-2xl font-bold text-teal-600 dark:text-teal-400 mt-1">
        {formatHoursMinutes(entry.totalMinutes)}
      </p>
      <p className="mt-0.5 pb-0.5 text-xs text-gray-500 dark:text-gray-400 shrink-0">
        {entry.patrols} patrols
      </p>
      {isCurrentUser && (
        <span className="absolute -top-2 -right-2 bg-teal-600 text-white text-xs px-2 py-1 rounded-full">
          You
        </span>
      )}
    </div>
  );
}

function PeriodTabs({ period, onChange }) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {PERIODS.map((p) => {
        const active = period === p.id;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
              active
                ? "bg-teal-600 text-white shadow-sm"
                : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-teal-400"
            }`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function YourStanding({ entry, nextUp, periodId, periodLabel, hasPatrolsThisPeriod }) {
  const when = periodId === "all" ? "the all-time board" : periodLabel.toLowerCase();

  if (!hasPatrolsThisPeriod) {
    return (
      <div className="rounded-2xl border border-dashed border-teal-300 dark:border-teal-800 bg-teal-50/60 dark:bg-teal-900/10 px-5 py-4 text-center">
        <p className="text-sm font-medium text-teal-800 dark:text-teal-200">
          No hours {periodId === "all" ? "on the all-time board" : when} yet — one patrol puts you on the board.
        </p>
      </div>
    );
  }

  if (entry?.rank === 1) {
    return (
      <div className="rounded-2xl border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 px-5 py-4 text-center">
        <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200">
          You are leading {when}. Hold the line.
        </p>
      </div>
    );
  }

  const gap = nextUp ? Math.max(0, nextUp.totalMinutes - (entry?.totalMinutes || 0)) : 0;

  return (
    <div className="rounded-2xl border border-teal-200 dark:border-teal-800 bg-white dark:bg-gray-800 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <p className="text-sm font-semibold text-gray-900 dark:text-white">
        Your standing {periodId === "all" ? "(all time)" : periodLabel.toLowerCase()}: #{entry?.rank ?? "—"}
      </p>
      {nextUp && (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {formatHoursMinutes(gap)} behind {nextUp.name} for #{entry.rank - 1}
        </p>
      )}
    </div>
  );
}

function ActivityHeatmap({ patrolData }) {
  // Align columns to Mon→Sun (SAST), same week definition as the leaderboard.
  const days = useMemo(() => {
    const today = watchDayStamp(new Date());
    const weekStart = periodStartDate("week");
    const mondayStamp = weekStart ? watchDayStamp(weekStart) : today;
    // 12 full weeks ending this week (84 days).
    const startStamp = addCalendarDays(mondayStamp, -11 * 7);
    const result = [];
    for (let i = 0; i < 84; i++) {
      const date = addCalendarDays(startStamp, i);
      result.push({ date, count: 0 });
    }
    return result;
  }, []);

  const filledDays = useMemo(() => {
    const dayMap = new Map(days.map((d) => [d.date, { ...d }]));
    (patrolData || []).forEach((patrol) => {
      const date = watchDayStamp(patrol.start_time);
      const cell = dayMap.get(date);
      if (cell) cell.count += 1;
    });
    return Array.from(dayMap.values());
  }, [days, patrolData]);

  const getIntensity = (count) => {
    if (count === 0) return 'bg-gray-100 dark:bg-gray-800';
    if (count === 1) return 'bg-emerald-200 dark:bg-emerald-900/40';
    if (count === 2) return 'bg-emerald-300 dark:bg-emerald-800/60';
    if (count === 3) return 'bg-emerald-400 dark:bg-emerald-700/80';
    return 'bg-emerald-500 dark:bg-emerald-600';
  };

  const weeks = [];
  for (let i = 0; i < filledDays.length; i += 7) {
    weeks.push(filledDays.slice(i, i + 7));
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 min-w-0">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <FaCalendarAlt className="text-emerald-500" />
        Activity Heatmap
      </h3>
      <div className="flex gap-1 overflow-x-auto pb-2">
        {weeks.map((week, weekIdx) => (
          <div key={weekIdx} className="flex flex-col gap-1">
            {week.map((day) => (
              <div
                key={day.date}
                title={`${day.date}: ${day.count} patrol${day.count !== 1 ? 's' : ''}`}
                className={`w-3 h-3 rounded-sm ${getIntensity(day.count)} transition hover:ring-2 hover:ring-teal-500`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3 text-xs text-gray-500 dark:text-gray-400">
        <span>Less</span>
        <div className="flex gap-1">
          {['bg-gray-100 dark:bg-gray-800', 'bg-emerald-200 dark:bg-emerald-900/40', 'bg-emerald-300 dark:bg-emerald-800/60', 'bg-emerald-400 dark:bg-emerald-700/80', 'bg-emerald-500 dark:bg-emerald-600'].map((c, i) => (
            <div key={i} className={`w-3 h-3 rounded-sm ${c}`} />
          ))}
        </div>
        <span>More</span>
      </div>
    </div>
  );
}

function RadarPeriodTick({ x, y, payload, textAnchor }) {
  const lines = String(payload?.value || "").split(/\s+/).filter(Boolean);
  return (
    <text x={x} y={y} textAnchor={textAnchor || "middle"} fill="#6b7280" fontSize={11}>
      {lines.map((line, i) => (
        <tspan
          key={`${line}-${i}`}
          x={x}
          dy={i === 0 ? (lines.length > 1 ? "-0.45em" : "0.35em") : "1.15em"}
        >
          {line}
        </tspan>
      ))}
    </text>
  );
}

function FavoriteTimeRadar({ timeDistribution }) {
  const data = Object.entries(timeDistribution).map(([period, count]) => ({
    period: TIME_RANGES[period].label,
    count: count || 0,
    fullMark: Math.max(...Object.values(timeDistribution), 1)
  }));

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 min-w-0">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <FaClock className="text-violet-500" />
        Patrol Preferences
      </h3>
      <div className="h-72 w-full min-w-0 min-h-[18rem] overflow-visible">
        <ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={0}
          minHeight={200}
          initialDimension={CHART_INITIAL}
        >
          <RadarChart
            data={data}
            cx="50%"
            cy="50%"
            outerRadius="45%"
            margin={{ top: 24, right: 36, bottom: 24, left: 36 }}
          >
            <PolarGrid stroke="#e5e7eb" />
            <PolarAngleAxis dataKey="period" tickLine={false} tick={(props) => <RadarPeriodTick {...props} />} />
            <PolarRadiusAxis angle={90} domain={[0, 'auto']} tick={false} />
            <Radar
              name="Your Patrols"
              dataKey="count"
              stroke="#8b5cf6"
              fill="#8b5cf6"
              fillOpacity={0.3}
            />
            <Tooltip 
              contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }}
              formatter={(val) => [val, 'Patrols']}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function RecentPatrols({ patrols }) {
  const recentPatrols = (patrols || []).slice(0, 5);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <FaChartLine className="text-blue-500" />
        Recent Patrols
      </h3>
      <div className="space-y-3">
        {recentPatrols.map((patrol, idx) => {
          const start = parsePatrolTime(patrol.start_time);
          const end = parsePatrolTime(patrol.end_time);
          const mins = durationMinutesFromLog(patrol);
          const key = patrolIdentityKey(patrol.user_id, patrol.start_time) || `patrol-${idx}`;
          return (
          <div key={key} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
                <FaMapMarkerAlt className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {start
                    ? start.toLocaleDateString('en-ZA', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })
                    : 'Unknown date'}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {start
                    ? start.toLocaleTimeString('en-ZA', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'}
                  {' - '}
                  {end
                    ? end.toLocaleTimeString('en-ZA', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {formatHoursMinutes(mins)}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {displayPatrolZone(patrol.zone) || DEFAULT_PATROL_ZONE}
              </p>
            </div>
          </div>
          );
        })}
        {recentPatrols.length === 0 && (
          <p className="text-center text-gray-500 dark:text-gray-400 py-4">No patrols recorded yet</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Leaderboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { scope, activeOrganizationId } = useScopedOrganization();
  const petrol = usePetrolPrice(activeOrganizationId || user?.organizationId);
  
  const [allLogs, setAllLogs] = useState([]);
  const [userStats, setUserStats] = useState(null);
  const [userPatrols, setUserPatrols] = useState([]);
  /** Rows from patrol_routes for the signed-in user (optional table). */
  const [patrolRouteRows, setPatrolRouteRows] = useState([]);
  const [locationPoints, setLocationPoints] = useState([]);
  const [avatarByUserId, setAvatarByUserId] = useState({});
  const [nameByUserId, setNameByUserId] = useState({});
  const [vehicleByUserId, setVehicleByUserId] = useState({});
  const [period, setPeriod] = useState("week");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedVolunteer, setSelectedVolunteer] = useState(null);
  const fetchGenRef = useRef(0);

  const fetchData = useCallback(async () => {
    const runId = ++fetchGenRef.current;
    setLoading(true);
    setError(null);
    
    try {
      // Fetch all patrol logs
      let logs;
      try {
        logs = await fetchAllQueryPages(() =>
          scope(
            supabase
              .from("patrol_logs")
              .select("user_name, duration_minutes, start_time, end_time, zone, user_id, created_at")
          ).order("start_time", { ascending: false })
        );
      } catch (err) {
        if (!/created_at/i.test(String(err?.message || err))) throw err;
        logs = await fetchAllQueryPages(() =>
          scope(
            supabase
              .from("patrol_logs")
              .select("user_name, duration_minutes, start_time, end_time, zone, user_id")
          ).order("start_time", { ascending: false })
        );
      }
      if (runId !== fetchGenRef.current) return;

      let activeLogs = [];
      try {
        const { data: active, error: activeError } = await scope(
          supabase.from("active_patrols").select("user_name, start_time, user_id, zone")
        );
        if (!activeError && Array.isArray(active) && active.length) {
          const now = new Date();
          const started = new Set(
            logs.map((log) => patrolIdentityKey(log.user_id, log.start_time))
          );
          activeLogs = active
            .map((row) => activePatrolAsLog(row, now))
            .filter((row) => !started.has(patrolIdentityKey(row.user_id, row.start_time)));
        }
      } catch {
        activeLogs = [];
      }
      if (runId !== fetchGenRef.current) return;

      const combinedLogs = [...activeLogs, ...logs];
      setAllLogs(combinedLogs);

      let profileNames = {};
      const userIds = [...new Set(combinedLogs.map((log) => log.user_id).filter(Boolean))];
      if (userIds.length > 0) {
        try {
          const [{ data: avatars }, fuelVehicles] = await Promise.all([
            supabase.from("users").select("id, avatar_url, car_type, full_name").in("id", userIds),
            supabase.rpc("list_watch_fuel_vehicles").then(({ data, error }) => (error ? [] : data || [])),
          ]);
          if (runId !== fetchGenRef.current) return;
          const map = {};
          (avatars || []).forEach((row) => {
            if (!row?.id) return;
            map[row.id] = row.avatar_url || null;
            const label = String(row.full_name || "").trim();
            if (label) profileNames[row.id] = label;
          });
          setAvatarByUserId(map);
          setNameByUserId(profileNames);
          setVehicleByUserId(mergeFuelVehicles({
            userRows: avatars || [],
            rpcRows: Array.isArray(fuelVehicles) ? fuelVehicles : [],
            selfUser: user,
          }));
        } catch {
          if (runId !== fetchGenRef.current) return;
          profileNames = {};
          setAvatarByUserId({});
          setNameByUserId({});
          setVehicleByUserId(mergeFuelVehicles({ selfUser: user }));
        }
      } else {
        setAvatarByUserId({});
        setNameByUserId({});
        setVehicleByUserId(mergeFuelVehicles({ selfUser: user }));
      }

      const sorted = aggregateLeaderboard(combinedLogs, profileNames);

      // Calculate current user's detailed stats
      const userLogs = combinedLogs.filter(log => log.user_id === user?.id);
      let routeRows = [];
      if (user?.id) {
        try {
          routeRows = await fetchPatrolRouteRows(supabase, user.id);
        } catch {
          routeRows = [];
        }
      }
      if (runId !== fetchGenRef.current) return;
      setPatrolRouteRows(routeRows);

      const idx = sorted.findIndex((s) => s.userId === user?.id);
      const allTimeRank = idx >= 0 ? idx + 1 : null;
      const stats = buildVolunteerStats(userLogs, routeRows, { globalRank: allTimeRank });
      setUserStats(stats);
      setUserPatrols(userLogs);

    } catch (err) {
      if (runId !== fetchGenRef.current) return;
      console.error("Error fetching data:", err);
      setError(err.message);
      toast.error("Failed to load leaderboard");
    } finally {
      if (runId === fetchGenRef.current) setLoading(false);
    }
  }, [user, scope]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const periodLabel = PERIODS.find((p) => p.id === period)?.label || "All time";

  useEffect(() => {
    let cancelled = false;
    setLocationPoints([]);
    (async () => {
      if (!user?.id) return;
      const points = await fetchPatrolLocationPoints(supabase, { userId: user.id, logs: userPatrols });
      if (!cancelled) setLocationPoints(points);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, userPatrols]);

  const leaderboard = useMemo(() => {
    const start = periodStartDate(period);
    const logs = start
      ? allLogs.filter((log) => logOverlapsSince(log, start))
      : allLogs;
    return aggregateLeaderboard(logs, nameByUserId);
  }, [allLogs, period, nameByUserId]);

  const topThree = leaderboard.slice(0, 3);
  const myPeriodEntry = leaderboard.find((entry) => entry.userId === user?.id) || null;
  const nextUp = myPeriodEntry && myPeriodEntry.rank > 1
    ? leaderboard.find((entry) => entry.rank === myPeriodEntry.rank - 1)
    : null;
  const allTimeBoard = useMemo(() => aggregateLeaderboard(allLogs, nameByUserId), [allLogs, nameByUserId]);
  const selectedAllTimeRank = selectedVolunteer
    ? allTimeBoard.find((entry) =>
        (selectedVolunteer.userId && entry.userId === selectedVolunteer.userId)
        || entry.name === selectedVolunteer.name
      )?.rank ?? null
    : null;

  const currentWeather = useAreaWeather(activeOrganizationId);
  const hourlyWeather = useAreaHourlyWeather(activeOrganizationId, allLogs);
  const weatherNow = useMemo(
    () => describeCurrentPatrolWeather(currentWeather),
    [currentWeather]
  );
  const weatherSummary = useMemo(
    () => summarizePatrolWeather(userPatrols, hourlyWeather),
    [userPatrols, hourlyWeather]
  );

  const funFacts = useMemo(
    () => buildLeaderboardFunFacts({
      patrols: userPatrols,
      routeRows: patrolRouteRows,
      stats: userStats,
      isSelf: true,
      subjectId: user?.id,
      weather: weatherSummary,
      weatherNow,
    }),
    [userPatrols, patrolRouteRows, userStats, user?.id, weatherSummary, weatherNow]
  );

  const badgeState = useMemo(
    () => evaluateLeaderboardBadges(userStats),
    [userStats]
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <BrandedLoader message="Loading leaderboard…" size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
              <FaTrophy className="text-yellow-500" />
              Leaderboard
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Top volunteers by patrol hours — plus your badges and a few fun facts
            </p>
          </div>
          
          <div className="flex flex-wrap gap-2 sm:gap-3 items-center justify-end">
            <ThemeToggle variant="toolbar" />
            <button
              type="button"
              onClick={fetchData}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl transition text-sm font-medium shadow-sm"
            >
              <FaSync className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 transition text-sm font-medium"
            >
              <FaArrowLeft className="w-4 h-4" />
              Dashboard
            </button>
          </div>
        </div>

        {user?.id && <MyUpcomingPatrolSignups userId={user.id} />}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-6 text-center">
            <FaExclamationTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
            <p className="text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* 🏆 TOP SECTION: Global Leaderboard */}
        <div className="space-y-6">
          <PeriodTabs period={period} onChange={setPeriod} />

          {/* Podium: 2nd, 1st, 3rd with true height difference */}
          {topThree.length > 0 && (
            <div className="flex items-end justify-center gap-2 sm:gap-4 max-w-2xl mx-auto overflow-visible">
              <div className="flex-1 min-w-0 max-w-[11rem]">
                {topThree[1] ? (
                  <PodiumCard
                    rank={2}
                    entry={topThree[1]}
                    isCurrentUser={topThree[1].userId === user?.id}
                    avatarUrl={avatarByUserId[topThree[1].userId]}
                    onSelect={setSelectedVolunteer}
                  />
                ) : (
                  <div className="min-h-[15rem]" />
                )}
              </div>
              <div className="flex-1 min-w-0 max-w-[12.5rem]">
                {topThree[0] && (
                  <PodiumCard
                    rank={1}
                    entry={topThree[0]}
                    isCurrentUser={topThree[0].userId === user?.id}
                    avatarUrl={avatarByUserId[topThree[0].userId]}
                    onSelect={setSelectedVolunteer}
                  />
                )}
              </div>
              <div className="flex-1 min-w-0 max-w-[11rem]">
                {topThree[2] ? (
                  <PodiumCard
                    rank={3}
                    entry={topThree[2]}
                    isCurrentUser={topThree[2].userId === user?.id}
                    avatarUrl={avatarByUserId[topThree[2].userId]}
                    onSelect={setSelectedVolunteer}
                  />
                ) : (
                  <div className="min-h-[15rem]" />
                )}
              </div>
            </div>
          )}

          {user?.id && leaderboard.length > 0 && (
            <YourStanding
              entry={myPeriodEntry}
              nextUp={nextUp}
              periodId={period}
              periodLabel={periodLabel}
              hasPatrolsThisPeriod={Boolean(myPeriodEntry)}
            />
          )}

          {leaderboard.length === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 p-8 text-center">
              <FaTrophy className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-gray-600 dark:text-gray-300 font-medium">
                No patrols {periodLabel.toLowerCase()} yet
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {period === "all"
                  ? "Complete a patrol to appear here."
                  : "Be the first on the board — or switch to all time."}
              </p>
            </div>
          )}

          {/* Rest of Top 10 */}
          {leaderboard.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Top 10 Volunteers
                  <span className="ml-2 text-sm font-medium text-gray-400 dark:text-gray-500">
                    · {periodLabel}
                  </span>
                </h2>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Tap a name to see their badges and fun facts
                </p>
              </div>
              
              {/* Mini bar chart — values are hours (not raw minutes) so the Y-axis unit is honest */}
              <div className="p-6 pb-4 border-b border-gray-100 dark:border-gray-700 min-w-0 overflow-visible">
                <div className="h-64 w-full min-w-0 min-h-[16rem]">
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    minWidth={0}
                    minHeight={256}
                    initialDimension={CHART_INITIAL_SHORT}
                  >
                    <BarChart
                      data={leaderboard.slice(0, 10).map((entry) => ({
                        ...entry,
                        hours: minutesToChartHours(entry.totalMinutes),
                      }))}
                      margin={{ top: 8, right: 20, left: 12, bottom: 56 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis
                        dataKey="name"
                        type="category"
                        tick={{ fontSize: 11 }}
                        interval={0}
                        minTickGap={0}
                        angle={-40}
                        textAnchor="end"
                        height={80}
                        tickMargin={8}
                        tickFormatter={chartAxisName}
                      />
                      <YAxis tick={{ fontSize: 11 }} unit="h" />
                      <Tooltip 
                        formatter={(val, _name, item) => [
                          formatHoursMinutes(item?.payload?.totalMinutes ?? val * 60),
                          'Hours',
                        ]}
                        contentStyle={{ borderRadius: 8 }}
                      />
                      <Bar 
                        dataKey="hours" 
                        fill="#0d9488" 
                        radius={[4, 4, 0, 0]}
                        name="Hours"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Rank</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Volunteer</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Hours</th>
                      <th className="px-6 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Patrols</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {leaderboard.slice(0, 10).map(entry => (
                      <tr 
                        key={entry.userId || `${entry.rank}-${entry.name}`}
                        className={`hover:bg-gray-50 dark:hover:bg-gray-700 transition ${
                          entry.userId === user?.id ? 'bg-teal-50 dark:bg-teal-900/20' : ''
                        }`}
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          {entry.rank <= 3 ? (
                            <span className="text-2xl">
                              {entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : '🥉'}
                            </span>
                          ) : (
                            <span className="text-gray-500 dark:text-gray-400">#{entry.rank}</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">
                          <div className="flex items-center gap-4 min-w-0">
                            <button
                              type="button"
                              onClick={() => setSelectedVolunteer(entry)}
                              className="shrink-0"
                              aria-label={`View ${entry.name}'s achievements`}
                            >
                              {avatarByUserId[entry.userId] ? (
                                <img
                                  src={avatarByUserId[entry.userId]}
                                  alt=""
                                  className="w-8 h-8 rounded-full object-cover"
                                />
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 flex items-center justify-center text-xs font-bold">
                                  {initialsFromName(entry.name, "?")}
                                </div>
                              )}
                            </button>
                            <span className="min-w-0 pl-1">
                              <button
                                type="button"
                                onClick={() => setSelectedVolunteer(entry)}
                                className="hover:underline text-left break-words"
                              >
                                {entry.name}
                              </button>
                              {entry.userId === user?.id && (
                                <span className="ml-2 text-xs bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 px-2 py-0.5 rounded-full">
                                  You
                                </span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                          {formatHoursMinutes(entry.totalMinutes)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-center">
                          {entry.patrols}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* 📊 BOTTOM SECTION: Personal Analytics */}
        {userStats && (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
              <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <FaUser className="text-teal-500" />
                Your Personal Stats
              </h2>
              <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label="Total Hours"
                value={formatHoursMinutes(userStats.totalMinutes)}
                sub={`${userStats.totalPatrols} patrol${userStats.totalPatrols === 1 ? "" : "s"} all time`}
                color="teal"
                icon={FaClock}
              />
              <StatCard
                label="Global Rank"
                value={userStats.globalRank ? `#${userStats.globalRank}` : "—"}
                sub="among all volunteers"
                color="amber"
                icon={FaTrophy}
              />
              <StatCard
                label="Current Streak"
                value={`${userStats.currentStreak} days`}
                sub="keep it up!"
                color="rose"
                icon={FaFire}
              />
              <StatCard
                label="Avg Duration"
                value={formatHoursMinutes(userStats.averageDuration)}
                sub="per patrol"
                color="violet"
                icon={FaChartLine}
              />
            </div>

            {/* Favorite Time Badge */}
            {userStats.favoriteTime && (
              <div className="bg-gradient-to-r from-violet-500 to-purple-600 rounded-2xl p-6 text-white shadow-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-violet-100 text-sm font-medium mb-1">Your Patrol Personality</p>
                    <h3 className="text-2xl font-bold flex items-center gap-2">
                      <span className="text-3xl">{userStats.favoriteTime.icon}</span>
                      {userStats.favoriteTime.label}
                    </h3>
                    <p className="text-violet-100 text-sm mt-1">
                      {userStats.favoriteTime.count} patrols · {userStats.favoriteTime.label}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold">{userStats.totalPatrols}</p>
                    <p className="text-violet-100 text-sm">Total Patrols</p>
                  </div>
                </div>
              </div>
            )}

            <FunFactsPanel facts={funFacts} />
            <BadgesPanel badgeState={badgeState} isSelf />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-w-0">
              <ActivityHeatmap patrolData={userPatrols} />
              <div className="space-y-6 min-w-0">
                <FavoriteTimeRadar timeDistribution={userStats.timeDistribution} />
                <PatrolFuelCard
                  vehicle={vehicleByUserId[user?.id]}
                  stats={userStats}
                  logs={userPatrols}
                  routeRows={patrolRouteRows}
                  locationPoints={locationPoints}
                  priceZarPerLitre={petrol.price}
                  onPriceChange={petrol.setPrice}
                  defaultPeriod={period}
                  onSaveArea={async () => {
                    const result = await petrol.saveArea();
                    if (result?.ok) toast.success("Neighbourhood petrol price saved");
                    else toast.error(result?.message || "Could not save the neighbourhood price.");
                  }}
                  canSaveArea={petrol.canSaveArea}
                  saving={petrol.saving}
                  isSelf
                  userId={user?.id}
                />
              </div>
            </div>

            {/* Route Statistics Card */}
            {userStats.routeStats && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                  <FaRoute className="text-blue-500" />
                  Route Statistics
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
                      <div className="flex items-center gap-3">
                        <FaRuler className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        <div>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Total Distance</p>
                          <p className="text-2xl font-bold text-gray-900 dark:text-white">
                            {userStats.routeStats.totalDistance.toFixed(2)} km
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between p-4 bg-green-50 dark:bg-green-900/20 rounded-xl">
                      <div className="flex items-center gap-3">
                        <FaClock className="w-5 h-5 text-green-600 dark:text-green-400" />
                        <div>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Total Duration</p>
                          <p className="text-2xl font-bold text-gray-900 dark:text-white">
                            {Math.floor(userStats.routeStats.totalDuration / 3600)}h {Math.floor((userStats.routeStats.totalDuration % 3600) / 60)}m
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    {userStats.routeStats.startLocation && (
                      <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-xl">
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Start Location</p>
                        <p className="font-medium text-gray-900 dark:text-white">
                          {userStats.routeStats.startLocation.lat.toFixed(6)}, {userStats.routeStats.startLocation.lng.toFixed(6)}
                        </p>
                      </div>
                    )}
                    
                    {userStats.routeStats.endLocation && (
                      <div className="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-xl">
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">End Location</p>
                        <p className="font-medium text-gray-900 dark:text-white">
                          {userStats.routeStats.endLocation.lat.toFixed(6)}, {userStats.routeStats.endLocation.lng.toFixed(6)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {user?.id && userPatrols.length > 0 && (
              <PatrolRouteHistorySection
                userId={user.id}
                userPatrols={userPatrols}
                routeRows={patrolRouteRows}
              />
            )}

            {/* Weekly Trend */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 min-w-0">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">8-Week Trend</h3>
              <div className="h-64 w-full min-w-0 min-h-[16rem]">
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  minWidth={0}
                  minHeight={200}
                  initialDimension={CHART_INITIAL}
                >
                  <LineChart data={userStats.weeklyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} unit="h" />
                    <Tooltip 
                      contentStyle={{ borderRadius: 8 }}
                      formatter={(val) => [`${val}h`, 'Hours']}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="hours" 
                      stroke="#10b981" 
                      strokeWidth={3}
                      dot={{ fill: '#10b981', r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <RecentPatrols patrols={userPatrols} />
          </div>
        )}

        {/* Empty State for New Users */}
        {!userStats && !loading && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-12 text-center">
            <FaTrophy className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Ready for the board?</h3>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              Finish one patrol and you will show up here — with hours, a streak, and your first badge.
            </p>
            <button
              onClick={() => navigate("/dashboard")}
              className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-medium transition"
            >
              Start Your First Patrol
            </button>
          </div>
        )}
      </div>

      {selectedVolunteer && (
        <VolunteerProfileSheet
          volunteer={selectedVolunteer}
          allLogs={allLogs}
          periodId={period}
          allTimeRank={selectedAllTimeRank}
          avatarUrl={avatarByUserId[selectedVolunteer.userId]}
          vehicle={vehicleByUserId[selectedVolunteer.userId]}
          petrolPrice={petrol.price}
          isSelf={selectedVolunteer.userId === user?.id}
          hourlyWeather={hourlyWeather}
          weatherNow={weatherNow}
          onClose={() => setSelectedVolunteer(null)}
        />
      )}
    </div>
  );
}