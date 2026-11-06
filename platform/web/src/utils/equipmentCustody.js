import { supabase } from "../supabase/client";

const CODE_KEY = (id) => `watchman.handover.${id}`;

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  return { data: error ? null : data ?? null, error };
}

const isoOrNull = (v) => (v ? new Date(v).toISOString() : null);

export function rememberHandoverCode(transferId, code) {
  if (!transferId || !code) return;
  try {
    sessionStorage.setItem(CODE_KEY(transferId), String(code));
  } catch {
    /* private mode: the holder can generate a new code */
  }
}

export function readHandoverCode(transferId) {
  try {
    return sessionStorage.getItem(CODE_KEY(transferId)) || "";
  } catch {
    return "";
  }
}

export function clearHandoverCode(transferId) {
  try {
    sessionStorage.removeItem(CODE_KEY(transferId));
  } catch {
    /* ignore */
  }
}

/** Soft failures return { ok: false, error } and must not be shown as raw PostgREST text. */
export function handoverResultError(data, error, fallback) {
  if (error) return null;
  if (data && data.ok === false) return data.error || fallback || "That did not work. Try again.";
  return "";
}

export const getEquipmentHandover = (transferId) => rpc("get_equipment_handover", { p_transfer_id: transferId });
export const confirmHandoverGiver = (transferId) => rpc("confirm_equipment_handover_giver", { p_transfer_id: transferId });
export const confirmHandoverReceiver = (transferId, code, condition, ack) =>
  rpc("confirm_equipment_handover_receiver", {
    p_transfer_id: transferId,
    p_code: code,
    p_condition: condition || null,
    p_ack: Boolean(ack),
  });
export const regenerateHandoverCode = (transferId) => rpc("regenerate_equipment_handover_code", { p_transfer_id: transferId });
export const forceCompleteHandover = (transferId, reason) =>
  rpc("force_complete_equipment_transfer", { p_transfer_id: transferId, p_reason: reason });
export const addEquipmentIssueCaseNumber = (issueId, caseNumber, station = "") =>
  rpc("add_equipment_issue_case_number", { p_issue_id: issueId, p_case: caseNumber, p_station: station || null });
export const approveEquipmentWriteOff = (unitId, note = "") =>
  rpc("approve_equipment_write_off", { p_unit_id: unitId, p_note: note || null });
export const decideEquipmentLiability = (issueId, decision, amountCents = null, note = "") =>
  rpc("decide_equipment_liability", {
    p_issue_id: issueId,
    p_decision: decision,
    p_amount_cents: amountCents,
    p_note: note || null,
  });
export const logEquipmentMaintenance = (unitId, fields) =>
  rpc("log_equipment_maintenance", {
    p_unit_id: unitId,
    p_kind: fields.kind,
    p_note: fields.note || null,
    p_vendor: fields.vendor || null,
    p_cost_cents: fields.costCents ?? null,
    p_next_due: fields.nextDue || null,
    p_performed_at: isoOrNull(fields.performedAt),
  });
export const listEquipmentMaintenance = (unitId) => rpc("list_equipment_maintenance", { p_unit_id: unitId });
export const listEquipmentMaintenanceRecent = () => rpc("list_equipment_maintenance_recent", {});
