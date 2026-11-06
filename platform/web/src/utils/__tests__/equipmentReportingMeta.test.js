import test from "node:test";
import assert from "node:assert/strict";
import {
  attentionItems,
  createQueuedAction,
  dismissQueuedAction,
  equipmentReportingErrorText,
  ledgerRowsToCsv,
  pendingItems,
  settleQueuedAction,
  unitsByStatusChart,
} from "../equipmentReportingMeta.js";

test("ledger CSV has a header plus one line per row and escapes commas", () => {
  const csv = ledgerRowsToCsv([
    { id: 1, occurred_at: "2026-11-06", event: "status_changed", asset_tag: "RAD-1", item_name: "Radio, kit", details: 'say "hi"' },
  ]);
  const lines = csv.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^id,occurred_at,event,/);
  assert.match(lines[1], /"Radio, kit"/);
  assert.match(lines[1], /"say ""hi"""/);
});

test("status chart drops empty buckets and uses labels", () => {
  const rows = unitsByStatusChart({ available: 2, lost: 0, overdue: "1" });
  assert.deepEqual(rows.map((row) => row.label), ["Available", "Overdue"]);
  assert.equal(rows[1].count, 1);
});

test("queue keeps a business failure and drops a success", () => {
  const item = createQueuedAction("report_issue", { unitId: "u1" }, new Date("2026-11-06T12:00:00Z"));
  assert.equal(item.action, "report_issue");
  assert.equal(item.occurred_at, "2026-11-06T12:00:00.000Z");
  const failed = settleQueuedAction([item], item.client_event_id, { ok: false, retryable: false, message: "Only the latest holder can report an issue." });
  assert.equal(attentionItems(failed).length, 1);
  assert.equal(pendingItems(failed).length, 0);
  assert.match(equipmentReportingErrorText({ message: "a stocktake is already open" }), /already open/);
  const gone = dismissQueuedAction(failed, item.client_event_id);
  assert.equal(gone.length, 0);
  const ok = settleQueuedAction([item], item.client_event_id, { ok: true });
  assert.equal(ok.length, 0);
});

test("a network failure stays pending until the fourth try", () => {
  let queue = [createQueuedAction("stocktake_count", { unitId: "u1" }, new Date("2026-11-06T12:00:00Z"))];
  const id = queue[0].client_event_id;
  for (let n = 0; n < 3; n += 1) {
    queue = settleQueuedAction(queue, id, { ok: false, retryable: true, message: "Failed to fetch" });
    assert.equal(queue[0].needs_attention, false);
  }
  queue = settleQueuedAction(queue, id, { ok: false, retryable: true, message: "Failed to fetch" });
  assert.equal(queue[0].needs_attention, true);
  assert.equal(queue[0].attempts, 4);
});
