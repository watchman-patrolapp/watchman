import { supabase } from "../supabase/client";
import {
  getWorkingOrganizationId,
  getWorkingOrganizationIncludeUnscoped,
  belongsToActiveOrganization,
  scopeToOrganization,
} from "./organizationScope";
import { MessageType } from "../chat/utils/constants";
import { sanitizeInput } from "../chat/utils/security";
import { enqueueChatQueueItem } from "../chat/utils/chatQueueStorage";
import { isRpcNotFoundError } from "./isRpcNotFound";
import { fetchInChunks } from "./fetchInChunks";
import {
  buildPendingSosQueueItem,
  buildSosChatQueueItem,
  buildSosChatText,
  canUseOfflineSosQueue,
  newSosLocalId,
  shapeBroadcastResult,
} from "./sosDelivery";
import { fetchUserLabelMap } from "./profileUserLabels";
import { parsePatrolTime } from "./watchTime";
import { coordsColumns, isMissingCoordColumnError } from "./incidentCoords";

export function formatSosTimestamp(value) {
  const d = parsePatrolTime(value);
  if (!d) return "";
  return d.toLocaleString("en-ZA");
}

function coordsFromPosition(position) {
  if (!position?.coords) return null;
  const { latitude, longitude, accuracy } = position.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude, accuracy };
}

export async function readCurrentPosition() {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12000,
      });
    });
    return coordsFromPosition(position);
  } catch {
    return null;
  }
}

export function householdAddressFrom(user, profile) {
  return String(profile?.home_address || user?.address || "").trim();
}

async function loadHouseholdCard(user) {
  const card = {
    fullName: user.fullName || user.email || "Resident",
    email: user.email || "",
    phone: user.phone || "",
    address: String(user.address || "").trim(),
    homeAddress: "",
    avatarUrl: user.avatarUrl || null,
  };
  try {
    const { data: profile } = await supabase
      .from("resident_profiles")
      .select("home_address")
      .eq("user_id", user.id)
      .maybeSingle();
    card.homeAddress = String(profile?.home_address || "").trim();
  } catch {
    /* profile optional */
  }
  return card;
}

/**
 * Creates an SOS analytics incident (not a moderation item) + sos_alerts row.
 */
export async function triggerResidentSos({
  user,
  organizationId,
  notes,
  triggerType = "hold",
  coords: coordsOverride = null,
} = {}) {
  if (!user?.id) {
    throw new Error("You must be signed in to send an SOS.");
  }

  const coords =
    coordsOverride && Number.isFinite(coordsOverride.latitude) && Number.isFinite(coordsOverride.longitude)
      ? coordsOverride
      : await readCurrentPosition();
  const card = await loadHouseholdCard(user);
  const homeAddress = householdAddressFrom(user, { home_address: card.homeAddress });
  const description = String(notes || "").trim() || "Resident triggered SOS.";
  const orgId = organizationId || user.organizationId || getWorkingOrganizationId() || null;
  if (!orgId) {
    throw new Error("Select or join a neighbourhood before sending an SOS.");
  }
  const locationLabel = homeAddress
    ? homeAddress
    : coords
      ? `${coords.latitude}, ${coords.longitude}`
      : "Location unavailable";

  const incidentRow = {
    type: "SOS",
    status: "approved",
    description,
    submitted_by: user.id,
    submitted_by_name: card.fullName,
    location: locationLabel,
    incident_date: new Date().toISOString(),
    reporter_id: user.id,
    organization_id: orgId,
    title: "Resident SOS",
  };
  const insertIncident = (row) => supabase.from("incidents").insert(row).select("id").single();
  const coordCols = coordsColumns(coords);
  let { data: incident, error: incidentErr } = await insertIncident({ ...incidentRow, ...coordCols });
  if (incidentErr && Object.keys(coordCols).length > 0 && isMissingCoordColumnError(incidentErr)) {
    ({ data: incident, error: incidentErr } = await insertIncident(incidentRow));
  }
  if (incidentErr) throw incidentErr;

  const sosPayload = {
    incident_id: incident.id,
    resident_id: user.id,
    trigger_type: triggerType === "hold" ? "hold" : triggerType || "button",
    auto_location_accuracy: coords ? Math.round(coords.accuracy || 0) : null,
    escalation_level: 0,
    organization_id: orgId,
  };
  let { error: sosErr } = await supabase.from("sos_alerts").insert(sosPayload);
  if (sosErr && triggerType === "hold") {
    ({ error: sosErr } = await supabase.from("sos_alerts").insert({
      ...sosPayload,
      trigger_type: "button",
    }));
  }
  if (sosErr) {
    await supabase.from("incidents").delete().eq("id", incident.id);
    throw sosErr;
  }

  const chat = await deliverSosChat({
    user,
    coords,
    description,
    orgId,
    homeAddress,
    card,
  });

  return { incidentId: incident.id, coords, card, chat, homeAddress, description, orgId };
}

