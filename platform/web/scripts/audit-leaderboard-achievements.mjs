/**
 * Audit leaderboard badges + did-you-know templates for count, uniqueness,
 * and Sven-scale coverage. Run from platform/web:
 *   node scripts/audit-leaderboard-achievements.mjs
 */
import { BADGE_DEFS, BADGE_COUNT, evaluateLeaderboardBadges } from "../src/utils/leaderboardBadges.js";
import {
  FUN_FACT_TEMPLATES,
  FUN_FACT_TEMPLATE_COUNT,
  MAX_FUN_FACTS_SHOWN,
  buildLeaderboardFunFacts,
  SWIFT_CRUISE_KMH,
  SWIFT_TOP_KMH,
  WALK_KMH,
  FIFA_PITCH_KM,
  TRACK_LAP_KM,
  JNB_PLZ_FLIGHT_MIN,
  LANDMARKS_KM,
} from "../src/utils/leaderboardFunFacts.js";
import { buildVolunteerStats, SA_FIXED_HOLIDAYS } from "../src/utils/volunteerStats.js";

const issues = [];
function fail(msg) {
  issues.push(msg);
  console.error(`FAIL: ${msg}`);
}
function ok(msg) {
  console.log(`OK   ${msg}`);
}

if (BADGE_COUNT !== 100 || BADGE_DEFS.length !== 100) {
  fail(`Expected 100 badges, got BADGE_COUNT=${BADGE_COUNT} defs=${BADGE_DEFS.length}`);
} else {
  ok("100 badges defined");
}

const badgeIds = BADGE_DEFS.map((b) => b.id);
const badgeNames = BADGE_DEFS.map((b) => b.name);
if (new Set(badgeIds).size !== badgeIds.length) {
  const dup = badgeIds.filter((id, i) => badgeIds.indexOf(id) !== i);
  fail(`Duplicate badge ids: ${[...new Set(dup)].join(", ")}`);
} else {
  ok("Badge ids are unique");
}
if (new Set(badgeNames).size !== badgeNames.length) {
  const dup = badgeNames.filter((n, i) => badgeNames.indexOf(n) !== i);
  fail(`Duplicate badge names: ${[...new Set(dup)].join(", ")}`);
} else {
  ok("Badge names are unique");
}

const missingProgress = BADGE_DEFS.filter((b) => typeof b.progress !== "function");
if (missingProgress.length) fail(`Badges missing progress(): ${missingProgress.map((b) => b.id).join(", ")}`);
else ok("Every badge has a progress() check");

if (FUN_FACT_TEMPLATE_COUNT < 50 || FUN_FACT_TEMPLATES.length < 50) {
  fail(`Need >= 50 fact templates, got ${FUN_FACT_TEMPLATE_COUNT}`);
} else {
  ok(`${FUN_FACT_TEMPLATE_COUNT} unique did-you-know templates (>= 50)`);
}

const factIds = FUN_FACT_TEMPLATES.map((t) => t.id);
if (new Set(factIds).size !== factIds.length) {
  fail("Duplicate fact template ids");
} else {
  ok("Fact template ids are unique");
}

const emptyWhen = FUN_FACT_TEMPLATES.filter((t) => typeof t.when !== "function" || typeof t.build !== "function");
if (emptyWhen.length) fail("Fact templates missing when/build");
else ok("Every fact template has when() and build()");

if (MAX_FUN_FACTS_SHOWN < 8) fail(`Display cap ${MAX_FUN_FACTS_SHOWN} should be at least 8 (double the old 4)`);
else ok(`Shows up to ${MAX_FUN_FACTS_SHOWN} facts (old cap was 4)`);

