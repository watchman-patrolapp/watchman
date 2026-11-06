import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkIds, fetchInChunks } from "../fetchInChunks.js";
import { incidentKeysetOr, quotePostgrestValue } from "../incidentKeyset.js";
import { boundsForRange, last90DayRange, rangeForPreset } from "../leaderboardRange.js";

test("chunkIds drops empties, dedupes, and keeps caller order", () => {
  assert.deepEqual(chunkIds([1, "", null, 1, 2, "2", 3], 2), [[1, 2], [3]]);
  assert.deepEqual(chunkIds([]), []);
  assert.equal(chunkIds(Array.from({ length: 301 }, (_, i) => i), 150).length, 3);
});

test("fetchInChunks concatenates pages and throws the query error", async () => {
  const seen = [];
  const rows = await fetchInChunks(["a", "b", "c"], async (chunk) => {
    seen.push(chunk);
    return { data: chunk.map((id) => ({ id })), error: null };
  }, { size: 2, concurrency: 1 });
  assert.deepEqual(seen, [["a", "b"], ["c"]]);
  assert.deepEqual(rows, [{ id: "a" }, { id: "b" }, { id: "c" }]);

  await assert.rejects(
    () => fetchInChunks(["a", "b"], async () => ({ data: null, error: { message: "too long", code: "PGRST" } }), { size: 1 }),
    (err) => err.message === "too long" && err.code === "PGRST"
  );
  assert.deepEqual(await fetchInChunks([], async () => ({ data: [1], error: null })), []);
});

test("incident keyset filter quotes timestamps", () => {
  const cursor = { submitted_at: "2026-11-04T10:00:00+02:00", id: "abc" };
  assert.equal(quotePostgrestValue(cursor.submitted_at), `"2026-11-04T10:00:00+02:00"`);
  assert.equal(
    incidentKeysetOr(cursor),
    `submitted_at.lt."2026-11-04T10:00:00+02:00",and(submitted_at.eq."2026-11-04T10:00:00+02:00",id.lt."abc")`
  );
  assert.equal(incidentKeysetOr({ id: "abc" }), null);
});

test("leaderboard range defaults to 90 SAST days and all-time has null bounds", () => {
  const now = new Date("2026-11-04T12:00:00+02:00");
  const range = last90DayRange(now);
  assert.equal(range.preset, "90d");
  assert.equal(range.to, "2026-11-04");
  assert.equal(range.from, "2026-08-07");
  assert.deepEqual(boundsForRange(rangeForPreset("all", now)), { from: null, to: null });
  const week = boundsForRange(rangeForPreset("week", now));
  assert.ok(week.from);
  assert.ok(week.to);
  const swapped = boundsForRange({ preset: "custom", from: "2026-11-04", to: "2026-11-01" });
  assert.ok(swapped.from < swapped.to);
});
