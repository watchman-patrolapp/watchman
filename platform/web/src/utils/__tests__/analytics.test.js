import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANALYTICS_MAX_DAYS,
  analyticsBounds,
  analyticsRpcArgs,
  bucketKeys,
  bucketStart,
  daysInRange,
  defaultGrainForDays,
  fillBuckets,
  formatDelta,
  formatSeconds,
  previousPeriod,
  rangeForAnalyticsPreset,
} from "../analytics.js";

// 21 Nov 2026 23:30 SAST is already 22 Nov in SAST but 21 Nov in UTC.
const NOW = new Date("2026-11-21T22:30:00Z");

test("presets end today in SAST and count days inclusively", () => {
  assert.deepEqual(rangeForAnalyticsPreset("7d", NOW), { preset: "7d", from: "2026-11-16", to: "2026-11-22" });
  assert.deepEqual(rangeForAnalyticsPreset("30d", NOW), { preset: "30d", from: "2026-10-24", to: "2026-11-22" });
  assert.equal(daysInRange(...Object.values(rangeForAnalyticsPreset("90d", NOW)).slice(1)), 90);
  assert.equal(daysInRange(...Object.values(rangeForAnalyticsPreset("12m", NOW)).slice(1)), 365);
  assert.equal(rangeForAnalyticsPreset("bogus", NOW).preset, "30d");
});

test("bounds use SAST midnights with an exclusive end, swap reversed dates and cap at 24 months", () => {
  assert.deepEqual(analyticsBounds({ from: "2026-11-01", to: "2026-11-20" }), {
    ok: true,
    from: "2026-10-31T22:00:00.000Z",
    to: "2026-11-20T22:00:00.000Z",
    days: 20,
  });
  assert.equal(analyticsBounds({ from: "2026-11-20", to: "2026-11-01" }).days, 20);
  assert.equal(analyticsBounds({ from: "2024-11-22", to: "2026-11-21" }).days, ANALYTICS_MAX_DAYS - 1);
  assert.deepEqual(analyticsBounds({ from: "2024-01-01", to: "2026-11-21" }), {
    ok: false,
    error: "Pick a date range of 24 months or less.",
  });
  assert.equal(analyticsBounds({ from: "", to: "2026-11-21" }).ok, false);
  assert.equal(analyticsBounds(null).error, "Pick a start and end date.");
});

test("previous period has the same length and ends where the current starts", () => {
  assert.deepEqual(previousPeriod("2026-10-31T22:00:00.000Z", "2026-11-20T22:00:00.000Z"), {
    from: "2026-10-11T22:00:00.000Z",
    to: "2026-10-31T22:00:00.000Z",
  });
  assert.equal(previousPeriod("2026-11-02T00:00:00Z", "2026-11-01T00:00:00Z"), null);
  assert.equal(previousPeriod("nope", "2026-11-01T00:00:00Z"), null);
});

test("grain defaults by window length", () => {
  assert.equal(defaultGrainForDays(7), "day");
  assert.equal(defaultGrainForDays(31), "day");
  assert.equal(defaultGrainForDays(90), "week");
  assert.equal(defaultGrainForDays(365), "month");
  assert.equal(defaultGrainForDays(NaN), "day");
});

test("buckets match Postgres date_trunc (Monday weeks, 1st of month)", () => {
  assert.equal(bucketStart("2026-11-22", "week"), "2026-11-16"); // Sunday -> Monday before
  assert.equal(bucketStart("2026-11-16", "week"), "2026-11-16");
  assert.equal(bucketStart("2026-11-22", "month"), "2026-11-01");
  assert.deepEqual(bucketKeys("2026-11-01", "2026-11-20", "week"), ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]);
  assert.equal(bucketKeys("2026-11-01", "2026-11-20", "day").length, 20);
  assert.deepEqual(bucketKeys("2025-11-15", "2026-02-03", "month"), ["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
  assert.deepEqual(bucketKeys("2026-11-01", "2026-11-20", "year"), []);
  assert.deepEqual(bucketKeys("2026-11-20", "2026-11-01", "day"), []);
});

test("fillBuckets fills gaps and bad values with 0, in key order", () => {
  const keys = ["2026-11-02", "2026-11-09", "2026-11-16"];
  const series = [
    { bucket: "2026-11-16", patrols: 4, patrol_hours: "7.5" },
    { bucket: "2026-11-02", patrols: null, patrol_hours: "x" },
  ];
  assert.deepEqual(fillBuckets(series, keys, ["patrols", "patrol_hours"]), [
    { bucket: "2026-11-02", patrols: 0, patrol_hours: 0 },
    { bucket: "2026-11-09", patrols: 0, patrol_hours: 0 },
    { bucket: "2026-11-16", patrols: 4, patrol_hours: 7.5 },
  ]);
  assert.deepEqual(fillBuckets(null, ["2026-11-02"], ["sos_alerts"]), [{ bucket: "2026-11-02", sos_alerts: 0 }]);
});

test("formatDelta: percent, points, absolute, good/bad direction", () => {
  assert.deepEqual(formatDelta(1946, 1795), { text: "+8.4%", direction: "up", good: true });
  assert.deepEqual(formatDelta(268, 302, { higherIsBetter: false }), { text: "−11.3%", direction: "down", good: true });
  assert.deepEqual(formatDelta(64, 67, { mode: "points", digits: 0 }), { text: "−3 pts", direction: "down", good: false });
  assert.deepEqual(formatDelta(14, 12, { mode: "absolute", digits: 0 }), { text: "+2", direction: "up", good: true });
  assert.deepEqual(formatDelta(5, 0), { text: "New", direction: "up", good: true });
  assert.deepEqual(formatDelta(0, 0), { text: "0%", direction: "flat", good: null });
  assert.deepEqual(formatDelta(10, 10), { text: "0%", direction: "flat", good: null });
  assert.deepEqual(formatDelta(null, 3), { text: "—", direction: "none", good: null });
  assert.equal(formatDelta(12500, 10000).text, "+25%");
});

test("formatSeconds", () => {
  assert.equal(formatSeconds(45), "45s");
  assert.equal(formatSeconds(160), "2m 40s");
  assert.equal(formatSeconds(240), "4m");
  assert.equal(formatSeconds(3900), "1h 05m");
  assert.equal(formatSeconds(null), "—");
  assert.equal(formatSeconds(-1), "—");
});

test("RPC args: empty filters become null, grain falls back to week", () => {
  assert.deepEqual(analyticsRpcArgs({ from: "a", to: "b", cityIds: [], suburbIds: ["s1", ""], orgIds: undefined, grain: "year" }), {
    p_from: "a",
    p_to: "b",
    p_city_ids: null,
    p_suburb_ids: ["s1"],
    p_org_ids: null,
    p_grain: "week",
  });
  assert.equal(analyticsRpcArgs().p_from, null);
});
