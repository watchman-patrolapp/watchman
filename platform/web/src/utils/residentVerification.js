import { supabase } from "../supabase/client";
import { isRpcNotFoundError } from "./isRpcNotFound";
import { normalizeAppRole } from "../auth/roleMatrix";
import { NOTICE_LIFE_MS, NOTICE_PIN_MS } from "./areaBroadcasts";

export const RESIDENT_VOUCH_THRESHOLD = 2;

const VERIFIER_ROLE_LABELS = {
  patroller: "Patroller",
  admin: "Main admin",
  nw_admin: "NW admin",
  technical_support: "Technical support",
  committee: "Committee",
  investigator: "Investigator",
  volunteer: "Volunteer",
  resident: "Neighbour",
};

export function verifierRoleLabel(role) {
  return VERIFIER_ROLE_LABELS[normalizeAppRole(role)] || "Staff";
}

/** Global platform roles are unique; do not show the person's name. */
function verifierShowsName(role) {
  const normalized = normalizeAppRole(role);
  return normalized !== "admin" && normalized !== "technical_support";
}

function staffVerifiedByLabel(actor) {
  const role = verifierRoleLabel(actor?.actor_role);
  const name = verifierShowsName(actor?.actor_role) ? String(actor?.actor_name || "").trim() : "";
  if (name) return `Verified by ${role} ${name}`;
  return `Verified by ${role}`;
}

export async function fetchResidentVouchers(residentIds) {
  if (!residentIds?.length) return [];
  const { data, error } = await supabase
    .from("resident_verification_vouchers")
    .select("resident_user_id, voucher_user_id")
    .in("resident_user_id", residentIds);
  if (error) {
    if (!isRpcNotFoundError(error)) {
      console.warn("resident_verification_vouchers:", error.message);
    }
    return [];
  }
  return data || [];
}

export function vouchSummaryForResident(vouchers, residentId, currentUserId) {
  const rows = (vouchers || []).filter((row) => row.resident_user_id === residentId);
  return {
    count: rows.length,
    vouchedByMe: Boolean(currentUserId && rows.some((row) => row.voucher_user_id === currentUserId)),
  };
}

export async function verifyResidentAsStaff(residentUserId) {
  const { data, error } = await supabase.rpc("verify_resident_as_staff", {
    p_resident_user_id: residentUserId,
  });
  return { data, error };
}

export async function vouchForResident(residentUserId) {
  const { data, error } = await supabase.rpc("vouch_for_resident", {
    p_resident_user_id: residentUserId,
  });
  return { data, error };
}

export async function listPendingResidentsForVouch() {
  const { data, error } = await supabase.rpc("list_pending_residents_for_vouch");
  if (error) {
    if (!isRpcNotFoundError(error)) {
      console.warn("list_pending_residents_for_vouch:", error.message);
    }
    return [];
  }
  return data || [];
}

export async function listResidentNeighbours() {
  const { data, error } = await supabase.rpc("list_resident_neighbours");
  let rows = [];
  if (!error && Array.isArray(data)) {
    rows = data;
  } else {
    if (error && !isRpcNotFoundError(error)) {
      console.warn("list_resident_neighbours:", error.message);
    }
    const pending = await listPendingResidentsForVouch();
    rows = (pending || []).map((row) => ({
      ...row,
      verified: false,
      verification_date: null,
      is_self: false,
    }));
  }

  const missing = rows.filter((row) => row.verified && !verifiedByLabel(row));
  if (!missing.length) return rows;

  const logs = await listResidentVerificationLogs();
  if (!logs.length) return rows;

  const grouped = groupVerificationLogs(logs);
  return rows.map((row) => {
    if (!row.verified || verifiedByLabel(row)) return row;
    const entries = grouped[row.user_id] || [];
    if (!entries.length) return row;
    const staff = entries.find((entry) => entry.kind === "staff");
    return {
      ...row,
      verification_method: staff ? "staff" : "vouch",
      verified_by_name: staff?.actor_name || row.verified_by_name,
      verified_by_role: staff?.actor_role || row.verified_by_role,
      voucher_names: entries
        .filter((entry) => entry.kind === "vouch")
        .map((entry) => entry.actor_name)
        .filter(Boolean),
    };
  });
}

const DASHBOARD_REPORT_WINDOW_MS = 10 * 60 * 60 * 1000;
const DASHBOARD_SOS_CLEARED_WINDOW_MS = 15 * 60 * 1000;

