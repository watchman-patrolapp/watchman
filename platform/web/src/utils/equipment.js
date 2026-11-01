import { supabase } from "../supabase/client";
import { isRpcNotFoundError } from "./isRpcNotFound";
import { COMMUNITY_MEDIA_BUCKET } from "./communityMedia";
import { normalizeAppRole } from "../auth/staffRoles";
import { canAccessPlatformConsole } from "../auth/platformRoles";
import { PATROL_MEMBER_ROLES } from "../auth/roleMatrix";
import { equipmentErrorMessage as baseErrorMessage } from "./equipmentMeta";
import { equipmentLoanErrorText } from "./equipmentLoanMeta";

export * from "./equipmentMeta";
export * from "./equipmentLoanMeta";

/**
 * P3a equipment catalogue RPC wrappers. Each returns { data, error }.
 * Members never select restricted unit columns (price, serial, QR token, supplier,
 * invoice, funding); everything goes through list_/get_ RPCs.
 */

/** Server: can_manage_equipment = NW admin (+ global/platform staff). The custodian capability is not used yet. */
export const EQUIPMENT_MANAGER_ROLES = ["admin", "technical_support", "nw_admin"];

export function canManageEquipment(role, platformRole) {
  if (canAccessPlatformConsole(platformRole)) return true;
  return EQUIPMENT_MANAGER_ROLES.includes(normalizeAppRole(role));
}

export function canBrowseEquipment(role, platformRole) {
  if (canAccessPlatformConsole(platformRole)) return true;
  return PATROL_MEMBER_ROLES.includes(normalizeAppRole(role));
}

export function equipmentPhotoUrl(path) {
  if (!path) return null;
  const { data } = supabase.storage.from(COMMUNITY_MEDIA_BUCKET).getPublicUrl(path);
  return data?.publicUrl ?? null;
}

export function equipmentErrorMessage(error, fallback) {
  if (!isRpcNotFoundError(error)) {
    const loanText = equipmentLoanErrorText(error);
    if (loanText) return loanText;
  }
  return baseErrorMessage(error, isRpcNotFoundError(error), fallback);
}

export async function listEquipmentCatalogue({ includeArchived = false } = {}) {
  const { data, error } = await supabase.rpc("list_equipment_catalogue", { p_include_archived: includeArchived });
  return { data: data || [], error };
}

export async function getEquipmentItem(itemId) {
  const { data, error } = await supabase.rpc("get_equipment_item", { p_item_id: itemId });
  return { data: data || null, error };
}

export async function getEquipmentUnit(unitId) {
  const { data, error } = await supabase.rpc("get_equipment_unit", { p_unit_id: unitId });
  return { data: data || null, error };
}

export async function resolveEquipmentQr(token) {
  const { data, error } = await supabase.rpc("resolve_equipment_qr", { p_token: token });
  return { data: data || null, error };
}

export async function listEquipmentUnitLedger(unitId, limit = 50) {
  const { data, error } = await supabase.rpc("list_equipment_unit_ledger", { p_unit_id: unitId, p_limit: limit });
  return { data: data || [], error };
}

// ---------------------------------------------------------------------------
// Admin (can_manage_equipment). Server re-checks everything; cross-org = "not found".
// ---------------------------------------------------------------------------

export async function listEquipmentCategories(orgId) {
  let q = supabase.from("equipment_categories").select("id, name, sort_order").order("sort_order").order("name");
  if (orgId) q = q.eq("organization_id", orgId);
  const { data, error } = await q;
  return { data: data || [], error };
}

export async function ensureEquipmentDefaults() {
  const { data, error } = await supabase.rpc("ensure_equipment_defaults");
  return { data, error };
}

export async function upsertEquipmentItem({ id = null, name, categoryId = null, description = null, photoPath = null, requiresCertification = false, isArchived = false }) {
  const { data, error } = await supabase.rpc("upsert_equipment_item", {
    p_id: id,
    p_name: name,
    p_category_id: categoryId || null,
    p_description: description || null,
    p_photo_path: photoPath || null,
    p_requires_certification: Boolean(requiresCertification),
    p_is_archived: Boolean(isArchived),
  });
  return { data, error };
}

