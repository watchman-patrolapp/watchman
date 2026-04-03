import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabase/client";
import { useAuth } from "../auth/useAuth";
import { 
  FaArrowLeft, 
  FaTrophy, 
  FaMedal, 
  FaFire,
  FaClock,
  FaCalendarAlt,
  FaChartLine,
  FaMapMarkerAlt,
  FaSync,
  FaExclamationTriangle,
  FaUser,
  FaStar,
  FaRuler,
  FaRoute
} from "react-icons/fa";
import { DEFAULT_PATROL_ZONE, displayPatrolZone } from "../config/neighborhoodRegions";
import ThemeToggle from "../components/ThemeToggle";
import BrandedLoader from "../components/layout/BrandedLoader";
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Recharts 3 defaults initial size to -1; flex/grid parents need a positive seed to avoid console warnings. */
const CHART_INITIAL = { width: 800, height: 256 };
const CHART_INITIAL_SHORT = { width: 800, height: 192 };

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS_OF_DAY = Array.from({ length: 12 }, (_, i) => `${i * 2}:00`);

const TIME_RANGES = {
  night: { label: 'Night Owl', hours: [0, 1, 2, 3, 4, 5], icon: '🌙' },
  morning: { label: 'Early Bird', hours: [6, 7, 8, 9, 10, 11], icon: '🌅' },
  afternoon: { label: 'Day Patrol', hours: [12, 13, 14, 15, 16, 17], icon: '☀️' },
  evening: { label: 'Evening Watch', hours: [18, 19, 20, 21, 22, 23], icon: '🌆' }
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub, color = 'teal', trend }) {
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
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${colors[color]}`}>
          <span className="text-2xl">📊</span>
        </div>
        {trend && (
          <span className={`text-xs font-medium px-2 py-1 rounded-full ${
            trend > 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 
            trend < 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
            'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
          }`}>
            {trend > 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
      <div className="mt-3">
        <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
        {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

function PodiumCard({ rank, entry, isCurrentUser }) {
  const rankStyles = {
    1: 'bg-gradient-to-b from-yellow-100 to-yellow-50 dark:from-yellow-900/30 dark:to-yellow-900/10 border-yellow-300 dark:border-yellow-700 scale-105',
    2: 'bg-gradient-to-b from-gray-100 to-gray-50 dark:from-gray-700/30 dark:to-gray-700/10 border-gray-300 dark:border-gray-600',
    3: 'bg-gradient-to-b from-orange-100 to-orange-50 dark:from-orange-900/30 dark:to-orange-900/10 border-orange-300 dark:border-orange-700',
  };

  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };

  return (
    <div className={`relative rounded-2xl border-2 p-4 text-center transition hover:shadow-lg ${
      rankStyles[rank] || 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
    } ${isCurrentUser ? 'ring-2 ring-teal-500 ring-offset-2 dark:ring-offset-gray-900' : ''}`}>
      <div className="text-4xl mb-2">{medals[rank] || rank}</div>
      <p className="font-bold text-gray-900 dark:text-white truncate">{entry.name}</p>
      <p className="text-2xl font-bold text-teal-600 dark:text-teal-400 mt-1">
        {Math.floor(entry.totalMinutes / 60)}h
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{entry.patrols} patrols</p>
      {isCurrentUser && (
        <span className="absolute -top-2 -right-2 bg-teal-600 text-white text-xs px-2 py-1 rounded-full">
          You
        </span>
      )}
    </div>
  );
}

function ActivityHeatmap({ patrolData }) {
  // Generate last 84 days (12 weeks) of activity
  const days = useMemo(() => {
    const result = [];
    const today = new Date();
    for (let i = 83; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      result.push({
        date: d.toISOString().split('T')[0],
        dayOfWeek: d.getDay(),
        count: 0
      });
    }
    return result;
  }, []);

  // Fill with actual data
  const filledDays = useMemo(() => {
    const dayMap = new Map(days.map(d => [d.date, d]));
    patrolData.forEach(patrol => {
      const date = new Date(patrol.start_time).toISOString().split('T')[0];
      if (dayMap.has(date)) {
        dayMap.get(date).count += 1;
      }
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
            {week.map((day, dayIdx) => (
              <div
                key={dayIdx}
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
      <div className="h-64 w-full min-w-0 min-h-[16rem]">
        <ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={0}
          minHeight={200}
          initialDimension={CHART_INITIAL}
        >
          <RadarChart data={data}>
            <PolarGrid stroke="#e5e7eb" />
            <PolarAngleAxis dataKey="period" tick={{ fontSize: 11, fill: '#6b7280' }} />
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
  const recentPatrols = patrols.slice(0, 5);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <FaChartLine className="text-blue-500" />
        Recent Patrols
      </h3>
      <div className="space-y-3">
        {recentPatrols.map((patrol, idx) => (
          <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
                <FaMapMarkerAlt className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {new Date(patrol.start_time).toLocaleDateString('en-ZA', { 
                    weekday: 'short', 
                    day: 'numeric', 
                    month: 'short' 
                  })}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {new Date(patrol.start_time).toLocaleTimeString('en-ZA', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  })} - {new Date(patrol.end_time).toLocaleTimeString('en-ZA', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  })}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {Math.floor(patrol.duration_minutes / 60)}h {patrol.duration_minutes % 60}m
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {displayPatrolZone(patrol.zone) || DEFAULT_PATROL_ZONE}
              </p>
            </div>
          </div>
        ))}
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
  
  const [leaderboard, setLeaderboard] = useState([]);
  const [userStats, setUserStats] = useState(null);
  const [userPatrols, setUserPatrols] = useState([]);
  /** Rows from patrol_routes for the signed-in user (optional table). */
  const [patrolRouteRows, setPatrolRouteRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Fetch all patrol logs
      const { data: allLogs, error: logsError } = await supabase
        .from('patrol_logs')
        .select('user_name, duration_minutes, start_time, end_time, zone, user_id')
        .order('start_time', { ascending: false });

      if (logsError) throw logsError;

      // Aggregate global leaderboard
      const stats = {};
      allLogs.forEach(log => {
        const name = log.user_name;
        if (!stats[name]) {
          stats[name] = { 
            name, 
            totalMinutes: 0, 
            patrols: 0,
            userId: log.user_id 
          };
        }
        stats[name].totalMinutes += log.duration_minutes || 0;
        stats[name].patrols += 1;
      });

      const sorted = Object.values(stats)
        .sort((a, b) => b.totalMinutes - a.totalMinutes)
        .map((item, index) => ({ ...item, rank: index + 1 }));

      setLeaderboard(sorted);

      // Calculate current user's detailed stats
      const userLogs = allLogs.filter(log => log.user_id === user?.id);
      
      if (userLogs.length > 0) {
        const totalMinutes = userLogs.reduce((sum, log) => sum + (log.duration_minutes || 0), 0);
        const totalPatrols = userLogs.length;
        
        // Calculate streak (consecutive days with patrols)
        const patrolDates = [...new Set(userLogs.map(log => 
          new Date(log.start_time).toISOString().split('T')[0]
        ))].sort();
        
        let currentStreak = 0;
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        
        if (patrolDates.includes(today) || patrolDates.includes(yesterday)) {
          currentStreak = 1;
          for (let i = patrolDates.length - 1; i > 0; i--) {
            const curr = new Date(patrolDates[i]);
            const prev = new Date(patrolDates[i - 1]);
            const diff = (curr - prev) / (1000 * 60 * 60 * 24);
            if (diff === 1) currentStreak++;
            else break;
          }
        }

        // Calculate favorite patrol times
        const timeDistribution = { night: 0, morning: 0, afternoon: 0, evening: 0 };
        userLogs.forEach(log => {
          const hour = new Date(log.start_time).getHours();
          Object.entries(TIME_RANGES).forEach(([period, range]) => {
            if (range.hours.includes(hour)) {
              timeDistribution[period]++;
            }
          });
        });

        const favoritePeriod = Object.entries(timeDistribution)
          .sort((a, b) => b[1] - a[1])[0];

        // Weekly trend (last 8 weeks)
        const weeklyTrend = [];
        const now = new Date();
        for (let i = 7; i >= 0; i--) {
          const weekStart = new Date(now);
          weekStart.setDate(weekStart.getDate() - (i * 7));
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 7);
          
          const weekMinutes = userLogs
            .filter(log => {
              const logDate = new Date(log.start_time);
              return logDate >= weekStart && logDate < weekEnd;
            })
            .reduce((sum, log) => sum + (log.duration_minutes || 0), 0);
          
          weeklyTrend.push({
            week: `W${8-i}`,
            hours: Math.round(weekMinutes / 60 * 10) / 10
          });
        }

        // GPS route summaries (optional table — failures must not break the page)
        let routeRows = [];
        try {
          const { data: pr, error: prErr } = await supabase
            .from('patrol_routes')
            .select('total_distance_km, total_duration_seconds, start_location, end_location, route_geojson, created_at')
            .eq('user_id', user?.id)
            .order('created_at', { ascending: false })
            .limit(100);
          if (!prErr && Array.isArray(pr)) routeRows = pr;
        } catch {
          routeRows = [];
        }
        setPatrolRouteRows(routeRows);

        const routeAgg = routeRows.length
          ? {
              totalDistance: routeRows.reduce((s, r) => s + (Number(r.total_distance_km) || 0), 0),
              totalDuration: routeRows.reduce((s, r) => s + (Number(r.total_duration_seconds) || 0), 0),
              startLocation: routeRows[routeRows.length - 1]?.start_location ?? null,
              endLocation: routeRows[0]?.end_location ?? null,
              routeGeoJSON: routeRows[0]?.route_geojson ?? null,
            }
          : null;

        setUserStats({
          totalMinutes,
          totalPatrols,
          currentStreak,
          averageDuration: Math.round(totalMinutes / totalPatrols),
          favoriteTime: favoritePeriod ? {
            period: favoritePeriod[0],
            label: TIME_RANGES[favoritePeriod[0]].label,
            icon: TIME_RANGES[favoritePeriod[0]].icon,
            count: favoritePeriod[1]
          } : null,
          timeDistribution,
          weeklyTrend,
          globalRank: sorted.findIndex(s => s.userId === user?.id) + 1 || sorted.length + 1,
          routeStats: routeAgg
            ? {
                totalDistance: routeAgg.totalDistance,
                totalDuration: routeAgg.totalDuration,
                startLocation: routeAgg.startLocation,
                endLocation: routeAgg.endLocation,
                routeGeoJSON: routeAgg.routeGeoJSON,
              }
            : null,
        });
        
        setUserPatrols(userLogs);
      } else {
        setUserPatrols([]);
        setUserStats(null);
        setPatrolRouteRows([]);
      }

    } catch (err) {
      console.error("Error fetching data:", err);
      setError(err.message);
      toast.error("Failed to load leaderboard");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const topThree = leaderboard.slice(0, 3);
  const restOfLeaderboard = leaderboard.slice(3, 10);

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
              Top volunteers by patrol hours
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
          
          {/* Podium */}
          {topThree.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl mx-auto">
              {/* Reorder for visual podium: 2nd, 1st, 3rd */}
              {topThree[1] && (
                <PodiumCard 
                  rank={2} 
                  entry={topThree[1]} 
                  isCurrentUser={topThree[1].userId === user?.id}
                />
              )}
              {topThree[0] && (
                <PodiumCard 
                  rank={1} 
                  entry={topThree[0]} 
                  isCurrentUser={topThree[0].userId === user?.id}
                />
              )}
              {topThree[2] && (
                <PodiumCard 
                  rank={3} 
                  entry={topThree[2]} 
                  isCurrentUser={topThree[2].userId === user?.id}
                />
              )}
            </div>
          )}

          {/* Rest of Top 10 */}
          {restOfLeaderboard.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Top 10 Volunteers</h2>
              </div>
              
              {/* Mini bar chart */}
              <div className="p-6 border-b border-gray-100 dark:border-gray-700 min-w-0">
                <div className="h-48 w-full min-w-0 min-h-[12rem]">
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    minWidth={0}
                    minHeight={160}
                    initialDimension={CHART_INITIAL_SHORT}
                  >
                    <BarChart data={leaderboard.slice(0, 10)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis 
                        dataKey="name" 
                        tick={{ fontSize: 10 }} 
                        interval={0}
                        angle={-45}
                        textAnchor="end"
                        height={60}
                      />
                      <YAxis tick={{ fontSize: 11 }} unit="h" />
                      <Tooltip 
                        formatter={(val) => [`${Math.floor(val / 60)}h ${val % 60}m`, 'Hours']}
                        contentStyle={{ borderRadius: 8 }}
                      />
                      <Bar 
                        dataKey="totalMinutes" 
                        fill="#0d9488" 
                        radius={[4, 4, 0, 0]}
                        name="Minutes"
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
                        key={entry.name} 
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
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                          {entry.name}
                          {entry.userId === user?.id && (
                            <span className="ml-2 text-xs bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 px-2 py-0.5 rounded-full">
                              You
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                          {Math.floor(entry.totalMinutes / 60)}h {entry.totalMinutes % 60}m
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
                value={`${Math.floor(userStats.totalMinutes / 60)}h`}
                sub={`${userStats.totalMinutes % 60}m total`}
                color="teal"
              />
              <StatCard
                label="Global Rank"
                value={`#${userStats.globalRank}`}
                sub="among all volunteers"
                color="amber"
              />
              <StatCard
                label="Current Streak"
                value={`${userStats.currentStreak} days`}
                sub="keep it up!"
                color="rose"
              />
              <StatCard
                label="Avg Duration"
                value={`${Math.floor(userStats.averageDuration / 60)}h`}
                sub={`${userStats.averageDuration % 60}m per patrol`}
                color="violet"
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
                      {userStats.favoriteTime.count} patrols during {userStats.favoriteTime.period} hours
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold">{userStats.totalPatrols}</p>
                    <p className="text-violet-100 text-sm">Total Patrols</p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-w-0">
              <ActivityHeatmap patrolData={userPatrols} />
              <FavoriteTimeRadar timeDistribution={userStats.timeDistribution} />
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
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">No Patrol Data Yet</h3>
            <p className="text-gray-500 dark:text-gray-400 mb-6">Start patrolling to see your stats and climb the leaderboard!</p>
            <button
              onClick={() => navigate("/dashboard")}
              className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-medium transition"
            >
              Start Your First Patrol
            </button>
          </div>
        )}
      </div>
    </div>
  );
}