import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyticsRequest,
  analyticsSearchString,
  buildKpis,
  buildNeedsAttention,
  cityIdsInUse,
  formatAgo,
  formatBucketLabel,
  formatCount,
  formatMinutes,
  narrowFilterOptions,
  parseAnalyticsSearch,
  roleRows,
  roleSummary,
  seriesRows,
  sortWatches,
  versionRows,
} from "../analyticsView.js";

const NOW = new Date("2026-11-22T10:00:00Z");
const CITY = "c0000000-0000-0000-0000-000000000001";
const ORG = "0a000000-0000-0000-0000-000000000002";

const OVERVIEW = {
  current: {
    patrols: 812, patrol_hours: 1946, avg_patrol_minutes: 144, active_watches: 14, distance_km: 18420,
    share_rate_start: 64, share_rate_end: 51, incidents: 268, incidents_approved: 231, incidents_pending: 19,
    sos_alerts: 37, sos_acknowledged: 35, sos_ack_median_seconds: 160, signups: 214,
    signups_by_role: { resident: 168, patroller: 46 },
  },
  previous: { patrols: 770, patrol_hours: 1795, active_watches: 12, distance_km: 17426, share_rate_start: 67, incidents: 302, sos_alerts: 41, signups: 191 },
  watches: { total: 16, active: 14, pending: 2, suspended: 0 },
  members_total: 3482,
  members_by_role: { resident: 2800, user: 111, patroller: 571 },
  terms: { latest_version: "2026-11-21", on_latest: 3183 },
  app_versions: { min_supported_version_code: 0, versions: [{ code: 12, name: "1.0.10", devices: 1062 }, { code: 13, name: "1.0.11", devices: 1184 }] },
  series: [{ bucket: "2026-11-16", patrols: "4", patrol_hours: 7.5 }],
};

test("URL state: defaults, custom ranges, ids and round trip", () => {
  const d = parseAnalyticsSearch("", NOW);
  assert.equal(d.tab, "overview"); assert.equal(d.preset, "30d"); assert.equal(d.to, "2026-11-22"); assert.equal(d.from, "2026-10-24");
  assert.equal(d.grain, "day"); assert.equal(d.grainIsDefault, true); assert.equal(d.cityId, "");
  const c = parseAnalyticsSearch(`tab=watches&range=custom&from=2026-11-20&to=2026-01-01&grain=month&city=${CITY}&watch=not-a-uuid`, NOW);
  assert.deepEqual([c.tab, c.preset, c.from, c.to, c.grain, c.grainIsDefault, c.cityId, c.orgId], ["watches", "custom", "2026-01-01", "2026-11-20", "month", false, CITY, ""]);
  assert.equal(parseAnalyticsSearch("range=custom&from=bad", NOW).preset, "30d");
  assert.equal(parseAnalyticsSearch("range=12m", NOW).grain, "month");
  assert.equal(parseAnalyticsSearch("tab=nope", NOW).tab, "overview");
  assert.equal(analyticsSearchString(d), "");
  const s = analyticsSearchString(c, { orgId: ORG });
  assert.equal(s, `tab=watches&range=custom&from=2026-01-01&to=2026-11-20&grain=month&city=${CITY}&watch=${ORG}`);
  assert.deepEqual(parseAnalyticsSearch(s, NOW).orgId, ORG);
});

test("analyticsRequest builds RPC args and reports range errors", () => {
  const r = analyticsRequest(parseAnalyticsSearch(`city=${CITY}`, NOW));
  assert.equal(r.ok, true); assert.deepEqual(r.args.p_city_ids, [CITY]); assert.equal(r.args.p_org_ids, null);
  assert.equal(r.args.p_from, "2026-10-23T22:00:00.000Z"); assert.equal(r.args.p_grain, "day");
  assert.deepEqual(analyticsRequest({ from: "2023-01-01", to: "2026-11-22" }), { ok: false, error: "Pick a date range of 24 months or less." });
});

test("number formatting", () => {
  assert.equal(formatCount(3482), "3,482"); assert.equal(formatCount(1946.0, 1), "1,946"); assert.equal(formatCount(7.5, 1), "7.5");
  assert.equal(formatCount(18420.04, 1), "18,420"); assert.equal(formatCount(null), "—"); assert.equal(formatCount(-1200), "−1,200");
  assert.equal(formatMinutes(144), "2h 24m"); assert.equal(formatMinutes(45), "45m"); assert.equal(formatMinutes(120), "2h"); assert.equal(formatMinutes(0), "—");
});

