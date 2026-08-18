/**
 * Ballpark patrol-fuel estimates. Run from platform/web:
 *   node scripts/audit-patrol-fuel.mjs
 */
import {
  DEFAULT_PETROL_ZAR_PER_LITRE,
  estimateManualFuel,
  estimatePatrolFuel,
  formatApproxRand,
  resolveFuelProfile,
} from "../src/utils/patrolFuelEstimate.js";
import { summarizeGpsMileage } from "../src/utils/patrolHistoryRoute.js";

const issues = [];
function fail(msg) {
  issues.push(msg);
  console.error(`FAIL: ${msg}`);
}
function ok(msg) {
  console.log(`OK   ${msg}`);
}

const corolla = resolveFuelProfile("car", "Toyota Corolla");
if (corolla.id !== "compact") fail(`Corolla should be compact, got ${corolla.id}`);
else ok(`Corolla → ${corolla.label} (~${corolla.lPer100Patrol} L/100 km on patrol)`);

const hilux = resolveFuelProfile("car", "Hilux");
if (hilux.id !== "bakkie") fail(`Hilux should be bakkie, got ${hilux.id}`);
else ok(`Hilux → ${hilux.label}`);

const rangerover = resolveFuelProfile("car", "Range Rover");
if (rangerover.id === "bakkie") fail("Range Rover must not match Ford Ranger");
else ok(`Range Rover → ${rangerover.label}`);

const foot = resolveFuelProfile("on_foot", "On foot");
if (foot.kind !== "none") fail("On foot should have no petrol");
else ok("On foot / bicycle / golf cart are not billed as petrol");

const gps = estimatePatrolFuel({
  vehicleType: "car",
  makeModel: "Toyota Corolla",
  gpsKm: 100,
  totalMinutes: 400,
  totalPatrols: 10,
  routeCount: 10,
  priceZarPerLitre: 22.5,
});
if (gps.kmSource !== "gps") fail("100 km GPS should use GPS kilometres");
if (!(gps.rand > 100 && gps.rand < 400)) fail(`Unexpected Rand for 100 km Corolla: ${gps.rand}`);
else ok(`100 km Corolla at R22.50/L → ${formatApproxRand(gps.rand)} (${gps.litres.toFixed(1)} L)`);

const noGps = estimatePatrolFuel({
  vehicleType: "car",
  makeModel: "Toyota Corolla",
  gpsKm: 0,
  totalMinutes: 120,
  totalPatrols: 2,
  routeCount: 0,
  priceZarPerLitre: DEFAULT_PETROL_ZAR_PER_LITRE,
});
if (noGps.kmSource !== "none" || noGps.rand !== 0) fail("No GPS should not invent kilometres from patrol time");
else ok("No GPS → no petrol estimate (GPS only)");

const thinGps = estimatePatrolFuel({
  vehicleType: "car",
  makeModel: "Suzuki Baleno",
  gpsKm: 0.8,
  totalMinutes: 120,
  totalPatrols: 1,
  routeCount: 1,
  priceZarPerLitre: 22.5,
});
if (thinGps.kmSource !== "gps") fail("0.8 km GPS should still count as GPS, not a time guess");
else ok("Short GPS loops still use GPS kilometres");

