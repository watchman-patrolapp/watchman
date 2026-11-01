import test from "node:test";
import assert from "node:assert/strict";
import {
  adminStatusEndsLoan,
  adminUnitStatusTargets,
  defaultReturnDate,
  equipmentAdminBadgeCount,
  equipmentLoanErrorText,
  equipmentMyBadgeCount,
  formatDueIn,
  isOpenLoan,
  latestReturnDate,
  loanStatusMeta,
  splitMyLoans,
  toDateTimeLocalValue,
  validateReturnDate,
} from "../equipmentLoanMeta.js";

const NOW = new Date(2026, 10, 1, 10, 15, 0);

test("loanStatusMeta labels and overdue override", () => {
  assert.equal(loanStatusMeta({ status: "approved" }).label, "Ready to collect");
  assert.equal(loanStatusMeta({ status: "active", is_overdue: true }).label, "Overdue");
  assert.equal(loanStatusMeta({ status: "active" }).label, "With you");
  assert.equal(loanStatusMeta({ status: "weird" }).label, "weird");
  assert.equal(loanStatusMeta(null).label, "Unknown");
});

test("isOpenLoan / splitMyLoans", () => {
  assert.equal(isOpenLoan({ status: "requested" }), true);
  assert.equal(isOpenLoan({ status: "returned" }), false);
  const { open, past } = splitMyLoans([{ status: "active" }, { status: "expired" }, { status: "approved" }]);
  assert.equal(open.length, 2);
  assert.equal(past.length, 1);
  assert.deepEqual(splitMyLoans(null), { open: [], past: [] });
});

test("defaultReturnDate uses the limit or 7 days, rounded up to the hour", () => {
  const d = defaultReturnDate(12, NOW);
  assert.equal(d.getHours(), 23);
  assert.equal(d.getMinutes(), 0);
  const w = defaultReturnDate(null, NOW);
  assert.equal(Math.floor((w - NOW) / 3600_000), 168);
});

test("latestReturnDate and validateReturnDate", () => {
  assert.equal(Math.round((latestReturnDate(12, NOW) - NOW) / 3600_000), 180);
  assert.equal(Math.round((latestReturnDate(null, NOW) - NOW) / 3600_000), 888);
  assert.equal(validateReturnDate("", 12, NOW), null);
  assert.match(validateReturnDate(new Date(NOW.getTime() - 1000).toISOString(), 12, NOW), /future/);
  assert.match(validateReturnDate(new Date(NOW.getTime() + 200 * 3600_000).toISOString(), 12, NOW), /longer/);
  assert.equal(validateReturnDate(new Date(NOW.getTime() + 5 * 3600_000).toISOString(), 12, NOW), null);
  assert.match(validateReturnDate("nope", 12, NOW), /valid/);
});

test("toDateTimeLocalValue", () => {
  assert.equal(toDateTimeLocalValue(NOW), "2026-11-01T10:15");
  assert.equal(toDateTimeLocalValue("bad"), "");
});

test("formatDueIn", () => {
  assert.equal(formatDueIn(new Date(NOW.getTime() + 3 * 3600_000), NOW), "Due in 3 h");
  assert.equal(formatDueIn(new Date(NOW.getTime() + 72 * 3600_000), NOW), "Due in 3 days");
  assert.equal(formatDueIn(new Date(NOW.getTime() - 5 * 3600_000), NOW), "Overdue by 5 h");
  assert.equal(formatDueIn(new Date(NOW.getTime() + 10 * 60_000), NOW), "Due in 10 min");
  assert.equal(formatDueIn(null, NOW), "");
});

test("badge counts", () => {
  assert.equal(equipmentAdminBadgeCount({ can_manage: true, requests: 2, to_collect: 1, overdue: 1, issues: 3 }), 7);
  assert.equal(equipmentAdminBadgeCount({ can_manage: false, requests: 2 }), 0);
  assert.equal(equipmentAdminBadgeCount(null), 0);
  assert.equal(equipmentMyBadgeCount({ incoming_transfers: 1, my_ready: 1, my_overdue: "2" }), 4);
  assert.equal(equipmentMyBadgeCount(undefined), 0);
});

test("equipmentLoanErrorText", () => {
  assert.match(equipmentLoanErrorText({ message: "ERROR: training sign-off required for this item" }), /training sign-off/);
  assert.match(equipmentLoanErrorText({ message: "you already have an open request or loan for this item" }), /already/);
  assert.match(equipmentLoanErrorText({ message: "only the latest holder can report an issue" }), /latest/);
  assert.equal(equipmentLoanErrorText({ message: "something else" }), null);
  assert.equal(equipmentLoanErrorText({ message: "the requester has no training sign-off for this item" }), null);
  assert.equal(equipmentLoanErrorText(null), null);
});

test("adminUnitStatusTargets: repair can come back, loans can only be written off", () => {
  assert.deepEqual(adminUnitStatusTargets("under_repair"), ["available", "retired"]);
  assert.deepEqual(adminUnitStatusTargets("overdue"), ["damaged", "lost", "stolen"]);
  assert.ok(adminUnitStatusTargets("available").includes("retired"));
  assert.deepEqual(adminUnitStatusTargets("reserved"), []);
  assert.deepEqual(adminUnitStatusTargets("in_transfer"), []);
  assert.deepEqual(adminUnitStatusTargets("retired"), []);
  assert.equal(adminStatusEndsLoan("checked_out"), true);
  assert.equal(adminStatusEndsLoan("available"), false);
});