test("roles and versions", () => {
  assert.deepEqual(roleRows({ resident: 2800, user: 111, patroller: 571, admin: 0 }), [{ name: "Residents", value: 2911 }, { name: "Patrollers", value: 571 }]);
  assert.equal(roleSummary({ resident: 2911, patroller: 571 }), "2,911 residents · 571 patrollers");
  assert.equal(roleSummary({}), "No members yet");
  assert.deepEqual(versionRows(OVERVIEW.app_versions).map((v) => v.name), ["1.0.11 (13)", "1.0.10 (12)"]);
  assert.deepEqual(versionRows({ versions: [{ code: 14, name: null, devices: 2 }, { code: 9, devices: 0 }] }), [{ code: 14, name: "Build 14", value: 2 }]);
  assert.deepEqual(versionRows(null), []);
});

test("KPI cards", () => {
  const k = buildKpis(OVERVIEW);
  assert.equal(k.length, 8);
  const by = Object.fromEntries(k.map((x) => [x.key, x]));
  assert.equal(by.watches.value, "14"); assert.equal(by.watches.delta.text, "+2"); assert.equal(by.watches.sub, "patrolled · of 16 watches");
  assert.equal(by.members.value, "3,482"); assert.equal(by.members.delta.text, "+214 new"); assert.equal(by.members.sub, "2,911 residents · 571 patrollers");
  assert.equal(by.hours.value, "1,946 h"); assert.equal(by.hours.delta.text, "+8.4%"); assert.equal(by.hours.sub, "812 patrols · avg 2h 24m");
  assert.equal(by.incidents.delta.text, "−11.3%"); assert.equal(by.incidents.delta.good, true);
  assert.equal(by.sos.delta.text, "−4"); assert.equal(by.sos.delta.good, true); assert.equal(by.sos.sub, "median acknowledge 2m 40s");
  assert.equal(by.signups.sub, "168 residents · 46 patrollers");
  assert.equal(by.share.value, "64%"); assert.equal(by.share.delta.text, "−3 pts"); assert.equal(by.share.delta.good, false);
  assert.deepEqual(buildKpis(null), []);
  const empty = buildKpis({ current: {}, previous: {} });
  assert.equal(empty.find((x) => x.key === "share").value, "—");
});

test("needs attention items", () => {
  const items = buildNeedsAttention(OVERVIEW);
  assert.deepEqual(items.map((i) => i.key), ["sos", "pending", "share", "versions", "terms"]);
  assert.equal(items[0].title, "2 SOS alerts never acknowledged");
  assert.equal(items[1].title, "19 incidents waiting for approval");
  assert.equal(items[2].title, "WhatsApp share rate down 3 pts");
  assert.equal(items[3].title, "47% of Android devices aren't on 1.0.11 (13)");
  assert.equal(items[4].title, "299 members haven't accepted the current terms");
  assert.deepEqual(buildNeedsAttention({ current: { incidents_pending: 1 }, members_total: 1, terms: { latest_version: "v", on_latest: 0 } }).map((i) => i.title), [
    "1 incident waiting for approval",
    "1 member hasn't accepted the current terms",
  ]);
  assert.deepEqual(buildNeedsAttention({ current: {} }), []);
});

test("series rows, bucket labels", () => {
  assert.deepEqual(seriesRows(OVERVIEW)[0], { bucket: "2026-11-16", patrols: 4, patrol_hours: 7.5, distance_km: 0, incidents: 0, sos_alerts: 0, signups: 0 });
  assert.equal(formatBucketLabel("2026-11-02", "week"), "2 Nov");
  assert.equal(formatBucketLabel("2026-11-01", "month"), "Nov 2026");
  assert.equal(formatBucketLabel("x", "day"), "");
});

test("watch sorting and last activity", () => {
  const rows = [
    { watch_name: "B", patrol_hours: "3", previous_patrol_hours: "1", last_activity_at: null },
    { watch_name: "A", patrol_hours: "3.5", previous_patrol_hours: "0", last_activity_at: "2026-11-22T09:48:00Z" },
    { watch_name: "C", patrol_hours: "0", previous_patrol_hours: "0", last_activity_at: "2026-11-20T10:00:00Z" },
  ];
  assert.deepEqual(sortWatches(rows).map((r) => r.watch_name), ["A", "B", "C"]);
  assert.deepEqual(sortWatches(rows, "watch_name", "asc").map((r) => r.watch_name), ["A", "B", "C"]);
  assert.deepEqual(sortWatches(rows, "last_activity_at", "desc").map((r) => r.watch_name), ["A", "C", "B"]);
  assert.deepEqual(sortWatches(rows, "delta", "desc").map((r) => r.watch_name), ["A", "B", "C"]);
  const now = NOW.getTime();
  assert.equal(formatAgo("2026-11-22T09:48:00Z", now), "12 min ago");
  assert.equal(formatAgo("2026-11-22T07:00:00Z", now), "3 h ago");
  assert.equal(formatAgo("2026-11-20T10:00:00Z", now), "2 d ago");
  assert.equal(formatAgo("2026-01-01T10:00:00Z", now), "1 Jan 2026");
  assert.equal(formatAgo(null, now), "—");
});

