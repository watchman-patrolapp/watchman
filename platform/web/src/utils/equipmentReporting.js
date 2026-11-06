import { supabase } from "../supabase/client";

async function rpc(name, args, empty = null) {
  const { data, error } = await supabase.rpc(name, args);
  return { data: error ? empty : data ?? empty, error };
}

const isoOrNull = (value) => (value ? new Date(value).toISOString() : null);

export const getEquipmentDashboard = (from = null, to = null) =>
  rpc("equipment_dashboard", { p_from: isoOrNull(from), p_to: isoOrNull(to) });

export const getEquipmentPatrollerOverview = () => rpc("equipment_patroller_overview");

export const exportEquipmentLedger = (from = null, to = null) =>
  rpc("export_equipment_ledger", { p_from: isoOrNull(from), p_to: isoOrNull(to) }, []);

export const verifyEquipmentLedger = (orgId) => rpc("verify_equipment_ledger", { p_org: orgId });

export const startEquipmentStocktake = (label) => rpc("start_equipment_stocktake", { p_label: label });

export const getEquipmentStocktake = (stocktakeId = null) =>
  rpc("get_equipment_stocktake", { p_stocktake_id: stocktakeId });

export const countEquipmentUnit = ({
  stocktakeId, unitId = null, qrToken = null, assetTag = null, result, condition = null, note = null,
  clientEventId = null, occurredAt = null,
}) => rpc("count_equipment_unit", {
  p_stocktake_id: stocktakeId,
  p_unit_id: unitId,
  p_qr_token: qrToken,
  p_asset_tag: assetTag,
  p_result: result,
  p_condition: condition,
  p_note: note,
  p_client_event_id: clientEventId,
  p_occurred_at: isoOrNull(occurredAt),
});

export const confirmEquipmentStillHeld = (unitId, clientEventId = null, occurredAt = null) =>
  rpc("confirm_equipment_still_held", {
    p_unit_id: unitId,
    p_client_event_id: clientEventId,
    p_occurred_at: isoOrNull(occurredAt),
  });

export const finaliseEquipmentStocktake = (stocktakeId, markMissingAsLost) =>
  rpc("finalise_equipment_stocktake", {
    p_stocktake_id: stocktakeId,
    p_mark_missing_as_lost: Boolean(markMissingAsLost),
  });

export const requestEquipmentReturn = (loanId, clientEventId = null, occurredAt = null) =>
  rpc("request_equipment_return", {
    p_loan_id: loanId,
    p_client_event_id: clientEventId,
    p_occurred_at: isoOrNull(occurredAt),
  });

export const submitEquipmentPaperClaim = ({ unitId, note = null, occurredAt = null, photoPath = null, clientEventId = null }) =>
  rpc("submit_equipment_paper_claim", {
    p_unit_id: unitId,
    p_note: note,
    p_occurred_at: isoOrNull(occurredAt),
    p_photo_path: photoPath,
    p_client_event_id: clientEventId,
  });

export const recordPaperHandover = (claimId) =>
  rpc("record_paper_handover", { p_claim_id: claimId });

export const listEquipmentPaperClaims = () => rpc("list_equipment_paper_claims", {}, []);

export function reportEquipmentIssueWithClient({
  unitId, kind, note, caseNumber = null, station = null, location = null, clientEventId = null, occurredAt = null,
}) {
  return rpc("report_equipment_issue", {
    p_unit_id: unitId,
    p_kind: kind,
    p_note: note,
    p_saps_case: caseNumber,
    p_saps_station: station,
    p_location: location,
    p_client_event_id: clientEventId,
    p_occurred_at: isoOrNull(occurredAt),
  });
}

export const confirmHandoverGiverWithClient = (transferId, clientEventId = null, occurredAt = null) =>
  rpc("confirm_equipment_handover_giver", {
    p_transfer_id: transferId,
    p_client_event_id: clientEventId,
    p_occurred_at: isoOrNull(occurredAt),
  });