export async function setEquipmentItemDetails(itemId, { kitContents = null, maxLoanHours = null } = {}) {
  const { error } = await supabase.rpc("set_equipment_item_details", {
    p_item_id: itemId,
    p_kit_contents: kitContents || null,
    p_max_loan_hours: maxLoanHours == null || maxLoanHours === "" ? null : Number(maxLoanHours),
  });
  return { error };
}

export async function setEquipmentItemPhotos(itemId, paths) {
  const { data, error } = await supabase.rpc("set_equipment_item_photos", { p_item_id: itemId, p_paths: paths || [] });
  return { data: data || [], error };
}

export async function addEquipmentUnit(u) {
  const { data, error } = await supabase.rpc("add_equipment_unit", {
    p_item_id: u.itemId,
    p_asset_tag: String(u.assetTag || "").trim().toUpperCase(),
    p_condition: u.condition || "good",
    p_location_note: u.locationNote || null,
    p_serial_number: u.serialNumber || null,
    p_purchase_price_cents: u.purchasePriceCents ?? null,
    p_purchase_date: u.purchaseDate || null,
    p_supplier: u.supplier || null,
    p_invoice_path: u.invoicePath || null,
    p_funding_source: u.fundingSource || null,
    p_photo_path: u.photoPath || null,
  });
  return { data, error };
}

export async function updateEquipmentUnitDetails(u) {
  const { error } = await supabase.rpc("update_equipment_unit_details", {
    p_unit_id: u.id,
    p_condition: u.condition || "good",
    p_location_note: u.locationNote || null,
    p_serial_number: u.serialNumber || null,
    p_purchase_price_cents: u.purchasePriceCents ?? null,
    p_purchase_date: u.purchaseDate || null,
    p_supplier: u.supplier || null,
    p_invoice_path: u.invoicePath || null,
    p_funding_source: u.fundingSource || null,
    p_photo_path: u.photoPath || null,
  });
  return { error };
}

export async function setEquipmentUnitNotes(unitId, notes) {
  const { error } = await supabase.rpc("set_equipment_unit_notes", { p_unit_id: unitId, p_notes: notes || null });
  return { error };
}

export async function rotateEquipmentQr(unitId) {
  const { data, error } = await supabase.rpc("rotate_equipment_qr", { p_unit_id: unitId });
  return { data, error };
}

export async function listEquipmentUnitsAdmin(itemId = null) {
  const { data, error } = await supabase.rpc("list_equipment_units_admin", { p_item_id: itemId });
  return { data: data || [], error };
}

export async function suggestEquipmentAssetTag(itemId) {
  const { data, error } = await supabase.rpc("suggest_equipment_asset_tag", { p_item_id: itemId });
  return { data: data || "", error };
}

export async function createEquipmentFromWishlist(wishlistItemId, categoryId = null) {
  const { data, error } = await supabase.rpc("create_equipment_from_wishlist", {
    p_wishlist_item_id: wishlistItemId,
    p_category_id: categoryId,
  });
  return { data, error };
}

/** Map wishlist_item_id -> equipment item id. Empty map if the RPC is missing (older DB). */
export async function listEquipmentWishlistLinks() {
  const { data, error } = await supabase.rpc("list_equipment_wishlist_links");
  if (error) return { data: new Map(), error: isRpcNotFoundError(error) ? null : error };
  return { data: new Map((data || []).map((r) => [r.wishlist_item_id, r.item_id])), error: null };
}

// ---------------------------------------------------------------------------
// P3b borrowing. All writes go through SECURITY DEFINER RPCs; the server re-checks
// role, neighbourhood, training sign-off and unit status on every call.
// ---------------------------------------------------------------------------

async function rpc(name, args, empty = null) {
  const { data, error } = await supabase.rpc(name, args);
  return { data: error ? empty : data ?? empty, error };
}

const isoOrNull = (v) => (v ? new Date(v).toISOString() : null);

