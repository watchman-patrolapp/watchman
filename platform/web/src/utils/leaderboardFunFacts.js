/**
 * Did-you-know cards from a volunteer's real patrol stats.
 *
 * Comparison constants are documented below. Copy always uses "about" / "roughly"
 * because these are delight facts, not lab measurements.
 *
 * Sources (approx.):
 * - Common swift typical cruise 36–43 km/h; recorded top 31.1 m/s ≈ 112 km/h
 *   (Henningsson, Johansson & Hedenström 2010, Journal of Avian Biology;
 *   BBC Earth, 2010). We use 40 km/h cruise and 112 km/h top.
 * - Comfortable walking pace ~5 km/h (widely used planning figure).
 * - FIFA recommended football pitch length 105 m.
 * - Standard running track lap 400 m.
 * - JNB–PLZ nonstop about 1 h 45 min (105 min).
 * - Adult sleep often described as 8 hours; standard work week 40 hours.
 * - Feature-length film commonly ~2 hours (120 min).
 * - Road marathon 42.195 km ≈ 42.2 km.
 * - Landmark driving distances: Theescombe–Walmer ~9 km; Walmer Heights–
 *   Summerstrand ~13 km; Addo Main Camp 72 km (SANParks); Jeffreys Bay ~82 km;
 *   Humansdorp ~91 km; Makhanda ~128 km; East London ~290 km; Cape Town ~752 km.
 *
 * Shown cards rotate every FUN_FACT_ROTATION_DAYS (2) using a seeded shuffle so
 * the same volunteer sees a fresh mix, and other profiles lead with their
 * signature habits instead of the same distance metaphors with different numbers.
 */

import { SA_FIXED_HOLIDAYS } from "./volunteerStats.js";
import { routeRowDistanceKm } from "./patrolHistoryRoute.js";

export const SWIFT_CRUISE_KMH = 40;
export const SWIFT_TOP_KMH = 112;
export const WALK_KMH = 5;
export const FIFA_PITCH_KM = 0.105;
export const TRACK_LAP_KM = 0.4;
export const JNB_PLZ_FLIGHT_MIN = 105;
export const SLEEP_HOURS = 8;
export const WORK_WEEK_HOURS = 40;
export const FEATURE_FILM_MIN = 120;
export const MARATHON_KM = 42.2;

export const LANDMARKS_KM = {
  theescombeWalmer: 9,
  walmerHeightsSummerstrand: 13,
  addoMainCamp: 72,
  jeffreysBay: 82,
  humansdorp: 91,
  makhanda: 128,
  eastLondon: 290,
  capeTown: 752,
};

export const MAX_FUN_FACTS_SHOWN = 10;
export const FUN_FACT_ROTATION_DAYS = 2;

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const COMPARISON_GROUPS = new Set(["distanceTotal", "landmark", "hours"]);

function localDateStr(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localDateStr(d);
}

export function roundKm(km) {
  if (km >= 10) return Math.round(km);
  return Math.round(km * 10) / 10;
}

function minutesAtSpeed(km, speedKmh) {
  if (!speedKmh) return 0;
  return (km / speedKmh) * 60;
}

export function formatMins(mins) {
  const n = Math.max(1, Math.round(mins));
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (!m) return h === 1 ? "1 hour" : `${h} hours`;
  return `${h}h ${m}m`;
}

function distanceByLocalDate(routeRows, dateStr) {
  if (!Array.isArray(routeRows) || !dateStr) return 0;
  return routeRows.reduce((sum, row) => {
    if (!row?.created_at) return sum;
    if (localDateStr(row.created_at) !== dateStr) return sum;
    return sum + routeRowDistanceKm(row);
  }, 0);
}

function latestRouteKm(routeRows) {
  if (!Array.isArray(routeRows)) return 0;
  for (const row of routeRows) {
    const km = routeRowDistanceKm(row);
    if (km >= 0.4) return km;
  }
  return 0;
}

function yesterdayMinutes(patrols) {
  const y = yesterdayStr();
  return (patrols || []).reduce((sum, log) => {
    if (!log?.start_time) return sum;
    if (localDateStr(log.start_time) !== y) return sum;
    return sum + (Number(log.duration_minutes) || 0);
  }, 0);
}

function pitches(km) {
  return Math.max(1, Math.round(km / FIFA_PITCH_KM));
}

function laps(km) {
  return Math.max(1, Math.round(km / TRACK_LAP_KM));
}

function voice(isSelf, name) {
  const who = isSelf ? "You" : (name || "They");
  const were = isSelf ? "were" : "was";
  const your = isSelf ? "your" : (name ? `${name}'s` : "their");
  const they = isSelf ? "you" : (name || "they");
  const have = isSelf ? "have" : "has";
  const are = isSelf ? "are" : "is";
  return { who, were, your, they, have, are };
}