/**
 * Offline: the chat queue can hold a full SOS and replay it on reconnect.
 * Returns { ok: false } when storage cannot take the item — caller shows the phone fallback.
 */
export async function queueResidentSosForLater({
  user,
  organizationId,
  notes,
  triggerType = "hold",
} = {}) {
  if (!canUseOfflineSosQueue()) {
    return { ok: false, error: "This device cannot queue an SOS." };
  }
  if (!user?.id) {
    return { ok: false, error: "You must be signed in to send an SOS." };
  }
  if (!organizationId) {
    return { ok: false, error: "Select or join a neighbourhood before sending an SOS." };
  }
  const coords = await readCurrentPosition();
  const localId = newSosLocalId();
  const item = buildPendingSosQueueItem({
    localId,
    user,
    organizationId,
    notes,
    triggerType,
    coords,
  });
  const queued = enqueueChatQueueItem(item);
  if (!queued.ok) {
    return { ok: false, localId, error: queued.error || "Could not queue the SOS." };
  }
  return { ok: true, localId };
}

export async function listSecurityPartnerSosAlerts() {
  const { data, error } = await supabase.rpc("security_partner_sos_alerts");
  if (!error && Array.isArray(data)) {
    return enrichSosBoardAlerts(data.map(normalizeSosBoardRow));
  }
  if (error && !isRpcNotFoundError(error)) {
    throw error;
  }
  throw new Error("Run the security partner SOS SQL in Supabase to load the command SOS board.");
}