if (SWIFT_CRUISE_KMH !== 40) fail("Swift cruise should be 40 km/h (36–43 documented range midpoint)");
if (SWIFT_TOP_KMH !== 112) fail("Swift top should be 112 km/h (31.1 m/s)");
if (WALK_KMH !== 5) fail("Walk pace should be 5 km/h");
if (FIFA_PITCH_KM !== 0.105) fail("FIFA pitch should be 0.105 km");
if (TRACK_LAP_KM !== 0.4) fail("Track lap should be 0.4 km");
if (JNB_PLZ_FLIGHT_MIN !== 105) fail("JNB–PLZ should be 105 min");
if (LANDMARKS_KM.addoMainCamp !== 72) fail("Addo Main Camp should be 72 km (SANParks), not lumped with Jeffreys Bay");
if (LANDMARKS_KM.jeffreysBay !== 82) fail("Jeffreys Bay should be ~82 km, not 70");
if (LANDMARKS_KM.eastLondon !== 290) fail("East London should be ~290 km, not 300");
if (LANDMARKS_KM.capeTown !== 752) fail("Cape Town should be ~752 km");
ok("Reference constants match documented sources");

if (SA_FIXED_HOLIDAYS.length !== 10) fail("Expected 10 fixed-date SA public holidays");
else ok("10 fixed-date SA public holidays (Easter excluded — it moves)");

// Sven-scale fixture: #1 volunteer with a long history (guideline, not a live fetch).
const svenLogs = [];
const start = new Date("2024-01-05T21:00:00");
for (let i = 0; i < 160; i++) {
  const t = new Date(start);
  t.setDate(start.getDate() + i);
  const hour = [21, 22, 0, 2, 6, 18][i % 6];
  t.setHours(hour, 10, 0, 0);
  const end = new Date(t);
  end.setMinutes(end.getMinutes() + 130);
  svenLogs.push({
    start_time: t.toISOString(),
    end_time: end.toISOString(),
    duration_minutes: 130,
    zone: i % 4 === 0 ? "Theescombe" : i % 4 === 1 ? "Walmer" : "Lovemore Park",
  });
}
svenLogs.push({
  start_time: "2024-12-25T20:00:00",
  end_time: "2024-12-25T22:15:00",
  duration_minutes: 135,
  zone: "Theescombe",
});
svenLogs.push({
  start_time: "2025-01-01T00:30:00",
  end_time: "2025-01-01T02:30:00",
  duration_minutes: 120,
  zone: "Theescombe",
});

const svenRoutes = Array.from({ length: 80 }, (_, i) => ({
  total_distance_km: 8 + (i % 7),
  total_duration_seconds: 130 * 60,
  created_at: svenLogs[i]?.start_time || svenLogs[0].start_time,
}));

