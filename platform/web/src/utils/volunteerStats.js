/**
 * Shared patrol-time buckets and volunteer stats used by the leaderboard,
 * badges, and other-volunteer achievement sheets.
 */

import { routeRowDistanceKm } from "./patrolHistoryRoute.js";

export const TIME_RANGES = {
  night: { label: "Night Owl", hours: [0, 1, 2, 3, 4, 5], icon: "🌙" },
  morning: { label: "Early Bird", hours: [6, 7, 8, 9, 10, 11], icon: "🌅" },
  afternoon: { label: "Day Patrol", hours: [12, 13, 14, 15, 16, 17], icon: "☀️" },
  evening: { label: "Evening Watch", hours: [18, 19, 20, 21, 22, 23], icon: "🌆" },
};

/** South African public holidays with fixed calendar dates (not Easter). */
export const SA_FIXED_HOLIDAYS = [
  { id: "new-year", month: 1, day: 1, name: "New Year's Day" },
  { id: "human-rights", month: 3, day: 21, name: "Human Rights Day" },
  { id: "freedom-day", month: 4, day: 27, name: "Freedom Day" },
  { id: "workers-day", month: 5, day: 1, name: "Workers' Day" },
  { id: "youth-day", month: 6, day: 16, name: "Youth Day" },
  { id: "womens-day", month: 8, day: 9, name: "Women's Day" },
  { id: "heritage-day", month: 9, day: 24, name: "Heritage Day" },
  { id: "reconciliation", month: 12, day: 16, name: "Day of Reconciliation" },
  { id: "christmas", month: 12, day: 25, name: "Christmas Day" },
  { id: "goodwill", month: 12, day: 26, name: "Day of Goodwill" },
];

export function localDayStamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function zoneKey(zone) {
  return String(zone || "").trim();
}

function isoWeekKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

function saSeason(monthIndex) {
  if (monthIndex === 11 || monthIndex <= 1) return "summer";
  if (monthIndex <= 4) return "autumn";
  if (monthIndex <= 7) return "winter";
  return "spring";
}

function longestConsecutiveDays(sortedDates) {
  if (!sortedDates.length) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < sortedDates.length; i++) {
    const curr = new Date(`${sortedDates[i]}T12:00:00`);
    const prev = new Date(`${sortedDates[i - 1]}T12:00:00`);
    const diff = Math.round((curr - prev) / 86400000);
    if (diff === 1) {
      run += 1;
      if (run > best) best = run;
    } else if (diff > 1) {
      run = 1;
    }
  }
  return best;
}

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function isNightishTimestamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const hour = d.getHours();
  return hour >= 18 || hour <= 5;
}

function kmSinceDaysAgo(rows, daysAgo) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysAgo);
  return rows.reduce((sum, row) => {
    if (!row?.created_at) return sum;
    if (new Date(row.created_at) < cutoff) return sum;
    return sum + routeRowDistanceKm(row);
  }, 0);
}

function currentStreakFromDates(sortedDates) {
  if (!sortedDates.length) return 0;
  const today = localDayStamp(new Date());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = localDayStamp(y);
  if (!sortedDates.includes(today) && !sortedDates.includes(yesterday)) return 0;
  let streak = 1;
  for (let i = sortedDates.length - 1; i > 0; i--) {
    const curr = new Date(`${sortedDates[i]}T12:00:00`);
    const prev = new Date(`${sortedDates[i - 1]}T12:00:00`);
    const diff = Math.round((curr - prev) / 86400000);
    if (diff === 1) streak += 1;
    else if (diff > 1) break;
  }
  return streak;
}

function holidayIdForDate(date) {
  const m = date.getMonth() + 1;
  const day = date.getDate();
  return SA_FIXED_HOLIDAYS.find((h) => h.month === m && h.day === day)?.id || null;
}

/**
 * Build the stats object badges and fun facts expect.
 * @param {Array<{ start_time?: string, end_time?: string, duration_minutes?: number, zone?: string }>} logs
 * @param {Array<{ total_distance_km?: number, total_duration_seconds?: number, created_at?: string }>} routeRows
 * @param {{ globalRank?: number | null }} [opts]
 */