export async function updateSecurityPartnerSos(alertId, action) {
  if (!alertId) throw new Error("Missing SOS alert.");
  const { error } = await supabase.rpc("security_partner_sos_update", {
    p_alert_id: alertId,
    p_action: action,
  });
  if (error) throw error;
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out. Check your connection and try again.`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function resolveSelfUserId(selfUserId) {
  if (selfUserId) return selfUserId;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user?.id || null;
}

export async function listSosBoardAlerts({ organizationId, includeUnscoped, selfUserId } = {}) {
  const orgId = organizationId || getWorkingOrganizationId();
  const allowUnscoped = includeUnscoped ?? getWorkingOrganizationIncludeUnscoped();
  const selfId = await resolveSelfUserId(selfUserId);

  const keepRow = (row) => {
    if (selfId && row.residentId === selfId) return true;
    return sosRowInArea(row, orgId, allowUnscoped);
  };

  const loadRows = async () => {
    const { data, error } = await supabase.rpc("list_sos_board_alerts");
    if (!error && Array.isArray(data)) {
      return enrichSosBoardAlerts(data.map(normalizeSosBoardRow).filter(keepRow));
    }
    if (error && !isRpcNotFoundError(error)) {
      throw error;
    }
    const fallbackSelect =
      "id, created_at, incident_id, resident_id, trigger_type, escalation_level, organization_id, acknowledged_at, acknowledged_by_user_id, resolved_at, resolved_by_user_id";
    let query = supabase.from("sos_alerts").select(fallbackSelect).order("created_at", { ascending: false }).limit(100);
    query = scopeToOrganization(query, orgId, allowUnscoped);
    let { data: rows, error: fallbackErr } = await query;
    if (fallbackErr && /resolved_at/i.test(fallbackErr.message || "")) {
      let retryQuery = supabase
        .from("sos_alerts")
        .select(
          "id, created_at, incident_id, resident_id, trigger_type, escalation_level, organization_id, acknowledged_at, acknowledged_by_user_id"
        )
        .order("created_at", { ascending: false })
        .limit(100);
      retryQuery = scopeToOrganization(retryQuery, orgId, allowUnscoped);
      const retry = await retryQuery;
      rows = retry.data;
      fallbackErr = retry.error;
    }
    if (fallbackErr) throw fallbackErr;
    return enrichSosBoardAlerts(
      (rows || [])
        .map((row) =>
          normalizeSosBoardRow({
            ...row,
            incident_status: "approved",
            incident_description: "",
            incident_location: "",
            full_name: "",
            email: "",
            phone: "",
            address: "",
            home_address: "",
            avatar_url: null,
          })
        )
        .filter(keepRow)
    );
  };

  return withTimeout(loadRows(), 15000, "SOS board");
}

function sosRowInArea(row, organizationId, includeUnscoped) {
  if (!organizationId) return false;
  return belongsToActiveOrganization(
    { organization_id: row.organizationId },
    organizationId,
    includeUnscoped
  );
}

function normalizeSosBoardRow(row) {
  const address = householdAddressFrom(
    { address: row.address },
    { home_address: row.home_address }
  );
  return {
    id: row.id,
    createdAt: row.created_at,
    incidentId: row.incident_id,
    residentId: row.resident_id,
    triggerType: row.trigger_type,
    escalationLevel: row.escalation_level,
    acknowledgedAt: row.acknowledged_at || null,
    acknowledgedByUserId: row.acknowledged_by_user_id || null,
    acknowledgedByName: row.acknowledged_by_name || null,
    resolvedAt: row.resolved_at || null,
    resolvedByUserId: row.resolved_by_user_id || null,
    resolvedByName: row.resolved_by_name || null,
    organizationId: row.organization_id,
    organizationName: row.organization_name || null,
    suburbId: row.suburb_id || null,
    suburbName: row.suburb_name || null,
    incidentStatus: row.incident_status || "approved",
    description: row.incident_description || "",
    gpsLocation: row.incident_location || "",
    fullName: row.full_name || "Resident",
    email: row.email || "",
    phone: row.phone || "",
    address,
    avatarUrl: row.avatar_url || null,
  };
}

async function enrichSosBoardAlerts(alerts) {
  const withNames = await attachResponderNames(alerts);
  return attachNeighborhoodNames(withNames);
}

export function formatSosPlace(alert) {
  const address = String(alert?.address || "").trim();
  const neighborhood = String(alert?.organizationName || "").trim();
  if (!address && !neighborhood) return "Address not on profile";
  if (!neighborhood) return address;
  if (!address) return neighborhood;
  if (address.toLowerCase().includes(neighborhood.toLowerCase())) return address;
  return `${address} · ${neighborhood}`;
}

async function attachNeighborhoodNames(alerts) {
  const missingIds = [
    ...new Set(
      (alerts || [])
        .filter((alert) => alert.organizationId && !alert.organizationName)
        .map((alert) => alert.organizationId)
    ),
  ];
  if (missingIds.length === 0) return alerts;
  let data = [];
  try {
    data = await fetchInChunks(missingIds, (chunk) =>
      supabase.from("organizations").select("id, name").in("id", chunk)
    );
  } catch {
    return alerts;
  }
  if (!data.length) return alerts;
  const names = Object.fromEntries(
    data.map((row) => [row.id, String(row.name || "").trim()]).filter(([, name]) => name)
  );
  return alerts.map((alert) => ({
    ...alert,
    organizationName: alert.organizationName || names[alert.organizationId] || null,
  }));
}

async function attachResponderNames(alerts) {
  const missingIds = [
    ...new Set(
      (alerts || []).flatMap((alert) => {
        const ids = [];
        if (alert.acknowledgedByUserId && !alert.acknowledgedByName) {
          ids.push(alert.acknowledgedByUserId);
        }
        if (alert.resolvedByUserId && !alert.resolvedByName) {
          ids.push(alert.resolvedByUserId);
        }
        return ids;
      })
    ),
  ];
  if (missingIds.length === 0) return alerts;
  const labels = await fetchUserLabelMap(supabase, missingIds);
  return alerts.map((alert) => ({
    ...alert,
    acknowledgedByName:
      alert.acknowledgedByName || labels[alert.acknowledgedByUserId] || null,
    resolvedByName: alert.resolvedByName || labels[alert.resolvedByUserId] || null,
  }));
}

/** Active until a responder marks the SOS resolved — not based on incident moderation. */
export function isActiveSos(alert) {
  return !alert?.resolvedAt;
}

export async function deleteSosBoardAlert(alertId) {
  if (!alertId) throw new Error("Missing SOS alert.");
  const { error } = await supabase.rpc("delete_sos_board_alert", { p_alert_id: alertId });
  if (error) throw error;
}

function isMissingClientMessageId(error) {
  const blob = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return blob.includes("client_message_id");
}

async function broadcastSosToPatrolChat({ user, coords, description, orgId, homeAddress, card, localId }) {
  const senderName = card?.fullName || user.fullName || user.email || "Resident";
  const text = buildSosChatText({
    senderName,
    homeAddress,
    phone: card?.phone,
    description,
  });
  const safeName = sanitizeInput(senderName);
  const safeText = sanitizeInput(text);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const base = {
    sender_id: user.id,
    sender_name: safeName,
    sender_avatar: card?.avatarUrl || user.avatarUrl || null,
    text: safeText,
    is_critical: true,
    visibility: "patrol",
    expires_at: expiresAt,
    organization_id: orgId,
    ...(localId ? { client_message_id: String(localId) } : {}),
  };

  const insertSosChat = async (row) => {
    let attempt = { ...row };
    let { error } = await supabase.from("chat_messages").insert(attempt);
    if (error && attempt.client_message_id && isMissingClientMessageId(error)) {
      delete attempt.client_message_id;
      ({ error } = await supabase.from("chat_messages").insert(attempt));
    }
    if (error && /visibility|schema cache|42703/i.test(`${error.code || ""} ${error.message || ""}`)) {
      const fallback = { ...attempt };
      delete fallback.visibility;
      ({ error } = await supabase.from("chat_messages").insert(fallback));
    }
    return error;
  };

  try {
    if (coords) {
      const error = await insertSosChat({
        ...base,
        type: MessageType.LOCATION,
        location_lat: coords.latitude,
        location_lng: coords.longitude,
        location_address: homeAddress || "Current GPS location",
      });
      if (!error) return { ...shapeBroadcastResult(null), localId, text };
    }
    const textErr = await insertSosChat({
      ...base,
      type: MessageType.TEXT,
    });
    const result = { ...shapeBroadcastResult(textErr), localId, text };
    if (!result.ok) {
      console.warn("SOS chat broadcast failed:", result.error);
    }
    return result;
  } catch (err) {
    const result = { ...shapeBroadcastResult(err), localId, text };
    console.warn("SOS chat broadcast failed:", result.error);
    return result;
  }
}

async function deliverSosChat(args) {
  const localId = args.localId || newSosLocalId();
  const chat = await broadcastSosToPatrolChat({ ...args, localId });
  if (chat.ok) return chat;
  const item = buildSosChatQueueItem({
    localId,
    user: args.user,
    card: args.card,
    text: chat.text,
    coords: args.coords,
    homeAddress: args.homeAddress,
  });
  const queued = enqueueChatQueueItem(item);
  return { ...chat, queued: queued.ok === true, localId };
}

/** Retry only the patrol chat row. Does not create another SOS alert. */
export async function retrySosChatNow(args) {
  return deliverSosChat(args);
}
