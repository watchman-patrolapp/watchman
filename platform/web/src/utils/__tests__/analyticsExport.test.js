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