export function buildVolunteerStats(logs, routeRows = [], opts = {}) {
  if (!Array.isArray(logs) || logs.length === 0) return null;

  const totalMinutes = logs.reduce((sum, log) => sum + (log.duration_minutes || 0), 0);
  const totalPatrols = logs.length;
  const longestPatrolMinutes = Math.max(0, ...logs.map((log) => Number(log.duration_minutes) || 0));
  const shortestPatrolMinutes = Math.min(
    ...logs.map((log) => Number(log.duration_minutes) || 0).filter((n) => n > 0)
  );

  const patrolDates = [...new Set(logs.map((log) => localDayStamp(log.start_time)).filter(Boolean))].sort();
  const currentStreak = currentStreakFromDates(patrolDates);
  const longestStreak = longestConsecutiveDays(patrolDates);

  const timeDistribution = { night: 0, morning: 0, afternoon: 0, evening: 0 };
  const hourStarts = Array.from({ length: 24 }, () => 0);
  const dowCounts = Array.from({ length: 7 }, () => 0);
  const seasonCounts = { summer: 0, autumn: 0, winter: 0, spring: 0 };
  const holidayCounts = Object.fromEntries(SA_FIXED_HOLIDAYS.map((h) => [h.id, 0]));
  const perDay = new Map();
  let friday13thCount = 0;
  let leapDayCount = 0;
  let startsBefore6 = 0;
  let startsGraveyard = 0;
  let startsCoffee = 0;
  let startsLunch = 0;
  let startsTwilight = 0;
  let startsLateEvening = 0;
  let crossedMidnight = 0;
  let longPatrols2h = 0;
  let longPatrols3h = 0;

  logs.forEach((log) => {
    const start = new Date(log.start_time);
    if (Number.isNaN(start.getTime())) return;
    const hour = start.getHours();
    hourStarts[hour] += 1;
    dowCounts[start.getDay()] += 1;
    seasonCounts[saSeason(start.getMonth())] += 1;
    const hid = holidayIdForDate(start);
    if (hid) holidayCounts[hid] += 1;
    if (start.getDay() === 5 && start.getDate() === 13) friday13thCount += 1;
    if (start.getMonth() === 1 && start.getDate() === 29) leapDayCount += 1;
    if (hour < 6) startsBefore6 += 1;
    if (hour <= 4) startsGraveyard += 1;
    if (hour >= 5 && hour <= 7) startsCoffee += 1;
    if (hour === 12 || hour === 13) startsLunch += 1;
    if (hour >= 17 && hour <= 19) startsTwilight += 1;
    if (hour >= 22) startsLateEvening += 1;

    Object.entries(TIME_RANGES).forEach(([period, range]) => {
      if (range.hours.includes(hour)) timeDistribution[period] += 1;
    });

    const mins = Number(log.duration_minutes) || 0;
    if (mins >= 120) longPatrols2h += 1;
    if (mins >= 180) longPatrols3h += 1;

    const end = log.end_time ? new Date(log.end_time) : null;
    if (end && !Number.isNaN(end.getTime()) && end.getDate() !== start.getDate()) {
      crossedMidnight += 1;
    }

    const stamp = localDayStamp(start);
    perDay.set(stamp, (perDay.get(stamp) || 0) + 1);
  });

  const favoritePeriod = Object.entries(timeDistribution).sort((a, b) => b[1] - a[1])[0];
  const weekendPatrols = dowCounts[0] + dowCounts[6];
  const weekdayPatrols = totalPatrols - weekendPatrols;
  const distinctZones = new Set(logs.map((log) => zoneKey(log.zone)).filter(Boolean)).size;
  const distinctWeekdays = dowCounts.filter((n) => n > 0).length;
  const sameDayDoubles = [...perDay.values()].filter((n) => n >= 2).length;
  const sameDayTriples = [...perDay.values()].filter((n) => n >= 3).length;
  const maxSameDay = Math.max(0, ...perDay.values());

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const patrolsThisWeek = logs.filter((log) => new Date(log.start_time) >= weekAgo).length;

  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  const patrolsThisMonth = logs.filter((log) => new Date(log.start_time) >= monthAgo).length;

  const weekKeys = [...new Set(logs.map((log) => isoWeekKey(log.start_time)).filter(Boolean))].sort();
  let consecutiveWeeks = 0;
  if (weekKeys.length) {
    consecutiveWeeks = 1;
    let bestWeeks = 1;
    for (let i = 1; i < weekKeys.length; i++) {
      const [y1, w1] = weekKeys[i - 1].split("-W").map(Number);
      const [y2, w2] = weekKeys[i].split("-W").map(Number);
      const seq1 = y1 * 53 + w1;
      const seq2 = y2 * 53 + w2;
      if (seq2 === seq1 + 1) {
        consecutiveWeeks += 1;
        if (consecutiveWeeks > bestWeeks) bestWeeks = consecutiveWeeks;
      } else {
        consecutiveWeeks = 1;
      }
    }
    consecutiveWeeks = bestWeeks;
  }

  const monthKeys = [...new Set(patrolDates.map((d) => d.slice(0, 7)))];
  const distinctMonths = monthKeys.length;

  const firstStamp = patrolDates[0];
  const lastStamp = patrolDates[patrolDates.length - 1];
  const daysSinceFirst = firstStamp
    ? Math.max(1, Math.round((Date.now() - new Date(`${firstStamp}T12:00:00`).getTime()) / 86400000))
    : 0;
  const spanDays = firstStamp && lastStamp
    ? Math.max(1, Math.round((new Date(`${lastStamp}T12:00:00`) - new Date(`${firstStamp}T12:00:00`)) / 86400000) + 1)
    : 0;

  let hadComeback = false;
  for (let i = 1; i < patrolDates.length; i++) {
    const curr = new Date(`${patrolDates[i]}T12:00:00`);
    const prev = new Date(`${patrolDates[i - 1]}T12:00:00`);
    if (Math.round((curr - prev) / 86400000) >= 21) {
      hadComeback = true;
      break;
    }
  }

  const weeklyTrend = [];
  const now = new Date();
  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - i * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekMinutes = logs
      .filter((log) => {
        const logDate = new Date(log.start_time);
        return logDate >= weekStart && logDate < weekEnd;
      })
      .reduce((sum, log) => sum + (log.duration_minutes || 0), 0);
    weeklyTrend.push({
      week: `W${8 - i}`,
      hours: Math.round((weekMinutes / 60) * 10) / 10,
    });
  }

  const rows = Array.isArray(routeRows) ? routeRows : [];
  const usable = rows.filter((r) => routeRowDistanceKm(r) >= 0.3);
  const distances = usable.map((r) => routeRowDistanceKm(r));
  const totalDistance = rows.reduce((s, r) => s + routeRowDistanceKm(r), 0);
  const longestRouteKm = distances.reduce((best, km) => Math.max(best, km), 0);
  const shortestRouteKm = distances.length ? Math.min(...distances) : 0;
  const kmByDay = new Map();
  let nightKm = 0;
  for (const row of usable) {
    const km = routeRowDistanceKm(row);
    const stamp = localDayStamp(row.created_at);
    if (stamp) kmByDay.set(stamp, (kmByDay.get(stamp) || 0) + km);
    if (isNightishTimestamp(row.created_at)) nightKm += km;
  }
  const maxDayKm = kmByDay.size ? Math.max(...kmByDay.values()) : 0;
  const routeAgg = rows.length
    ? {
        totalDistance,
        totalDuration: rows.reduce((s, r) => s + (Number(r.total_duration_seconds) || 0), 0),
        longestRouteKm,
        shortestRouteKm,
        routeCount: usable.length,
        medianRouteKm: Math.round(median(distances) * 10) / 10,
        avgRouteKm: usable.length ? Math.round((totalDistance / usable.length) * 10) / 10 : 0,
        kmThisWeek: kmSinceDaysAgo(usable, 7),
        kmThisMonth: kmSinceDaysAgo(usable, 30),
        longLoopCount: distances.filter((km) => km >= 10).length,
        shortLoopCount: distances.filter((km) => km >= 0.5 && km < 3).length,
        maxDayKm,
        nightKm,
        startLocation: rows[rows.length - 1]?.start_location ?? null,
        endLocation: rows[0]?.end_location ?? null,
        routeGeoJSON: rows[0]?.route_geojson ?? null,
      }
    : null;

  return {
    totalMinutes,
    totalPatrols,
    currentStreak,
    longestStreak,
    averageDuration: Math.round(totalMinutes / totalPatrols),
    longestPatrolMinutes,
    shortestPatrolMinutes: Number.isFinite(shortestPatrolMinutes) ? shortestPatrolMinutes : 0,
    distinctZones,
    distinctDays: patrolDates.length,
    distinctWeekdays,
    distinctMonths,
    consecutiveWeeks,
    spanDays,
    daysSinceFirst,
    patrolsThisWeek,
    patrolsThisMonth,
    weekendPatrols,
    weekdayPatrols,
    fridayPatrols: dowCounts[5],
    saturdayPatrols: dowCounts[6],
    sundayPatrols: dowCounts[0],
    sameDayDoubles,
    sameDayTriples,
    maxSameDay,
    longPatrols2h,
    longPatrols3h,
    startsBefore6,
    startsGraveyard,
    startsCoffee,
    startsLunch,
    startsTwilight,
    startsLateEvening,
    crossedMidnight,
    friday13thCount,
    leapDayCount,
    holidayCounts,
    seasonCounts,
    hourStarts,
    dowCounts,
    hadComeback,
    favoriteTime: favoritePeriod
      ? {
          period: favoritePeriod[0],
          label: TIME_RANGES[favoritePeriod[0]].label,
          icon: TIME_RANGES[favoritePeriod[0]].icon,
          count: favoritePeriod[1],
        }
      : null,
    timeDistribution,
    weeklyTrend,
    globalRank: opts.globalRank ?? null,
    routeStats: routeAgg,
  };
}

export function logsForVolunteer(allLogs, volunteer) {
  if (!volunteer) return [];
  if (volunteer.userId) {
    return (allLogs || []).filter((log) => log.user_id === volunteer.userId);
  }
  if (volunteer.name) {
    return (allLogs || []).filter((log) => log.user_name === volunteer.name);
  }
  return [];
}