const svenStats = buildVolunteerStats(svenLogs, svenRoutes, { globalRank: 1 });
if (!svenStats) fail("Sven-scale stats failed to build");
else {
  ok(`Sven-scale fixture: ${svenStats.totalPatrols} patrols, ${Math.floor(svenStats.totalMinutes / 60)}h, ${Math.floor(svenStats.routeStats.totalDistance)} km`);
  if (!svenStats.routeStats?.medianRouteKm || svenStats.routeStats.medianRouteKm < 8) {
    fail("Sven-scale should have a typical GPS loop from patrol_routes mileage");
  } else {
    ok(`Sven-scale typical GPS loop ${svenStats.routeStats.medianRouteKm} km (${svenStats.routeStats.routeCount} tracks)`);
  }
  const badges = evaluateLeaderboardBadges(svenStats);
  if (badges.total !== 100) fail("evaluateLeaderboardBadges total is not 100");
  if (badges.earnedCount < 20) fail(`Sven-scale should earn many badges, got ${badges.earnedCount}`);
  else ok(`Sven-scale earns ${badges.earnedCount} of 100 badges`);
  const facts = buildLeaderboardFunFacts({
    patrols: svenLogs,
    routeRows: svenRoutes,
    stats: svenStats,
    isSelf: false,
    subjectName: "Sven",
  });
  if (facts.length < 8) fail(`Sven-scale should surface >= 8 facts (double old 4), got ${facts.length}`);
  else ok(`Sven-scale surfaces ${facts.length} did-you-know cards (cap ${MAX_FUN_FACTS_SHOWN})`);
  const svenNameErrors = facts.filter((f) => /\bYou\b|\byou\b/.test(`${f.title} ${f.body}`) && !/your/.test(""));
  // Third person should not say You
  const leakedYou = facts.filter((f) => /\bYou\b/.test(f.title) || /\bYou\b/.test(f.body));
  if (leakedYou.length) fail(`Third-person facts leaked "You": ${leakedYou.map((f) => f.id).join(", ")}`);
  else ok("Sven facts stay in third person");

  const signatureIds = facts.filter((f) => ["favorite-slot", "peak-hour", "favorite-weekday", "night-count", "weekend-count", "named-holiday", "streak", "rank-champion"].includes(f.id));
  const comparisonIds = facts.filter((f) => ["total-km-pitches", "total-km-track", "total-km-walk", "total-hours-films", "total-hours-sleep", "total-hours-workweeks"].includes(f.id));
  if (signatureIds.length < 2) fail(`Other-volunteer facts should lead with signature habits, got ${facts.map((f) => f.id).join(", ")}`);
  else ok(`Sven profile leads with signature facts (${signatureIds.map((f) => f.id).join(", ") || "none"})`);
  if (comparisonIds.length > 3) fail(`Other-volunteer profile still stacked generic comparisons: ${comparisonIds.map((f) => f.id).join(", ")}`);
  else ok("Sven profile is not a stack of the same distance/hour metaphors");

  const factsAlex = buildLeaderboardFunFacts({
    patrols: svenLogs,
    routeRows: svenRoutes,
    stats: svenStats,
    isSelf: false,
    subjectName: "Alex",
    subjectId: "volunteer-alex",
    now: new Date("2026-08-18T12:00:00"),
  });
  const factsSvenSameDay = buildLeaderboardFunFacts({
    patrols: svenLogs,
    routeRows: svenRoutes,
    stats: svenStats,
    isSelf: false,
    subjectName: "Sven",
    subjectId: "volunteer-sven",
    now: new Date("2026-08-18T12:00:00"),
  });
  const factsSvenNextWindow = buildLeaderboardFunFacts({
    patrols: svenLogs,
    routeRows: svenRoutes,
    stats: svenStats,
    isSelf: false,
    subjectName: "Sven",
    subjectId: "volunteer-sven",
    now: new Date("2026-08-20T12:00:00"),
  });
  const ids = (list) => list.map((f) => f.id).join("|");
  if (ids(factsAlex) === ids(factsSvenSameDay)) {
    fail("Two volunteers with the same stats should not show the identical Did-you-know set");
  } else {
    ok("Different volunteers get different Did-you-know cards from the same stat shape");
  }
  if (ids(factsSvenSameDay) === ids(factsSvenNextWindow)) {
    fail("Did-you-know set should rotate after two days");
  } else {
    ok("Did-you-know cards rotate on a two-day window");
  }

  const weatherFacts = buildLeaderboardFunFacts({
    patrols: svenLogs,
    routeRows: svenRoutes,
    stats: svenStats,
    isSelf: true,
    subjectId: "sven-weather",
    now: new Date("2026-08-18T12:00:00"),
    weather: {
      matched: 80,
      rainyNight: 9,
      foggyNight: 4,
      foggyMorning: 3,
      storm: 2,
      hot: 5,
      hotNight: 1,
      coldNight: 3,
      drizzleMorning: 2,
      wetWeekend: 4,
      hottestC: 33,
      coldestC: 8,
    },
    weatherNow: {
      rainyNightNow: false,
      foggyNightNow: true,
      foggyMorningNow: false,
      heatNow: false,
      stormNow: false,
      temperatureC: 14,
      label: "Fog",
    },
  });
  const weatherIds = weatherFacts.filter((f) => f.group === "weather").map((f) => f.id);
  if (!weatherIds.includes("weather-now-fog")) {
    fail(`Foggy-night-now should surface, got: ${weatherFacts.map((f) => f.id).join(", ")}`);
  } else if (weatherIds.length < 2) {
    fail(`Expected live weather plus a historic condition, got ${weatherIds.join(", ") || "none"}`);
  } else {
    ok(`Weather cards shown: ${weatherIds.join(", ")}`);
  }
  const heatFact = FUN_FACT_TEMPLATES.find((t) => t.id === "melting-heat");
  const rainFact = FUN_FACT_TEMPLATES.find((t) => t.id === "rainy-nights");
  if (!heatFact || !rainFact) fail("Missing melting-heat or rainy-nights templates");
  else ok("Rainy night, fog, and heat templates are in the Did-you-know library");

  const mileageFacts = buildLeaderboardFunFacts({
    patrols: svenLogs,
    routeRows: svenRoutes,
    stats: svenStats,
    isSelf: false,
    subjectName: "Sven",
    subjectId: "sven-mileage",
    now: new Date("2026-08-18T12:00:00"),
  });
  const mileageIds = mileageFacts.filter((f) => f.group === "mileage").map((f) => f.id);
  if (!mileageIds.length) {
    fail(`Route mileage should surface loop facts, got: ${mileageFacts.map((f) => f.id).join(", ")}`);
  } else {
    ok(`Mileage cards shown: ${mileageIds.join(", ")}`);
  }
  if (!FUN_FACT_TEMPLATES.some((t) => t.id === "typical-loop") || !FUN_FACT_TEMPLATES.some((t) => t.id === "km-this-week")) {
    fail("Missing typical-loop or km-this-week mileage templates");
  }

  const smallLandmarks = facts.filter((f) => ["landmark-walmer", "landmark-summerstrand"].includes(f.id));
  if (smallLandmarks.length) fail(`High-km volunteer should not show tiny landmarks: ${smallLandmarks.map((f) => f.id).join(", ")}`);
  else ok("Sven-scale landmark is the largest matching road, not Theescombe–Walmer");

  const matchingTemplates = FUN_FACT_TEMPLATES.filter((t) => {
    try {
      return t.when({
        stats: svenStats,
        isSelf: false,
        v: { who: "Sven", were: "was", they: "Sven", have: "has", are: "is" },
        yKm: 0,
        lastKm: 12,
        yMins: 0,
        totalKm: svenStats.routeStats.totalDistance,
        longestRouteKm: svenStats.routeStats.longestRouteKm,
        routeHours: svenStats.routeStats.totalDuration / 3600,
        avgRouteKmh: 10,
        totalMinutes: svenStats.totalMinutes,
        hoursLabel: "x",
        totalPatrols: svenStats.totalPatrols,
        streak: svenStats.currentStreak,
        nightCount: svenStats.timeDistribution.night,
        weekendCount: svenStats.weekendPatrols,
      });
    } catch {
      return false;
    }
  });
  ok(`${matchingTemplates.length} templates match Sven-scale data (library is ${FUN_FACT_TEMPLATE_COUNT})`);
}

const bannedPhrases = [
  "hadeda would rather walk",
  "tortoise would still be",
  "Theescombe to Summerstrand and back",
  "Addo — or Jeffreys Bay",
];
const allFactText = FUN_FACT_TEMPLATES.map((t) => String(t.build).toLowerCase()).join("\n");
for (const phrase of bannedPhrases) {
  if (allFactText.includes(phrase.toLowerCase())) fail(`Removed/hallucinated phrasing still present: "${phrase}"`);
}
ok("Old unverified phrases are gone (Addo lumped with JBay, unverified round-trip, joke tortoise timing)");

if (issues.length) {
  console.error(`\nAUDIT FAILED: ${issues.length} issue(s)`);
  process.exit(1);
}
console.log("\nAUDIT PASSED");
