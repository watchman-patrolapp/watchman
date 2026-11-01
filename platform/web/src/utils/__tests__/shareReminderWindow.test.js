import { test } from "node:test";
import assert from "node:assert/strict";
import { SHARE_REMINDER_WINDOW_MS, shareReminderEventMs, filterFreshPendingShares, msUntilNextShareExpiry } from "../patrolFormat.js";

const NOW = Date.parse("2026-11-01T02:00:00+02:00");
const ago = (min) => new Date(NOW - min * 60000).toISOString();

test("window is 30 minutes", () => {
  assert.equal(SHARE_REMINDER_WINDOW_MS, 30 * 60 * 1000);
});

test("sign-on counts from start_time, sign-off from end_time", () => {
  assert.equal(shareReminderEventMs({ source: "active", start_time: ago(10), end_time: null }), NOW - 600000);
  assert.equal(shareReminderEventMs({ source: "ended", start_time: ago(120), end_time: ago(5) }), NOW - 300000);
  assert.ok(Number.isNaN(shareReminderEventMs({ source: "active" })));
});

test("filters rows older than the window, keeps the boundary", () => {
  const rows = [
    { share_ref: "A", source: "active", start_time: ago(29) },
    { share_ref: "B", source: "ended", start_time: ago(200), end_time: ago(30) },
    { share_ref: "C", source: "ended", start_time: ago(90), end_time: ago(31) },
    { share_ref: "D", source: "active", start_time: ago(45) },
    { share_ref: "E", source: "ended", start_time: null, end_time: null },
  ];
  assert.deepEqual(filterFreshPendingShares(rows, NOW).map((r) => r.share_ref), ["A", "B"]);
  assert.deepEqual(filterFreshPendingShares(null, NOW), []);
});

test("next expiry is the soonest fresh row", () => {
  const rows = [
    { source: "active", start_time: ago(29) },
    { source: "ended", end_time: ago(10) },
  ];
  assert.equal(msUntilNextShareExpiry(rows, NOW), 60000);
  assert.equal(msUntilNextShareExpiry([{ source: "active", start_time: ago(40) }], NOW), null);
});
