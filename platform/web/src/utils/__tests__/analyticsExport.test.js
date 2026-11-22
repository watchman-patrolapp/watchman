import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell, exportFileName, sectionsToCsv, tabExportSections } from "../analyticsExport.js";

test("CSV cells are escaped and formula-safe", () => {
  assert.equal(csvCell(12.5), "12.5");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell('He said "hi", then left'), '"He said ""hi"", then left"');
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("-1+1"), "'-1+1");
  assert.equal(csvCell(-3), "-3");
});

test("sections become one CSV with a header block", () => {
  const csv = sectionsToCsv([["Report", "Platform analytics"], ["Range", "2026-11-01 to 2026-11-21"]], [
    { title: "Empty", columns: [{ key: "a", label: "A" }], rows: [] },
    { title: "Rows", columns: [{ key: "a", label: "A" }, { key: "b", label: "B" }], rows: [{ a: "x", b: 1 }, { a: "y,z", b: null }] },
  ]);
  assert.ok(csv.startsWith("\uFEFFReport,Platform analytics\r\nRange,2026-11-01 to 2026-11-21\r\n"));
  assert.ok(!csv.includes("Empty"));
  assert.ok(csv.endsWith('\r\nRows\r\nA,B\r\nx,1\r\n"y,z",\r\n'));
});

test("every tab exports its own sections plus the watch table", () => {
  const overview = { range: { grain: "week" }, current: { patrols: 4, patrol_hours: 7.5, distance_km: 40.3 }, series: [{ bucket: "2026-11-02", patrols: 2 }], members_by_role: { resident: 2 } };
  const watches = [{ watch_name: "Theescombe", patrol_hours: "5.5", members: "10" }];
  const patrols = { heat: [{ dow: 0, hour: 18, patrols: 1, hours: 2 }], top_patrollers: [{ name: "Pat P.", hours: 5.5, patrols: 4 }], vehicles: [{ vehicle: "car", patrols: 2 }], distance: { km: 40.3, tracked_patrols: 5 } };
  const titles = (tab, section) => tabExportSections(tab, { overview, watches, section }).map((s) => s.title);
  assert.deepEqual(titles("overview"), ["Summary", "Over time", "Watches"]);
  assert.deepEqual(titles("patrols", patrols), ["Patrol summary", "Over time", "Busiest times", "Coverage by suburb", "Top patrollers", "Vehicles", "Watches"]);
  assert.deepEqual(titles("safety", null).at(-1), "Watches");
  assert.deepEqual(titles("watches"), ["Watches"]);
  const p = tabExportSections("patrols", { overview, watches, section: patrols });
  assert.deepEqual(p[2].rows[0], { day: "Mon", hour: "18:00", patrols: 1, hours: 2 });
  assert.equal(p.at(-1).rows[0].patrol_hours, 5.5);
  const community = tabExportSections("community", { overview, watches, section: { ledger: { raised_cents: 40000, spent_cents: 30000 } } });
  assert.deepEqual(community[0].rows.find((r) => r.metric === "Rand raised"), { metric: "Rand raised", value: 400 });
});

test("export file names are safe", () => {
  assert.equal(exportFileName("patrols", "2026-11-01", "2026-11-21", "csv"), "watchman-analytics-patrols-2026-11-01-to-2026-11-21.csv");
  assert.equal(exportFileName("../x", "a/b", "c", "csv"), "watchman-analytics-x-ab-to-c.csv");
});

test("residents and security tabs export their sections", () => {
  const residents = {
    active: { tracking_since: "2026-11-05", as_of: "2026-11-20", dau: { residents: 1, patrollers: 1 }, series: [{ bucket: "2026-11-02", residents: 2, patrollers: 1, members: 4 }] },
    reports: { by_role: [{ role: "resident", incidents: 1, sos: 2 }, { role: "unknown", incidents: 3, sos: 0 }] },
    suburbs: { rows: [{ suburb: "Melville", residents: 6, patrols: 0, hours: 0, under_covered: true }] },
    retention: { cohorts: [{ month: "2026-09", group: "resident", joined: 1, eligible_30: 1, retained_30: 1 }] },
    services: { listings: 3, by_category: [{ category: "Home services", listings: 2, active: 1 }] },
  };
  const r = tabExportSections("residents", { overview: {}, watches: [], section: residents });
  assert.deepEqual(r.map((s) => s.title), ["Active members", "Active members over time", "Reports by who raised them", "Residents and patrol coverage by suburb", "Retention by sign-up month", "Local services", "Local services by category", "Watches"]);
  assert.equal(r[2].rows[1].group, "Not recorded");
  assert.equal(r[3].rows[0].under, "Yes");
  assert.equal(r[4].rows[0].month_label, "Sep 2026");
  const sec = tabExportSections("security", { overview: {}, watches: [], section: { companies: { total: 0 }, top_companies: [], movement: { by_event: [{ event: "claimed", events: 2 }] } } });
  assert.deepEqual(sec.map((s) => s.title), ["Security companies", "Onboarding over time", "Companies", "Client changes", "Watches"]);
  assert.deepEqual(sec[3].rows, [{ name: "Claimed", value: 2 }]);
  // No data yet (zero companies, or the section not loaded): the CSV still has its header
  assert.ok(sectionsToCsv([["Report", "x"]], tabExportSections("security", { overview: {}, watches: [], section: null })).startsWith("\uFEFFReport,x"));
});