function timeMs(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

/** Dashboard feed only: reports 10h, notices 12–24h, uncleared SOS until resolved, cleared SOS 15 min. Newest first. */
export function filterDashboardNeighbourhoodActivity(rows, now = Date.now()) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => {
      if (row?.is_notice) {
        const submitted = timeMs(row?.submitted_at);
        if (!submitted) return false;
        const age = now - submitted;
        return age >= NOTICE_PIN_MS && age < NOTICE_LIFE_MS;
      }
      if (row?.is_sos) {
        if (!row.resolved_at) return true;
        const clearedAt = timeMs(row.resolved_at);
        if (!clearedAt) return true;
        return now - clearedAt <= DASHBOARD_SOS_CLEARED_WINDOW_MS;
      }
      const submitted = timeMs(row?.submitted_at);
      if (!submitted) return false;
      return now - submitted <= DASHBOARD_REPORT_WINDOW_MS;
    })
    .sort((a, b) => timeMs(b?.submitted_at) - timeMs(a?.submitted_at));
}

async function attachSosResolvedAt(rows) {
  const missing = (rows || []).filter((row) => row?.is_sos && row.resolved_at === undefined);
  if (!missing.length) return rows || [];
  const { data: alerts, error } = await supabase
    .from("sos_alerts")
    .select("incident_id, resolved_at, created_at")
    .in(
      "incident_id",
      missing.map((row) => row.id)
    );
  if (error || !alerts?.length) return rows || [];
  const latest = {};
  for (const alert of alerts) {
    const prev = latest[alert.incident_id];
    if (!prev || timeMs(alert.created_at) >= timeMs(prev.created_at)) {
      latest[alert.incident_id] = alert;
    }
  }
  return rows.map((row) => {
    const alert = latest[row.id];
    if (!row.is_sos || !alert) return row;
    return { ...row, resolved_at: alert.resolved_at || null };
  });
}

export async function listResidentNeighbourhoodActivity(limit = 20) {
  const { data, error } = await supabase.rpc("list_resident_neighbourhood_activity", {
    p_limit: limit,
  });
  const enriched = await attachSosResolvedAt(data || []);
  return { data: filterDashboardNeighbourhoodActivity(enriched), error };
}

export async function getResidentVerificationLog(residentUserId) {
  const { data, error } = await supabase.rpc("get_resident_verification_log", {
    p_resident_user_id: residentUserId || null,
  });
  return { data: data || [], error };
}

export async function listResidentVerificationLogs() {
  const { data, error } = await supabase.rpc("list_resident_verification_logs");
  if (error) {
    if (!isRpcNotFoundError(error)) {
      console.warn("list_resident_verification_logs:", error.message);
    }
    return [];
  }
  return data || [];
}

export function verificationLabel(profile) {
  if (profile?.verification_method === "watch_member") return "Watch member";
  if (!profile?.verification_date && !profile?.verified) return "Pending";
  return profile.verification_method === "vouch" ? "Verified · neighbours" : "Verified";
}

export function formatVerifiedBy(entries) {
  const rows = Array.isArray(entries) ? entries : [];
  if (rows.some((row) => row.kind === "watch_member")) {
    return "Watch member · lives here";
  }
  const staff = rows.filter((row) => row.kind === "staff");
  const vouches = rows.filter((row) => row.kind === "vouch");
  if (staff.length) {
    return staffVerifiedByLabel(staff[0]);
  }
  const names = vouches.map((row) => String(row.actor_name || "").trim()).filter(Boolean);
  if (names.length === 1) return `Verified by ${names[0]}`;
  if (names.length === 2) return `Verified by ${names[0]} and ${names[1]}`;
  if (names.length > 2) {
    return `Verified by ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return "Verified";
}

export function verificationEntriesFromNeighbour(row) {
  if (!row?.verified) return [];
  const method = String(row.verification_method || "").toLowerCase();
  if (method === "watch_member") {
    return [{ kind: "watch_member", actor_name: "", actor_role: row.verified_by_role }];
  }
  if (method !== "vouch") {
    const name = String(row.verified_by_name || "").trim();
    if (name || method === "staff") {
      return [
        {
          kind: "staff",
          actor_name: name,
          actor_role: row.verified_by_role,
        },
      ];
    }
  }
  return (Array.isArray(row.voucher_names) ? row.voucher_names : []).map((name) => ({
    kind: "vouch",
    actor_name: name,
    actor_role: "resident",
  }));
}

export function verifiedByLabel(row) {
  if (!row?.verified) return "";
  const label = formatVerifiedBy(verificationEntriesFromNeighbour(row));
  return label === "Verified" ? "" : label;
}

export function groupVerificationLogs(rows) {
  const grouped = {};
  for (const row of rows || []) {
    const id = row.resident_user_id;
    if (!id) continue;
    if (!grouped[id]) grouped[id] = [];
    grouped[id].push(row);
  }
  return grouped;
}

export function initialsFromName(name, fallback = "?") {
  const raw = String(name || "").trim();
  if (!raw) return fallback;
  return raw
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function streetLabelForResident(row) {
  return (
    String(row?.street_label || "").trim() ||
    String(row?.home_address || row?.address || "").trim() ||
    "Street not listed"
  );
}
