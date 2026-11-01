import { test } from "node:test";
import assert from "node:assert/strict";
import { withFullPatrollerName, buildShareCardModel, buildShareCaption } from "../patrolFormat.js";

const row = { user_id: "u1", user_name: "Khurshid", start_time: "2026-10-31T20:31:00+02:00", share_ref: "PT-1" };

test("own patrol: first name upgraded to full profile name", () => {
  const p = withFullPatrollerName(row, { viewerUid: "u1", viewerFullName: "Khurshid Abrahams" });
  assert.equal(p.user_name, "Khurshid Abrahams");
  assert.equal(buildShareCardModel({ kind: "start", patrol: p }).name, "Khurshid Abrahams");
  assert.ok(buildShareCaption({ kind: "start", patrol: p }).includes("Khurshid Abrahams"));
});

test("own patrol: falls back to metadata first + last", () => {
  const p = withFullPatrollerName(row, { viewerUid: "u1", viewerFullName: "Khurshid", viewerNameParts: ["Khurshid", " Abrahams "] });
  assert.equal(p.user_name, "Khurshid Abrahams");
});

test("never swaps in another person or a different name", () => {
  assert.equal(withFullPatrollerName(row, { viewerUid: "u2", viewerFullName: "Khurshid Abrahams" }), row);
  assert.equal(withFullPatrollerName(row, { viewerUid: "u1", viewerFullName: "Sam Jones" }), row);
  const full = { ...row, user_name: "Khurshid Abrahams" };
  assert.equal(withFullPatrollerName(full, { viewerUid: "u1", viewerFullName: "Khurshid" }), full);
  assert.equal(withFullPatrollerName(null, {}), null);
});