const geojsonKm = summarizeGpsMileage(
  [{ start_time: "2026-08-18T18:00:00", end_time: "2026-08-18T19:00:00", duration_minutes: 60 }],
  [{
    created_at: "2026-08-18T19:02:00",
    total_distance_km: 0,
    route_geojson: {
      type: "LineString",
      coordinates: [
        [25.55, -33.98],
        [25.56, -33.98],
        [25.57, -33.985],
      ],
    },
  }],
);
if (!(geojsonKm.km > 1 && geojsonKm.tracks === 1)) {
  fail(`GeoJSON-only route should yield GPS km, got ${geojsonKm.km} km / ${geojsonKm.tracks} tracks`);
} else {
  ok(`GeoJSON-only track (stored km 0) → ${geojsonKm.km.toFixed(1)} km GPS`);
}

    const fromPts = summarizeGpsMileage(
      [{ start_time: "2026-08-18T18:00:00", end_time: "2026-08-18T19:00:00", duration_minutes: 60 }],
      [],
      null,
      [
        { latitude: -33.98, longitude: 25.55, timestamp: "2026-08-18T18:10:00" },
        { latitude: -33.98, longitude: 25.58, timestamp: "2026-08-18T18:40:00" },
      ],
    );
    if (!(fromPts.km > 1 && fromPts.tracks === 1)) {
      fail(`patrol_locations points should yield GPS km, got ${fromPts.km} km / ${fromPts.tracks} tracks`);
    } else {
      ok(`Live GPS points → ${fromPts.km.toFixed(1)} km`);
    }

    const weekStart = new Date("2026-08-17T00:00:00");
    const weekOnly = summarizeGpsMileage(
      [
        { start_time: "2026-08-10T18:00:00", end_time: "2026-08-10T19:00:00", duration_minutes: 60 },
        { start_time: "2026-08-18T18:00:00", end_time: "2026-08-18T19:00:00", duration_minutes: 60 },
      ],
      [],
      weekStart,
      [
        { latitude: -33.98, longitude: 25.55, timestamp: "2026-08-10T18:10:00" },
        { latitude: -33.98, longitude: 25.62, timestamp: "2026-08-10T18:40:00" },
        { latitude: -33.98, longitude: 25.55, timestamp: "2026-08-18T18:10:00" },
        { latitude: -33.98, longitude: 25.56, timestamp: "2026-08-18T18:40:00" },
      ],
    );
    if (weekOnly.patrols !== 1) fail(`Week filter should keep 1 patrol, got ${weekOnly.patrols}`);
    if (!(weekOnly.km < fromPts.km * 2 && weekOnly.km > 0.3)) {
      fail(`Week GPS should ignore last week's long loop, got ${weekOnly.km} km`);
    } else {
      ok(`This-week tab uses only that window's GPS (${weekOnly.km.toFixed(1)} km)`);
    }

    const prefersLongerTrack = summarizeGpsMileage(
      [{ start_time: "2026-08-18T18:00:00", end_time: "2026-08-18T19:00:00", duration_minutes: 60 }],
      [{ created_at: "2026-08-18T19:02:00", total_distance_km: 0.4 }],
      null,
      [
        { latitude: -33.98, longitude: 25.55, timestamp: "2026-08-18T18:10:00" },
        { latitude: -33.98, longitude: 25.58, timestamp: "2026-08-18T18:40:00" },
      ],
    );
    if (prefersLongerTrack.km < 2) {
      fail(`Should use the longer GPS track over a 0.4 km stored total, got ${prefersLongerTrack.km} km`);
    } else {
      ok(`Uses the longer of stored route vs live GPS (${prefersLongerTrack.km.toFixed(1)} km)`);
    }

    const unmatchedRoute = summarizeGpsMileage(
      [{ start_time: "2026-08-18T18:00:00", end_time: "2026-08-18T19:00:00", duration_minutes: 60 }],
      [{ created_at: "2026-08-18T22:00:00", total_distance_km: 11.2 }],
      null,
      [],
    );
    if (!(unmatchedRoute.km >= 11)) {
      fail(`Unmatched saved route should still count, got ${unmatchedRoute.km} km`);
    } else {
      ok("Saved GPS routes still count when they are not matched to a log window");
    }

    const manual = estimateManualFuel({ km: 100, lPer100: 8, priceZarPerLitre: 22.5 });
    if (Math.abs(manual.litres - 8) > 0.05 || Math.abs(manual.rand - 180) > 1) {
      fail(`Manual 100 km × 8 L/100 × R22.50 should be 8 L / R180, got ${manual.litres} L / R${manual.rand}`);
    } else {
      ok("Manual calculator: 100 km × 8 L/100 km × R22.50/L → 8 L / R180");
    }

    if (issues.length) {
  console.error(`\nAUDIT FAILED: ${issues.length} issue(s)`);
  process.exit(1);
}
console.log("\nAUDIT PASSED");
