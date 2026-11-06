/** Pure helpers for equipment dashboards, stocktake, and the offline queue. */

import { equipmentStatusMeta } from "./equipmentMeta.js";

export const STOCKTAKE_RESULTS = Object.freeze([
  { id: "present", label: "Found" },
  { id: "missing", label: "Missing" },
  { id: "damaged", label: "Damaged" },
]);

export const EQUIPMENT_QUEUE_ACTIONS = Object.freeze({
  return_request: "Bringing gear back",
  report_issue: "Issue report",
  handover_giver: "Hand-over confirmation",
  stocktake_count: "Stocktake count",
  still_held: "Still have it",
  paper_claim: "Paper hand-over",
});

const RAW_DB = /syntax error|duplicate key|violates |SQLSTATE|permission denied|relation "|function public\.|column "|invalid input syntax/i;

export function equipmentReportingErrorText(error) {
  const msg = String(error?.message || "").replace(/^ERROR:\s*/i, "").trim();
  if (!msg) return null;
  if (RAW_DB.test(msg)) return "That could not be saved. Try again when you are online.";
  if (/a stocktake is already open/i.test(msg)) return "A count is already open. Finish it before starting another.";
  if (/already closed/i.test(msg)) return "This stocktake is already closed.";
  if (/no stocktake is open/i.test(msg)) return "There is no open stocktake.";
  if (/only the current holder/i.test(msg)) return "Only the person holding this unit can confirm it.";
  if (/mark the unit found/i.test(msg)) return "Mark the unit found, missing, or damaged.";
  if (/start date is after/i.test(msg)) return "The start date is after the end date.";
  if (/5 years/i.test(msg)) return "Pick a period of 5 years or less.";
  if (/offline action was already used/i.test(msg)) return "That saved action was already used for something else.";
  if (/paper hand-over is already waiting/i.test(msg)) return "A paper hand-over for this unit is already waiting for an admin.";
  if (/no longer holds/i.test(msg)) return "That patroller no longer holds this unit.";
  if (/not on loan/i.test(msg)) return "This unit is not on loan.";
  if (/not active/i.test(msg)) return "This loan is not active.";
  if (/cannot claim a unit you already hold/i.test(msg)) return "You already hold this unit.";
  return null;
}

export function unitsByStatusChart(unitsByStatus) {
  return Object.entries(unitsByStatus || {})
    .map(([status, count]) => ({
      status,
      label: equipmentStatusMeta(status).label,
      count: Number(count) || 0,
    }))
    .filter((row) => row.count > 0);
}

export function csvCell(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const LEDGER_EXPORT_COLUMNS = Object.freeze([
  "id", "occurred_at", "event", "asset_tag", "item_name", "from_status", "to_status", "actor_name", "holder_name", "details",
]);

/** CSV of ledger export rows. Row count matches the array length, including the header. */
export function ledgerRowsToCsv(rows) {
  const lines = [LEDGER_EXPORT_COLUMNS.join(",")];
  for (const row of rows || []) {
    lines.push(LEDGER_EXPORT_COLUMNS.map((key) => csvCell(row[key])).join(","));
  }
  return lines.join("\n");
}

export function createQueuedAction(action, args, now = new Date()) {
  if (!EQUIPMENT_QUEUE_ACTIONS[action]) {
    throw new Error("unknown equipment action");
  }
  const id = globalThis.crypto?.randomUUID?.() || `eq-${now.getTime()}-${Math.random().toString(16).slice(2)}`;
  return {
    client_event_id: id,
    action,
    args: { ...(args || {}) },
    occurred_at: now.toISOString(),
    attempts: 0,
    last_error: "",
    needs_attention: false,
  };
}

export function isRetryableEquipmentError(error) {
  const msg = String(error?.message || error || "");
  return /failed to fetch|network|offline|timeout|load failed|fetch/i.test(msg);
}

/** Drop a success. Keep a business failure in Needs attention. Retry a network failure up to 4 tries. */
export function settleQueuedAction(queue, clientEventId, outcome) {
  const item = (queue || []).find((row) => row.client_event_id === clientEventId);
  if (!item) return queue || [];
  if (outcome?.ok) return queue.filter((row) => row.client_event_id !== clientEventId);
  const attempts = item.attempts + 1;
  const retry = Boolean(outcome?.retryable) && attempts < 4;
  return queue.map((row) => (
    row.client_event_id === clientEventId
      ? { ...row, attempts, last_error: outcome?.message || "This still needs a look.", needs_attention: !retry }
      : row
  ));
}

export function attentionItems(queue) {
  return (queue || []).filter((row) => row.needs_attention);
}

export function pendingItems(queue) {
  return (queue || []).filter((row) => !row.needs_attention);
}

export function dismissQueuedAction(queue, clientEventId) {
  return (queue || []).filter((row) => row.client_event_id !== clientEventId);
}