/** Local calendar day number (UTC of Y-M-D), stable across time zones for a given local date. */
export function localDayNumber(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

/** Integer window that advances every two local calendar days. */
export function funFactRotationWindow(date = new Date()) {
  return Math.floor(localDayNumber(date) / FUN_FACT_ROTATION_DAYS);
}

export function daysUntilFunFactRotation(date = new Date()) {
  const dayNum = localDayNumber(date);
  const nextWindowStart = (funFactRotationWindow(date) + 1) * FUN_FACT_ROTATION_DAYS;
  return Math.max(1, nextWindowStart - dayNum);
}

export function funFactsRotationCopy(date = new Date()) {
  return daysUntilFunFactRotation(date) <= 1
    ? "New cards tomorrow."
    : "New cards in 2 days.";
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function argMax(arr) {
  if (!Array.isArray(arr) || !arr.length) return { index: -1, value: 0 };
  let index = 0;
  for (let i = 1; i < arr.length; i++) {
    if ((arr[i] || 0) > (arr[index] || 0)) index = i;
  }
  return { index, value: arr[index] || 0 };
}

function hourRangeLabel(hour) {
  const start = ((hour % 24) + 24) % 24;
  const end = (start + 1) % 24;
  const fmt = (n) => `${String(n).padStart(2, "0")}:00`;
  return `${fmt(start)}–${fmt(end)}`;
}

function fact(id, priority, kicker, title, body, emoji) {
  return { id, priority, kicker, title, body, emoji };
}

function groupForTemplate(template) {
  if (template.group) return template.group;
  const id = template.id;
  if (id.startsWith("rank-")) return "rank";
  if (id.startsWith("yesterday-")) return "yesterday";
  if (id.startsWith("last-") || id === "longest-route-swift") return "lastOuting";
  if (id.startsWith("landmark-")) return "landmark";
  if (id.startsWith("total-km-") || id === "marathon-distance" || id === "route-avg-speed") return "distanceTotal";
  if (id.startsWith("total-hours-") || id.startsWith("longest-patrol-")) return "hours";
  if (["holiday-any", "named-holiday", "friday-13", "leap-day"].includes(id)) return "calendar";
  if (["tenure-days", "span-days", "distinct-months", "consecutive-weeks", "comeback"].includes(id)) return "tenure";
  if (["favorite-slot", "peak-hour", "favorite-weekday"].includes(id)) return "personality";
  if (id.startsWith("weather-") || ["rainy-nights", "foggy-nights", "foggy-mornings", "melting-heat", "storm-watch", "cold-nights", "wet-weekends", "drizzle-mornings"].includes(id)) {
    return "weather";
  }
  if (["typical-loop", "km-this-week", "km-this-month", "long-loops", "short-loops", "busiest-km-day", "night-km", "route-range", "tracked-outings"].includes(id)) {
    return "mileage";
  }
  return "habit";
}

/**
 * Unique fact templates. Each id is used at most once per volunteer.
 * `when` must be true only when the numbers in `build` are real stats.
 */
export const FUN_FACT_TEMPLATES = [
  {
    id: "yesterday-swift-cruise",
    priority: 10,
    when: (c) => c.yKm >= 0.5,
    build: (c) => fact("yesterday-swift-cruise", 10, "Yesterday",
      `${c.v.who} covered ${roundKm(c.yKm)} km on patrol`,
      `At a typical cruise of about ${SWIFT_CRUISE_KMH} km/h, a common swift would cover that in about ${formatMins(minutesAtSpeed(c.yKm, SWIFT_CRUISE_KMH))}.`,
      "🐦"),
  },
  {
    id: "yesterday-swift-top",
    priority: 11,
    when: (c) => c.yKm >= 2,
    build: (c) => fact("yesterday-swift-top", 11, "Yesterday",
      `${roundKm(c.yKm)} km versus a swift's top recorded speed`,
      `The highest measured common-swift level flight is about ${SWIFT_TOP_KMH} km/h — that distance in about ${formatMins(minutesAtSpeed(c.yKm, SWIFT_TOP_KMH))}.`,
      "💨"),
  },
  {
    id: "yesterday-walk",
    priority: 12,
    when: (c) => c.yKm >= 0.5,
    build: (c) => fact("yesterday-walk", 12, "Yesterday",
      `Walking ${roundKm(c.yKm)} km would take about ${formatMins(minutesAtSpeed(c.yKm, WALK_KMH))}`,
      `That uses a comfortable walking pace of about ${WALK_KMH} km/h.`,
      "🚶"),
  },
  {
    id: "yesterday-pitches",
    priority: 13,
    when: (c) => c.yKm >= 1,
    build: (c) => fact("yesterday-pitches", 13, "Yesterday",
      `About ${pitches(c.yKm)} football pitches end to end`,
      `FIFA's recommended pitch length is 105 m. ${c.v.who} covered roughly ${roundKm(c.yKm)} km yesterday.`,
      "⚽"),
  },
  {
    id: "last-swift-cruise",
    priority: 20,
    when: (c) => c.yKm < 0.5 && c.lastKm >= 0.5,
    build: (c) => fact("last-swift-cruise", 20, "Last outing",
      `${c.v.who} drove about ${roundKm(c.lastKm)} km`,
      `A common swift cruising at about ${SWIFT_CRUISE_KMH} km/h would cover that in about ${formatMins(minutesAtSpeed(c.lastKm, SWIFT_CRUISE_KMH))}.`,
      "🐦"),
  },
  {
    id: "last-walk",
    priority: 21,
    when: (c) => c.yKm < 0.5 && c.lastKm >= 0.5,
    build: (c) => fact("last-walk", 21, "Last outing",
      `On foot, ${roundKm(c.lastKm)} km is about ${formatMins(minutesAtSpeed(c.lastKm, WALK_KMH))}`,
      `Same distance, walking at about ${WALK_KMH} km/h.`,
      "🚶"),
  },
  {
    id: "last-track-laps",
    priority: 22,
    when: (c) => c.lastKm >= 0.8,
    build: (c) => fact("last-track-laps", 22, "Last outing",
      `About ${laps(c.lastKm)} laps of a 400 m running track`,
      `Last recorded route: roughly ${roundKm(c.lastKm)} km.`,
      "🏃"),
  },
  {
    id: "yesterday-hours",
    priority: 25,
    when: (c) => c.yKm < 0.5 && c.yMins >= 20,
    build: (c) => fact("yesterday-hours", 25, "Yesterday",
      `${c.v.who} ${c.v.were} on patrol for ${formatMins(c.yMins)}`,
      `Walmer Heights to Summerstrand is about ${LANDMARKS_KM.walmerHeightsSummerstrand} km. A swift at about ${SWIFT_CRUISE_KMH} km/h covers that in about ${formatMins(minutesAtSpeed(LANDMARKS_KM.walmerHeightsSummerstrand, SWIFT_CRUISE_KMH))}.`,
      "🌙"),
  },
  {
    id: "yesterday-film",
    priority: 26,
    when: (c) => c.yMins >= FEATURE_FILM_MIN,
    build: (c) => fact("yesterday-film", 26, "Yesterday",
      `${formatMins(c.yMins)} on the road`,
      `That's as long as about ${Math.max(1, Math.round(c.yMins / FEATURE_FILM_MIN))} two-hour film${c.yMins >= FEATURE_FILM_MIN * 2 ? "s" : ""}.`,
      "🎬"),
  },
  {
    id: "total-km-pitches",
    priority: 30,
    when: (c) => c.totalKm >= 3,
    build: (c) => fact("total-km-pitches", 30, "All that ground",
      `${roundKm(c.totalKm)} km on neighbourhood streets`,
      `End to end that's about ${pitches(c.totalKm)} football pitches (105 m each).`,
      "⚽"),
  },
  {
    id: "total-km-track",
    priority: 31,
    when: (c) => c.totalKm >= 2,
    build: (c) => fact("total-km-track", 31, "All that ground",
      `About ${laps(c.totalKm)} laps of a 400 m track`,
      `Total recorded patrol distance: ${roundKm(c.totalKm)} km.`,
      "🏟️"),
  },
  {
    id: "total-km-walk",
    priority: 32,
    when: (c) => c.totalKm >= 3,
    build: (c) => fact("total-km-walk", 32, "All that ground",
      `Walking it would take about ${formatMins(minutesAtSpeed(c.totalKm, WALK_KMH))}`,
      `${roundKm(c.totalKm)} km at about ${WALK_KMH} km/h.`,
      "🚶"),
  },
  {
    id: "landmark-walmer",
    priority: 33,
    when: (c) => c.totalKm >= LANDMARKS_KM.theescombeWalmer && c.totalKm < LANDMARKS_KM.walmerHeightsSummerstrand,
    build: (c) => fact("landmark-walmer", 33, "Local roads",
      `${roundKm(c.totalKm)} km is more than Theescombe to Walmer`,
      `That suburb hop is about ${LANDMARKS_KM.theescombeWalmer} km by road.`,
      "🏡"),
  },
  {
    id: "landmark-summerstrand",
    priority: 34,
    when: (c) => c.totalKm >= LANDMARKS_KM.walmerHeightsSummerstrand && c.totalKm < LANDMARKS_KM.addoMainCamp,
    build: (c) => fact("landmark-summerstrand", 34, "Local roads",
      `Further than Walmer Heights to Summerstrand`,
      `That stretch is about ${LANDMARKS_KM.walmerHeightsSummerstrand} km. ${c.v.who} ${c.v.have} logged about ${roundKm(c.totalKm)} km.`,
      "🌊"),
  },
  {
    id: "landmark-addo",
    priority: 35,
    when: (c) => c.totalKm >= LANDMARKS_KM.addoMainCamp && c.totalKm < LANDMARKS_KM.jeffreysBay,
    build: (c) => fact("landmark-addo", 35, "Eastern Cape",
      `${roundKm(c.totalKm)} km — past the drive to Addo Main Camp`,
      `SANParks lists Gqeberha to Addo Main Camp at about ${LANDMARKS_KM.addoMainCamp} km.`,
      "🐘"),
  },
  {
    id: "landmark-jbay",
    priority: 36,
    when: (c) => c.totalKm >= LANDMARKS_KM.jeffreysBay && c.totalKm < LANDMARKS_KM.humansdorp,
    build: (c) => fact("landmark-jbay", 36, "Eastern Cape",
      `Further than Gqeberha to Jeffreys Bay`,
      `That N2 run is about ${LANDMARKS_KM.jeffreysBay} km. Patrol total: ${roundKm(c.totalKm)} km.`,
      "🏄"),
  },
  {
    id: "landmark-humansdorp",
    priority: 37,
    when: (c) => c.totalKm >= LANDMARKS_KM.humansdorp && c.totalKm < LANDMARKS_KM.makhanda,
    build: (c) => fact("landmark-humansdorp", 37, "Eastern Cape",
      `Further than Gqeberha to Humansdorp`,
      `About ${LANDMARKS_KM.humansdorp} km by road.`,
      "🛣️"),
  },
  {
    id: "landmark-makhanda",
    priority: 38,
    when: (c) => c.totalKm >= LANDMARKS_KM.makhanda && c.totalKm < LANDMARKS_KM.eastLondon,
    build: (c) => fact("landmark-makhanda", 38, "Eastern Cape",
      `Further than Gqeberha to Makhanda`,
      `That drive is about ${LANDMARKS_KM.makhanda} km.`,
      "🎓"),
  },
  {
    id: "landmark-east-london",
    priority: 39,
    when: (c) => c.totalKm >= LANDMARKS_KM.eastLondon && c.totalKm < LANDMARKS_KM.capeTown,
    build: (c) => fact("landmark-east-london", 39, "Eastern Cape",
      `Further than Gqeberha to East London`,
      `About ${LANDMARKS_KM.eastLondon} km by road.`,
      "🚢"),
  },
  {
    id: "landmark-cape-town",
    priority: 40,
    when: (c) => c.totalKm >= LANDMARKS_KM.capeTown,
    build: (c) => fact("landmark-cape-town", 40, "The long road",
      `${roundKm(c.totalKm)} km is further than Gqeberha to Cape Town`,
      `The N2 drive is about ${LANDMARKS_KM.capeTown} km.`,
      "⛰️"),
  },
  {
    id: "marathon-distance",
    priority: 41,
    when: (c) => c.totalKm >= MARATHON_KM,
    build: (c) => fact("marathon-distance", 41, "All that ground",
      `More than a road marathon (${MARATHON_KM} km)`,
      `Recorded patrol distance: ${roundKm(c.totalKm)} km.`,
      "🏅"),
  },
  {
    id: "longest-route-swift",
    priority: 42,
    when: (c) => c.longestRouteKm >= 2,
    build: (c) => fact("longest-route-swift", 42, "Longest GPS track",
      `One outing covered about ${roundKm(c.longestRouteKm)} km`,
      `A swift at about ${SWIFT_CRUISE_KMH} km/h would fly that in about ${formatMins(minutesAtSpeed(c.longestRouteKm, SWIFT_CRUISE_KMH))}.`,
      "📍"),
  },
  {
    id: "route-avg-speed",
    priority: 43,
    when: (c) => c.totalKm >= 3 && c.routeHours >= 0.25,
    build: (c) => fact("route-avg-speed", 43, "On the move",
      `Average recorded speed about ${c.avgRouteKmh} km/h`,
      `That's from ${roundKm(c.totalKm)} km over about ${formatMins(c.routeHours * 60)} of GPS time — not a speed-limit claim, just the mean of the track.`,
      "📟"),
  },
  {
    id: "total-hours-flights",
    priority: 50,
    when: (c) => c.totalMinutes >= JNB_PLZ_FLIGHT_MIN,
    build: (c) => fact("total-hours-flights", 50, "Time on watch",
      `${c.hoursLabel} of patrol`,
      `A Johannesburg–Gqeberha flight is about ${formatMins(JNB_PLZ_FLIGHT_MIN)}. That's roughly ${Math.max(1, Math.round(c.totalMinutes / JNB_PLZ_FLIGHT_MIN))} of those hops, spent on the streets instead.`,
      "✈️"),
  },
  {
    id: "total-hours-sleep",
    priority: 51,
    when: (c) => c.totalMinutes >= SLEEP_HOURS * 60,
    build: (c) => fact("total-hours-sleep", 51, "Time on watch",
      `About ${Math.round(c.totalMinutes / 60 / SLEEP_HOURS)} nights of sleep, in hours`,
      `${c.hoursLabel} on patrol versus ${SLEEP_HOURS}-hour nights.`,
      "😴"),
  },
  {
    id: "total-hours-workweeks",
    priority: 52,
    when: (c) => c.totalMinutes >= WORK_WEEK_HOURS * 60,
    build: (c) => fact("total-hours-workweeks", 52, "Time on watch",
      `About ${Math.round((c.totalMinutes / 60) / WORK_WEEK_HOURS * 10) / 10} standard 40-hour work weeks`,
      `${c.hoursLabel} logged.`,
      "💼"),
  },
  {
    id: "total-hours-films",
    priority: 53,
    when: (c) => c.totalMinutes >= FEATURE_FILM_MIN,
    build: (c) => fact("total-hours-films", 53, "Time on watch",
      `About ${Math.max(1, Math.round(c.totalMinutes / FEATURE_FILM_MIN))} two-hour films`,
      `${c.hoursLabel} on patrol.`,
      "🎬"),
  },
  {
    id: "total-hours-workdays",
    priority: 54,
    when: (c) => c.totalMinutes >= 8 * 60,
    build: (c) => fact("total-hours-workdays", 54, "Time on watch",
      `About ${Math.round(c.totalMinutes / 60 / 8)} eight-hour workdays`,
      `${c.hoursLabel} looking after the neighbourhood.`,
      "🏭"),
  },
  {
    id: "night-count",
    priority: 60,
    when: (c) => c.nightCount >= 3,
    build: (c) => fact("night-count", 60, "After dark",
      `${c.nightCount} night patrols`,
      `Starts between midnight and 06:00, while most of Gqeberha is asleep.`,
      "🌙"),
  },
  {
    id: "morning-count",
    priority: 61,
    when: (c) => (c.stats.timeDistribution?.morning || 0) >= 5,
    build: (c) => fact("morning-count", 61, "Early hours",
      `${c.stats.timeDistribution.morning} morning patrols`,
      `Starts between 06:00 and 12:00.`,
      "🌅"),
  },
  {
    id: "evening-count",
    priority: 62,
    when: (c) => (c.stats.timeDistribution?.evening || 0) >= 5,
    build: (c) => fact("evening-count", 62, "After work",
      `${c.stats.timeDistribution.evening} evening patrols`,
      `Starts between 18:00 and midnight.`,
      "🌆"),
  },
  {
    id: "afternoon-count",
    priority: 63,
    when: (c) => (c.stats.timeDistribution?.afternoon || 0) >= 5,
    build: (c) => fact("afternoon-count", 63, "Daylight",
      `${c.stats.timeDistribution.afternoon} afternoon patrols`,
      `Starts between 12:00 and 18:00.`,
      "☀️"),
  },
  {
    id: "streak",
    priority: 64,
    when: (c) => c.streak >= 2,
    build: (c) => fact("streak", 64, c.isSelf ? "Don't break it" : "On a roll",
      `${c.streak}-day patrol streak`,
      c.streak >= 7
        ? `A full week. The neighbourhood could set its watch by ${c.v.they}.`
        : "Consecutive calendar days with at least one patrol.",
      "🔥"),
  },
  {
    id: "longest-streak",
    priority: 65,
    when: (c) => (c.stats.longestStreak || 0) >= 5 && (c.stats.longestStreak || 0) !== c.streak,
    build: (c) => fact("longest-streak", 65, "Best run",
      `Longest streak: ${c.stats.longestStreak} days`,
      "That's the best consecutive-day run in the log, even if the current streak is shorter.",
      "📈"),
  },
  {
    id: "weekend-count",
    priority: 66,
    when: (c) => c.weekendCount >= 3,
    build: (c) => fact("weekend-count", 66, "Weekend watch",
      `${c.weekendCount} Saturday and Sunday patrols`,
      "Weekends still counted.",
      "🌤️"),
  },
  {
    id: "friday-count",
    priority: 67,
    when: (c) => (c.stats.fridayPatrols || 0) >= 4,
    build: (c) => fact("friday-count", 67, "Friday nights",
      `${c.stats.fridayPatrols} Friday patrols`,
      "The week still ended on the street.",
      "🎉"),
  },
  {
    id: "sunday-count",
    priority: 68,
    when: (c) => (c.stats.sundayPatrols || 0) >= 4,
    build: (c) => fact("sunday-count", 68, "Sundays",
      `${c.stats.sundayPatrols} Sunday patrols`,
      "Quiet streets, same commitment.",
      "🕊️"),
  },
  {
    id: "weekday-split",
    priority: 69,
    when: (c) => c.totalPatrols >= 10 && (c.stats.weekdayPatrols || 0) >= 5 && c.weekendCount >= 3,
    build: (c) => fact("weekday-split", 69, "The mix",
      `${c.stats.weekdayPatrols} weekdays and ${c.weekendCount} weekend patrols`,
      "Both the working week and the weekend show up in the log.",
      "📅"),
  },
  {
    id: "patrol-count",
    priority: 70,
    when: (c) => c.totalPatrols >= 5,
    build: (c) => fact("patrol-count", 70, "Showing up",
      `${c.totalPatrols} patrols logged`,
      `That's ${c.totalPatrols} times ${c.v.they} went out.`,
      "🛡️"),
  },
  {
    id: "unique-days",
    priority: 71,
    when: (c) => (c.stats.distinctDays || 0) >= 7,
    build: (c) => fact("unique-days", 71, "Showing up",
      `On the road ${c.stats.distinctDays} different days`,
      "Each date with at least one completed patrol.",
      "📆"),
  },
  {
    id: "average-duration",
    priority: 72,
    when: (c) => c.totalPatrols >= 3 && (c.stats.averageDuration || 0) >= 45,
    build: (c) => fact("average-duration", 72, "Typical outing",
      `Average patrol about ${formatMins(c.stats.averageDuration)}`,
      `Across ${c.totalPatrols} completed patrols.`,
      "⏲️"),
  },
  {
    id: "longest-patrol-film",
    priority: 73,
    when: (c) => (c.stats.longestPatrolMinutes || 0) >= FEATURE_FILM_MIN,
    build: (c) => fact("longest-patrol-film", 73, "Longest outing",
      `Longest patrol: ${formatMins(c.stats.longestPatrolMinutes)}`,
      `That's at least one two-hour film, without leaving the neighbourhood.`,
      "🎥"),
  },
  {
    id: "longest-patrol-flight",
    priority: 74,
    when: (c) => (c.stats.longestPatrolMinutes || 0) >= JNB_PLZ_FLIGHT_MIN,
    build: (c) => fact("longest-patrol-flight", 74, "Longest outing",
      `One patrol lasted ${formatMins(c.stats.longestPatrolMinutes)}`,
      `That's as long as a Johannesburg–Gqeberha flight (about ${formatMins(JNB_PLZ_FLIGHT_MIN)}).`,
      "✈️"),
  },
  {
    id: "short-vs-long",
    priority: 75,
    when: (c) => (c.stats.shortestPatrolMinutes || 0) >= 15 && (c.stats.longestPatrolMinutes || 0) >= (c.stats.shortestPatrolMinutes || 0) * 2,
    build: (c) => fact("short-vs-long", 75, "Range",
      `Shortest ${formatMins(c.stats.shortestPatrolMinutes)}, longest ${formatMins(c.stats.longestPatrolMinutes)}`,
      "Same neighbourhood, very different nights.",
      "↔️"),
  },
  {
    id: "tenure-days",
    priority: 76,
    when: (c) => (c.stats.daysSinceFirst || 0) >= 30,
    build: (c) => fact("tenure-days", 76, "Time in the watch",
      `${c.stats.daysSinceFirst} days since the first patrol`,
      c.stats.spanDays
        ? `Active span in the log: ${c.stats.spanDays} days from first to latest.`
        : "Counted from the first completed patrol to today.",
      "🎖️"),
  },
  {
    id: "span-days",
    priority: 77,
    when: (c) => (c.stats.spanDays || 0) >= 60 && (c.stats.spanDays || 0) !== (c.stats.daysSinceFirst || 0),
    build: (c) => fact("span-days", 77, "Time in the watch",
      `${c.stats.spanDays} days between first and latest patrol`,
      "That's the span of the log, not including gaps.",
      "📜"),
  },
  {
    id: "this-week",
    priority: 78,
    when: (c) => (c.stats.patrolsThisWeek || 0) >= 2,
    build: (c) => fact("this-week", 78, "This week",
      `${c.stats.patrolsThisWeek} patrols in the last 7 days`,
      "Still showing up.",
      "💚"),
  },
  {
    id: "this-month",
    priority: 79,
    when: (c) => (c.stats.patrolsThisMonth || 0) >= 4,
    build: (c) => fact("this-month", 79, "Last 30 days",
      `${c.stats.patrolsThisMonth} patrols in the last 30 days`,
      "A busy month on the board.",
      "📊"),
  },
  {
    id: "double-header",
    priority: 80,
    when: (c) => (c.stats.sameDayDoubles || 0) >= 2,
    build: (c) => fact("double-header", 80, "Same day",
      `${c.stats.sameDayDoubles} days with two or more patrols`,
      (c.stats.maxSameDay || 0) >= 3
        ? `Busiest day in the log: ${c.stats.maxSameDay} patrols.`
        : "Some days meant going out more than once.",
      "🎭"),
  },
  {
    id: "before-dawn",
    priority: 81,
    when: (c) => (c.stats.startsBefore6 || 0) >= 3,
    build: (c) => fact("before-dawn", 81, "Before sunrise",
      `${c.stats.startsBefore6} patrols started before 06:00`,
      "The streets were still quiet.",
      "🌘"),
  },
  {
    id: "crossed-midnight",
    priority: 82,
    when: (c) => (c.stats.crossedMidnight || 0) >= 2,
    build: (c) => fact("crossed-midnight", 82, "Past midnight",
      `${c.stats.crossedMidnight} patrols ended on the next calendar day`,
      "The watch ran through midnight.",
      "🕛"),
  },
  {
    id: "coffee-hours",
    priority: 83,
    when: (c) => (c.stats.startsCoffee || 0) >= 3,
    build: (c) => fact("coffee-hours", 83, "Early coffee",
      `${c.stats.startsCoffee} patrols started between 05:00 and 07:59`,
      "Breakfast time, already on the road.",
      "☕"),
  },
  {
    id: "twilight-hours",
    priority: 84,
    when: (c) => (c.stats.startsTwilight || 0) >= 5,
    build: (c) => fact("twilight-hours", 84, "Twilight",
      `${c.stats.startsTwilight} patrols started between 17:00 and 19:59`,
      "The change of light, and the change of shift.",
      "🧡"),
  },
  {
    id: "two-hour-patrols",
    priority: 85,
    when: (c) => (c.stats.longPatrols2h || 0) >= 5,
    build: (c) => fact("two-hour-patrols", 85, "Staying out",
      `${c.stats.longPatrols2h} patrols lasted 2 hours or more`,
      "Not just a quick loop.",
      "⏱️"),
  },
  {
    id: "winter-count",
    priority: 86,
    when: (c) => (c.stats.seasonCounts?.winter || 0) >= 3,
    build: (c) => fact("winter-count", 86, "Winter",
      `${c.stats.seasonCounts.winter} patrols in June–August`,
      "Southern-hemisphere winter, still out.",
      "❄️"),
  },
  {
    id: "summer-count",
    priority: 87,
    when: (c) => (c.stats.seasonCounts?.summer || 0) >= 3,
    build: (c) => fact("summer-count", 87, "Summer",
      `${c.stats.seasonCounts.summer} patrols in December–February`,
      "High summer in Gqeberha.",
      "🏖️"),
  },
  {
    id: "distinct-months",
    priority: 88,
    when: (c) => (c.stats.distinctMonths || 0) >= 3,
    build: (c) => fact("distinct-months", 88, "The long haul",
      `Patrols in ${c.stats.distinctMonths} different months`,
      "Not a one-month burst.",
      "🗓️"),
  },
  {
    id: "consecutive-weeks",
    priority: 89,
    when: (c) => (c.stats.consecutiveWeeks || 0) >= 4,
    build: (c) => fact("consecutive-weeks", 89, "Week after week",
      `${c.stats.consecutiveWeeks} weeks in a row with a patrol`,
      "At least one outing each of those weeks.",
      "🔁"),
  },
  {
    id: "rank-champion",
    priority: 5,
    when: (c) => c.stats.globalRank === 1,
    build: (c) => fact("rank-champion", 5, "The board",
      `${c.v.who} ${c.v.are} 1st on the all-time board`,
      "Most patrol hours among volunteers in this area.",
      "👑"),
  },
  {
    id: "rank-podium",
    priority: 6,
    when: (c) => c.stats.globalRank > 1 && c.stats.globalRank <= 3,
    build: (c) => fact("rank-podium", 6, "The board",
      `All-time rank #${c.stats.globalRank}`,
      "On the podium for total patrol hours.",
      "🥇"),
  },
  {
    id: "holiday-any",
    priority: 90,
    when: (c) => Object.values(c.stats.holidayCounts || {}).filter((n) => n > 0).length >= 2,
    build: (c) => {
      const hits = Object.entries(c.stats.holidayCounts || {}).filter(([, n]) => n > 0);
      const total = hits.reduce((s, [, n]) => s + n, 0);
      return fact("holiday-any", 90, "Public holidays",
        `${total} patrol${total === 1 ? "" : "s"} on a fixed-date public holiday`,
        "South African holidays with a set calendar date — New Year, Freedom Day, Heritage Day, and the rest.",
        "🇿🇦");
    },
  },
  {
    id: "full-week-map",
    priority: 91,
    when: (c) => (c.stats.distinctWeekdays || 0) >= 7,
    build: (c) => fact("full-week-map", 91, "Every weekday",
      "At least one patrol on every day of the week",
      "Monday through Sunday all appear in the log.",
      "🧭"),
  },
  {
    id: "all-rounder-fact",
    priority: 92,
    when: (c) => ["night", "morning", "afternoon", "evening"].every((k) => (c.stats.timeDistribution?.[k] || 0) > 0),
    build: (c) => fact("all-rounder-fact", 92, "All hours",
      "Patrols in every time-of-day window",
      "Night, morning, afternoon, and evening all have at least one start.",
      "🔄"),
  },
  {
    id: "favorite-slot",
    priority: 7,
    group: "personality",
    when: (c) => c.stats.favoriteTime && c.stats.favoriteTime.count >= 3 && c.totalPatrols >= 5,
    build: (c) => {
      const ft = c.stats.favoriteTime;
      const pct = Math.round((ft.count / Math.max(1, c.totalPatrols)) * 100);
      return fact("favorite-slot", 7, "Patrol personality",
        `${c.v.who} ${c.v.are} a ${ft.label}`,
        `${ft.count} of ${c.totalPatrols} patrols (${pct}%) started in ${ft.period} hours — that's ${c.v.your} usual slot.`,
        ft.icon || "🧭");
    },
  },
  {
    id: "peak-hour",
    priority: 14,
    group: "personality",
    when: (c) => c.peakHour.value >= 3,
    build: (c) => fact("peak-hour", 14, "Usual start",
      `Most patrols start ${hourRangeLabel(c.peakHour.index)}`,
      `${c.peakHour.value} starts in that hour — ${c.v.your} busiest slot on the clock.`,
      "🕐"),
  },
  {
    id: "favorite-weekday",
    priority: 16,
    group: "personality",
    when: (c) => {
      const max = c.peakDow.value;
      const second = [...(c.stats.dowCounts || [])].sort((a, b) => b - a)[1] || 0;
      return max >= 4 && max > second;
    },
    build: (c) => fact("favorite-weekday", 16, "Favourite day",
      `${WEEKDAY_NAMES[c.peakDow.index] || "One weekday"} is ${c.v.your} usual patrol day`,
      `${c.peakDow.value} patrols started on that day — more than any other.`,
      "📌"),
  },
  {
    id: "named-holiday",
    priority: 57,
    group: "calendar",
    when: (c) => Object.values(c.stats.holidayCounts || {}).some((n) => n > 0),
    build: (c) => {
      const hits = Object.entries(c.stats.holidayCounts || {}).filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const [id, count] = hits[0] || [];
      const def = SA_FIXED_HOLIDAYS.find((h) => h.id === id);
      const label = def?.name || "a public holiday";
      return fact("named-holiday", 57, label,
        `${count} patrol${count === 1 ? "" : "s"} on ${label}`,
        `${c.v.who} still went out when the calendar said rest.`,
        "🇿🇦");
    },
  },
  {
    id: "friday-13",
    priority: 93,
    group: "calendar",
    when: (c) => (c.stats.friday13thCount || 0) >= 1,
    build: (c) => fact("friday-13", 93, "Unlucky date",
      `${c.stats.friday13thCount} patrol${c.stats.friday13thCount === 1 ? "" : "s"} on a Friday the 13th`,
      `The date did not keep ${c.v.they} home.`,
      "🍀"),
  },
  {
    id: "leap-day",
    priority: 94,
    group: "calendar",
    when: (c) => (c.stats.leapDayCount || 0) >= 1,
    build: (c) => fact("leap-day", 94, "Once every four years",
      `${c.stats.leapDayCount} patrol${c.stats.leapDayCount === 1 ? "" : "s"} on 29 February`,
      "Leap day still counted.",
      "🐸"),
  },
  {
    id: "saturday-count",
    priority: 68.5,
    group: "habit",
    when: (c) => (c.stats.saturdayPatrols || 0) >= 4,
    build: (c) => fact("saturday-count", 68.5, "Saturdays",
      `${c.stats.saturdayPatrols} Saturday patrols`,
      "The weekend started on the street.",
      "🥳"),
  },
  {
    id: "graveyard-count",
    priority: 81.5,
    group: "habit",
    when: (c) => (c.stats.startsGraveyard || 0) >= 3,
    build: (c) => fact("graveyard-count", 81.5, "Graveyard shift",
      `${c.stats.startsGraveyard} patrols started between midnight and 04:59`,
      "The quietest hours of the night.",
      "🪦"),
  },
  {
    id: "lunch-count",
    priority: 83.5,
    group: "habit",
    when: (c) => (c.stats.startsLunch || 0) >= 3,
    build: (c) => fact("lunch-count", 83.5, "Midday",
      `${c.stats.startsLunch} patrols started at lunch (12:00–13:59)`,
      "A loop instead of a long lunch.",
      "🥪"),
  },
  {
    id: "late-evening",
    priority: 84.5,
    group: "habit",
    when: (c) => (c.stats.startsLateEvening || 0) >= 3,
    build: (c) => fact("late-evening", 84.5, "Late watch",
      `${c.stats.startsLateEvening} patrols started at 22:00 or later`,
      "Most households were already in for the night.",
      "🌃"),
  },
  {
    id: "three-hour-patrols",
    priority: 85.5,
    group: "habit",
    when: (c) => (c.stats.longPatrols3h || 0) >= 2,
    build: (c) => fact("three-hour-patrols", 85.5, "Long shifts",
      `${c.stats.longPatrols3h} patrols lasted 3 hours or more`,
      "Well past a quick neighbourhood loop.",
      "🏋️"),
  },
  {
    id: "distinct-zones",
    priority: 71.5,
    group: "habit",
    when: (c) => (c.stats.distinctZones || 0) >= 2,
    build: (c) => fact("distinct-zones", 71.5, "Coverage",
      `Patrols logged in ${c.stats.distinctZones} different zones`,
      "Not stuck on a single street.",
      "🗺️"),
  },
  {
    id: "autumn-count",
    priority: 86.5,
    group: "habit",
    when: (c) => (c.stats.seasonCounts?.autumn || 0) >= 3,
    build: (c) => fact("autumn-count", 86.5, "Autumn",
      `${c.stats.seasonCounts.autumn} patrols in March–May`,
      "Southern-hemisphere autumn, still out.",
      "🍂"),
  },
  {
    id: "spring-count",
    priority: 87.5,
    group: "habit",
    when: (c) => (c.stats.seasonCounts?.spring || 0) >= 3,
    build: (c) => fact("spring-count", 87.5, "Spring",
      `${c.stats.seasonCounts.spring} patrols in September–November`,
      "Spring in Gqeberha.",
      "🌼"),
  },
  {
    id: "comeback",
    priority: 77.5,
    group: "tenure",
    when: (c) => Boolean(c.stats.hadComeback),
    build: (c) => fact("comeback", 77.5, "Back on the road",
      `${c.v.who} returned after a break of 3 weeks or more`,
      "The log has a gap — and then it starts again.",
      "↩️"),
  },
  {
    id: "total-km-swift",
    priority: 44,
    when: (c) => c.totalKm >= 5,
    build: (c) => fact("total-km-swift", 44, "All that ground",
      `A swift would cruise ${roundKm(c.totalKm)} km in about ${formatMins(minutesAtSpeed(c.totalKm, SWIFT_CRUISE_KMH))}`,
      `That's ${c.v.your} total recorded patrol distance at about ${SWIFT_CRUISE_KMH} km/h.`,
      "🐦"),
  },
  {
    id: "weather-now-rain",
    priority: 8,
    group: "weather",
    when: (c) => Boolean(c.wxNow?.rainyNightNow),
    build: (c) => fact("weather-now-rain", 8, "Tonight",
      "It's a rainy night in the area",
      c.isSelf
        ? "You already know that kind of watch — wet streets, same loop."
        : `${c.v.who} already knows that kind of watch — wet streets, same loop.`,
      "🌧️"),
  },
  {
    id: "weather-now-fog",
    priority: 8,
    group: "weather",
    when: (c) => Boolean(c.wxNow?.foggyNightNow || c.wxNow?.foggyMorningNow),
    build: (c) => fact("weather-now-fog", 8, c.wxNow?.foggyNightNow ? "Tonight" : "This morning",
      c.wxNow?.foggyNightNow ? "It's a foggy night in the area" : "Coastal fog is sitting on the streets",
      `Headlights and a short horizon — familiar patrol weather for ${c.v.they}.`,
      "🌫️"),
  },
  {
    id: "weather-now-heat",
    priority: 9,
    group: "weather",
    when: (c) => Boolean(c.wxNow?.heatNow) && Number.isFinite(c.wxNow?.temperatureC),
    build: (c) => fact("weather-now-heat", 9, "Out there now",
      `It's ${c.wxNow.temperatureC}° — melting in the heat`,
      "Berg-wind days are the ones that stick to the seat.",
      "🥵"),
  },
  {
    id: "weather-now-storm",
    priority: 9,
    group: "weather",
    when: (c) => Boolean(c.wxNow?.stormNow),
    build: (c) => fact("weather-now-storm", 9, "Out there now",
      "Thunder over the neighbourhood",
      `A stormy watch — the kind ${c.v.they} ${c.v.have} already sat through.`,
      "⛈️"),
  },
  {
    id: "rainy-nights",
    priority: 18,
    group: "weather",
    when: (c) => (c.wx?.rainyNight || 0) >= 2,
    build: (c) => fact("rainy-nights", 18, "Wet watch",
      `${c.wx.rainyNight} rainy night${c.wx.rainyNight === 1 ? "" : "s"} on patrol`,
      "Started after dark with rain on the windscreen.",
      "🌧️"),
  },
  {
    id: "foggy-nights",
    priority: 19,
    group: "weather",
    when: (c) => (c.wx?.foggyNight || 0) >= 2,
    build: (c) => fact("foggy-nights", 19, "Low visibility",
      `${c.wx.foggyNight} foggy night${c.wx.foggyNight === 1 ? "" : "s"} on patrol`,
      "Coastal fog, headlights, and the usual loop.",
      "🌫️"),
  },
  {
    id: "foggy-mornings",
    priority: 19.5,
    group: "weather",
    when: (c) => (c.wx?.foggyMorning || 0) >= 2,
    build: (c) => fact("foggy-mornings", 19.5, "Morning haze",
      `${c.wx.foggyMorning} foggy morning patrols`,
      "Gqeberha does this — a grey start before the day burns clear.",
      "🌁"),
  },
  {
    id: "melting-heat",
    priority: 20,
    group: "weather",
    when: (c) => (c.wx?.hot || 0) >= 2,
    build: (c) => fact("melting-heat", 20, "Melting in the heat",
      `${c.wx.hot} patrol${c.wx.hot === 1 ? "" : "s"} in ${c.wx.hottestC ?? 28}° heat`,
      "Hot enough that the tar looks soft. Still went out.",
      "🥵"),
  },
  {
    id: "storm-watch",
    priority: 21,
    group: "weather",
    when: (c) => (c.wx?.storm || 0) >= 2,
    build: (c) => fact("storm-watch", 21, "Thunder",
      `${c.wx.storm} patrols started in a thunderstorm`,
      "Not fair-weather volunteering.",
      "⛈️"),
  },
  {
    id: "cold-nights",
    priority: 22,
    group: "weather",
    when: (c) => (c.wx?.coldNight || 0) >= 2,
    build: (c) => fact("cold-nights", 22, "Winter nights",
      `${c.wx.coldNight} patrols on a ${c.wx.coldestC ?? 10}° night`,
      "Cold for the Bay — windows up, flask out.",
      "🥶"),
  },
  {
    id: "wet-weekends",
    priority: 23,
    group: "weather",
    when: (c) => (c.wx?.wetWeekend || 0) >= 2,
    build: (c) => fact("wet-weekends", 23, "Wet weekends",
      `${c.wx.wetWeekend} weekend patrols in the rain`,
      "Saturday and Sunday still counted when it was pouring.",
      "🌦️"),
  },
  {
    id: "drizzle-mornings",
    priority: 23.5,
    group: "weather",
    when: (c) => (c.wx?.drizzleMorning || 0) >= 2,
    build: (c) => fact("drizzle-mornings", 23.5, "Grey mornings",
      `${c.wx.drizzleMorning} morning patrols in rain or drizzle`,
      "Out before the streets had dried.",
      "☔"),
  },
  {
    id: "typical-loop",
    priority: 17,
    group: "mileage",
    when: (c) => (c.routeCount || 0) >= 3 && (c.medianKm || 0) >= 1.5,
    build: (c) => fact("typical-loop", 17, "Usual loop",
      `${c.v.your} typical GPS loop is about ${roundKm(c.medianKm)} km`,
      `Median of ${c.routeCount} recorded tracks — the circuit ${c.isSelf ? "you actually drive" : `${c.v.who} actually drives`}.`,
      "🔁"),
  },
  {
    id: "km-this-week",
    priority: 12,
    group: "mileage",
    when: (c) => (c.kmThisWeek || 0) >= 2,
    build: (c) => fact("km-this-week", 12, "Last 7 days",
      `${roundKm(c.kmThisWeek)} km on GPS this week`,
      "Mileage from recorded patrol routes, not a guess.",
      "📍"),
  },
  {
    id: "km-this-month",
    priority: 24,
    group: "mileage",
    when: (c) => (c.kmThisMonth || 0) >= 8 && (c.kmThisMonth || 0) > (c.kmThisWeek || 0) + 3,
    build: (c) => fact("km-this-month", 24, "Last 30 days",
      `${roundKm(c.kmThisMonth)} km in the last month`,
      `Across ${c.routeCount} GPS tracks.`,
      "🗺️"),
  },
  {
    id: "long-loops",
    priority: 28,
    group: "mileage",
    when: (c) => (c.longLoopCount || 0) >= 2,
    build: (c) => fact("long-loops", 28, "Long loops",
      `${c.longLoopCount} GPS tracks of 10 km or more`,
      `Longest recorded outing: about ${roundKm(c.longestRouteKm)} km.`,
      "🛣️"),
  },
  {
    id: "short-loops",
    priority: 29,
    group: "mileage",
    when: (c) => (c.shortLoopCount || 0) >= 3,
    build: (c) => fact("short-loops", 29, "Quick loops",
      `${c.shortLoopCount} short neighbourhood loops (under 3 km)`,
      "The tight circuit around the block, not a highway run.",
      "🏘️"),
  },
  {
    id: "busiest-km-day",
    priority: 30,
    group: "mileage",
    when: (c) => (c.maxDayKm || 0) >= 8,
    build: (c) => fact("busiest-km-day", 30, "Busiest day",
      `${roundKm(c.maxDayKm)} km on the busiest GPS day`,
      "One calendar day, all recorded tracks added up.",
      "📌"),
  },
  {
    id: "night-km",
    priority: 27,
    group: "mileage",
    when: (c) => (c.nightKm || 0) >= 8,
    build: (c) => fact("night-km", 27, "After dark",
      `About ${roundKm(c.nightKm)} km after dark`,
      "Tracks that finished between 18:00 and 06:00.",
      "🌙"),
  },
  {
    id: "route-range",
    priority: 31,
    group: "mileage",
    when: (c) => (c.shortestRouteKm || 0) >= 0.8 && (c.longestRouteKm || 0) >= (c.shortestRouteKm || 0) * 2,
    build: (c) => fact("route-range", 31, "Range of loops",
      `Shortest track ${roundKm(c.shortestRouteKm)} km, longest ${roundKm(c.longestRouteKm)} km`,
      "Same neighbourhood, very different distances.",
      "↔️"),
  },
  {
    id: "tracked-outings",
    priority: 32,
    group: "mileage",
    when: (c) => (c.routeCount || 0) >= 5 && c.totalPatrols >= c.routeCount,
    build: (c) => fact("tracked-outings", 32, "GPS coverage",
      `GPS caught ${c.routeCount} of ${c.totalPatrols} patrols`,
      `${roundKm(c.totalKm)} km on those tracks.`,
      "📡"),
  },
  {
    id: "getting-started",
    priority: 200,
    when: (c) => c.totalPatrols >= 1,
    build: (c) => fact("getting-started", 200, "Just getting going",
      "Every kilometre counts",
      c.isSelf
        ? "Keep GPS on for the next patrol and we will compare distance to a swift, a walk, and Eastern Cape roads."
        : "More habit cards appear as hours and GPS tracks add up.",
      "✨"),
  },
];

export const FUN_FACT_TEMPLATE_COUNT = FUN_FACT_TEMPLATES.length;

function groupCapFor(isSelf) {
  if (isSelf) {
    return {
      rank: 1,
      yesterday: 2,
      lastOuting: 2,
      distanceTotal: 2,
      landmark: 1,
      hours: 2,
      habit: 2,
      calendar: 1,
      tenure: 1,
      personality: 1,
      weather: 2,
      mileage: 2,
      other: 2,
    };
  }
  return {
    rank: 1,
    yesterday: 1,
    lastOuting: 1,
    distanceTotal: 1,
    landmark: 1,
    hours: 1,
    habit: 3,
    calendar: 2,
    tenure: 1,
    personality: 2,
    weather: 2,
    mileage: 2,
    other: 1,
  };
}

function pickRotatedFunFacts(matched, { isSelf, seed, limit }) {
  const starter = matched.find((f) => f.id === "getting-started");
  const rest = matched.filter((f) => f.id !== "getting-started");
  if (rest.length === 0 && starter) return [starter];

  const rng = mulberry32(seed);
  const groupCap = groupCapFor(isSelf);
  const byGroup = new Map();
  for (const f of rest) {
    const g = f.group || "other";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(f);
  }

  const pinNow = (f) =>
    String(f.id).startsWith("weather-now-")
    || String(f.id).startsWith("rank-")
    || f.id === "km-this-week";

  for (const list of byGroup.values()) {
    const pinned = list.filter(pinNow).sort((a, b) => a.priority - b.priority);
    const rotatable = list.filter((f) => !pinNow(f)).sort((a, b) => a.priority - b.priority);
    if (rotatable.length > 1) {
      const offset = Math.floor(rng() * rotatable.length);
      const rotated = rotatable.slice(offset).concat(rotatable.slice(0, offset));
      rotatable.length = 0;
      rotatable.push(...rotated);
    }
    list.length = 0;
    list.push(...pinned, ...rotatable);
  }

  const preferredOrder = isSelf
    ? ["rank", "yesterday", "mileage", "weather", "lastOuting", "personality", "habit", "distanceTotal", "landmark", "hours", "calendar", "tenure", "other"]
    : ["rank", "personality", "mileage", "weather", "habit", "calendar", "tenure", "yesterday", "lastOuting", "other", "landmark", "distanceTotal", "hours"];

  if (!isSelf && preferredOrder.length > 2) {
    const head = preferredOrder[0];
    const tail = preferredOrder.slice(1);
    const shift = Math.floor(rng() * tail.length);
    preferredOrder.splice(0, preferredOrder.length, head, ...tail.slice(shift), ...tail.slice(0, shift));
  }

  const used = {};
  const picked = [];
  const seen = new Set();

  const tryPickFrom = (groups) => {
    for (const g of groups) {
      const list = byGroup.get(g) || [];
      for (const f of list) {
        if (picked.length >= limit) return;
        if (seen.has(f.id)) continue;
        used[g] = used[g] || 0;
        if (used[g] >= (groupCap[g] ?? 2)) continue;
        used[g] += 1;
        seen.add(f.id);
        picked.push(f);
      }
    }
  };

  if (isSelf) {
    tryPickFrom(preferredOrder);
  } else {
    tryPickFrom(["rank", "personality", "mileage", "weather"]);
    tryPickFrom(preferredOrder.filter((g) => !COMPARISON_GROUPS.has(g)));
    if (picked.length < limit) {
      tryPickFrom(preferredOrder.filter((g) => COMPARISON_GROUPS.has(g)));
    }
  }

  return picked.slice(0, limit);
}

export function buildLeaderboardFunFacts({
  patrols = [],
  routeRows = [],
  stats = null,
  isSelf = true,
  subjectName = null,
  subjectId = null,
  now = null,
  weather = null,
  weatherNow = null,
} = {}) {
  if (!stats || !(stats.totalPatrols > 0)) return [];

  const when = now instanceof Date ? now : now ? new Date(now) : new Date();
  const totalKm = Number(stats.routeStats?.totalDistance) || 0;
  const routeSeconds = Number(stats.routeStats?.totalDuration) || 0;
  const routeHours = routeSeconds > 0 ? routeSeconds / 3600 : 0;
  const avgRouteKmh = routeHours > 0 && totalKm > 0 ? Math.round((totalKm / routeHours) * 10) / 10 : 0;
  const peakHour = argMax(stats.hourStarts);
  const peakDow = argMax(stats.dowCounts);

  const ctx = {
    patrols,
    routeRows,
    stats,
    isSelf,
    v: voice(isSelf, subjectName),
    yKm: distanceByLocalDate(routeRows, yesterdayStr()),
    lastKm: latestRouteKm(routeRows),
    yMins: yesterdayMinutes(patrols),
    totalKm,
    longestRouteKm: Number(stats.routeStats?.longestRouteKm) || 0,
    routeHours,
    avgRouteKmh,
    totalMinutes: Number(stats.totalMinutes) || 0,
    hoursLabel: `${Math.round((Number(stats.totalMinutes) || 0) / 60 * 10) / 10} hours`,
    totalPatrols: Number(stats.totalPatrols) || 0,
    streak: Number(stats.currentStreak) || 0,
    nightCount: Number(stats.timeDistribution?.night) || 0,
    weekendCount: Number(stats.weekendPatrols) || 0,
    peakHour,
    peakDow,
    routeCount: Number(stats.routeStats?.routeCount) || 0,
    medianKm: Number(stats.routeStats?.medianRouteKm) || 0,
    kmThisWeek: Number(stats.routeStats?.kmThisWeek) || 0,
    kmThisMonth: Number(stats.routeStats?.kmThisMonth) || 0,
    longLoopCount: Number(stats.routeStats?.longLoopCount) || 0,
    shortLoopCount: Number(stats.routeStats?.shortLoopCount) || 0,
    maxDayKm: Number(stats.routeStats?.maxDayKm) || 0,
    nightKm: Number(stats.routeStats?.nightKm) || 0,
    shortestRouteKm: Number(stats.routeStats?.shortestRouteKm) || 0,
    wx: weather || {},
    wxNow: weatherNow || {},
  };

  const matched = FUN_FACT_TEMPLATES
    .filter((t) => {
      try {
        return t.when(ctx);
      } catch {
        return false;
      }
    })
    .map((t) => ({ ...t.build(ctx), group: groupForTemplate(t) }))
    .filter(Boolean);

  const seedKey = `${funFactRotationWindow(when)}|${subjectId || subjectName || (isSelf ? "self" : "anon")}`;
  return pickRotatedFunFacts(matched, {
    isSelf,
    seed: hashSeed(seedKey),
    limit: MAX_FUN_FACTS_SHOWN,
  });
}