test("filter options narrow by city and suburb", () => {
  const suburbs = [{ id: "s1", city_id: "jhb" }, { id: "s2", city_id: "jhb" }, { id: "s3", city_id: "cpt" }];
  const watches = [
    { id: "w1", city_id: null, primary_suburb_id: "s1" },
    { id: "w2", city_id: "jhb", primary_suburb_id: null },
    { id: "w3", city_id: null, primary_suburb_id: null },
  ];
  const orgSuburbs = [{ organization_id: "w2", suburb_id: "s2" }, { organization_id: "w3", suburb_id: "s3" }];
  const jhb = narrowFilterOptions({ suburbs, watches, orgSuburbs }, { cityId: "jhb" });
  assert.deepEqual(jhb.suburbs.map((s) => s.id), ["s1", "s2"]);
  assert.deepEqual(jhb.watches.map((w) => w.id), ["w1", "w2"]);
  assert.deepEqual(narrowFilterOptions({ suburbs, watches, orgSuburbs }, { suburbId: "s3" }).watches.map((w) => w.id), ["w3"]);
  assert.equal(narrowFilterOptions({ suburbs, watches }, {}).watches.length, 3);
});

test("phase 3 helpers: heat grid, rand, labels, durations, count rows", async () => {
  const { heatMatrix, formatRand, labelize, formatDuration, countRows, percent, hourLabel } = await import("../analyticsView.js");
  const h = heatMatrix([{ dow: 0, hour: 18, patrols: 3, hours: 6 }, { dow: 6, hour: 2, patrols: "5", hours: 4 }, { dow: 9, hour: 1, patrols: 99 }]);
  assert.equal(h.grid.length, 7); assert.equal(h.grid[0].length, 24);
  assert.deepEqual(h.grid[0][18], { patrols: 3, hours: 6 });
  assert.equal(h.max, 5); assert.deepEqual(h.busiest, { dow: 6, hour: 2, patrols: 5 });
  assert.equal(heatMatrix(null).max, 0);
  assert.equal(hourLabel(7), "07:00");
  assert.equal(formatRand(40000), "R 400"); assert.equal(formatRand(123450), "R 1,234.50"); assert.equal(formatRand(-500), "−R 5"); assert.equal(formatRand(null), "—");
  assert.equal(labelize("contribute_cost"), "Contribute cost"); assert.equal(labelize("false_info"), "False info");
  assert.equal(labelize("Suspicious person"), "Suspicious person"); assert.equal(labelize(""), "Unknown"); assert.equal(labelize("sos_alert"), "SOS alert");
  assert.equal(formatDuration(45), "45s"); assert.equal(formatDuration(7200), "2h 00m"); assert.equal(formatDuration(3 * 86400 + 4 * 3600), "3 d 4 h"); assert.equal(formatDuration(null), "—");
  assert.deepEqual(countRows([{ s: "open", n: 1 }, { s: "actioned", n: 3 }, { s: "x", n: 0 }], "s", "n"), [{ name: "Actioned", value: 3 }, { name: "Open", value: 1 }]);
  assert.equal(percent(1, 3), 33.3); assert.equal(percent(1, 0), null);
});

test("distance KPI explains where kilometres come from", () => {
  const k = buildKpis({ ...OVERVIEW, current: { ...OVERVIEW.current, distance_tracked_patrols: 120 } });
  assert.equal(k.find((x) => x.key === "distance").sub, "GPS-tracked on 120 of 812 patrols");
  assert.equal(buildKpis(OVERVIEW).find((x) => x.key === "distance").sub, "from routes and GPS tracks");
});

test("role group and month labels", async () => {
  const { roleGroupLabel, monthLabel, ANALYTICS_TABS } = await import("../analyticsView.js");
  assert.equal(roleGroupLabel("resident"), "Residents");
  assert.equal(roleGroupLabel("watch_admin"), "Watch admins");
  assert.equal(roleGroupLabel("unknown"), "Not recorded");
  assert.equal(monthLabel("2026-09"), "Sep 2026");
  assert.equal(monthLabel("bad"), "bad");
  assert.deepEqual(ANALYTICS_TABS.map((t) => t.id), ["overview", "patrols", "safety", "people", "residents", "community", "security", "watches"]);
});

test("cityIdsInUse keeps only cities that have a suburb or a watch", () => {
  const suburbs = [{ id: "s1", city_id: "gq" }, { id: "s2", city_id: "gq" }, { id: "s3", city_id: null }];
  const watches = [{ id: "w1", city_id: "ct" }, { id: "w2", city_id: null }, { id: "w3", city_id: "gq" }];
  assert.deepEqual(cityIdsInUse({ suburbs, watches }), ["ct", "gq"]);
  assert.deepEqual(cityIdsInUse({}), []);
  assert.deepEqual(cityIdsInUse({ suburbs: [null], watches: undefined }), []);
});