export const requestEquipmentLoan = (itemId, { note = "", desiredDueAt = null } = {}) =>
  rpc("request_equipment_loan", { p_item_id: itemId, p_note: note || null, p_desired_due_at: isoOrNull(desiredDueAt) });
export const cancelEquipmentLoanRequest = (loanId) => rpc("cancel_equipment_loan_request", { p_loan_id: loanId });
export const approveEquipmentLoan = (loanId, { unitId = null, note = "" } = {}) =>
  rpc("approve_equipment_loan", { p_loan_id: loanId, p_unit_id: unitId || null, p_note: note || null });
export const rejectEquipmentLoan = (loanId, note = "") => rpc("reject_equipment_loan", { p_loan_id: loanId, p_note: note || null });
export const confirmEquipmentCollection = (loanId, dueAt = null) =>
  rpc("confirm_equipment_collection", { p_loan_id: loanId, p_due_at: isoOrNull(dueAt) });
export const confirmEquipmentReturn = (loanId, { condition = null, note = "" } = {}) =>
  rpc("confirm_equipment_return", { p_loan_id: loanId, p_condition: condition || null, p_note: note || null });
export const extendEquipmentLoan = (loanId, dueAt) => rpc("extend_equipment_loan", { p_loan_id: loanId, p_due_at: isoOrNull(dueAt) });
export const setEquipmentUnitStatusAdmin = (unitId, status, note = "") =>
  rpc("set_equipment_unit_status_admin", { p_unit_id: unitId, p_status: status, p_note: note || null });

export const requestEquipmentTransfer = (unitId, note = "") => rpc("request_equipment_transfer", { p_unit_id: unitId, p_note: note || null });
export const respondEquipmentTransfer = (transferId, accept, note = "") =>
  rpc("respond_equipment_transfer", { p_transfer_id: transferId, p_accept: Boolean(accept), p_note: note || null });
export const cancelEquipmentTransfer = (transferId) => rpc("cancel_equipment_transfer", { p_transfer_id: transferId });

export const reportEquipmentIssue = (unitId, kind, note) => rpc("report_equipment_issue", { p_unit_id: unitId, p_kind: kind, p_note: note });
export const clearEquipmentIssue = (issueId, outcome = "available", note = "") =>
  rpc("clear_equipment_issue", { p_issue_id: issueId, p_outcome: outcome, p_note: note || null });

export const grantEquipmentCertification = (userId, itemId, { expiresAt = null, note = "" } = {}) =>
  rpc("grant_equipment_certification", { p_user_id: userId, p_item_id: itemId, p_expires_at: isoOrNull(expiresAt), p_note: note || null });
export const revokeEquipmentCertification = (userId, itemId, note = "") =>
  rpc("revoke_equipment_certification", { p_user_id: userId, p_item_id: itemId, p_note: note || null });
export const listEquipmentCertificationsAdmin = () => rpc("list_equipment_certifications_admin", {}, []);
export const listEquipmentPatrollers = () => rpc("list_equipment_patrollers", {}, []);

/** Expire stale requests/transfers and flag overdue loans for the active neighbourhood. Safe to call on page load. */
export const runEquipmentSweep = () => rpc("equipment_sweep", {});
export const listMyEquipmentLoans = () => rpc("list_my_equipment_loans", {}, []);
export const listMyEquipmentTransfers = () => rpc("list_my_equipment_transfers", {}, []);
export const listEquipmentRequestsAdmin = () => rpc("list_equipment_requests_admin", {}, []);
export const listEquipmentIssuesAdmin = () => rpc("list_equipment_issues_admin", {}, []);
export const listEquipmentUnitCustody = (unitId) => rpc("list_equipment_unit_custody", { p_unit_id: unitId }, []);

/** Badge counts; null data (no error) on databases without P3b, so badges just stay hidden. */
export async function getEquipmentPendingCounts() {
  const { data, error } = await supabase.rpc("equipment_pending_counts");
  if (error) return { data: null, error: isRpcNotFoundError(error) ? null : error };
  return { data: data || null, error: null };
}
