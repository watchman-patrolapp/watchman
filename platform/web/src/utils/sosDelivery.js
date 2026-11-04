/** Seconds the resident can cancel before an SOS is sent. */
export const SOS_CONFIRM_SECONDS = 5;

/** Chat-queue item type for an SOS that could not be inserted while offline. */
export const SOS_PENDING_QUEUE_TYPE = "sos_pending";

/** Same patrol-chat audience as the live SOS broadcast. */
export const SOS_CHAT_VISIBILITY = "patrol";

export function shapeBroadcastResult(error) {
  if (!error) return { ok: true };
  const message =
    typeof error === "string"
      ? error.trim()
      : String(error.message || error.error_description || "").trim();
  return {
    ok: false,
    error: message || "Patrol chat did not get the SOS.",
  };
}

/**
 * @returns {"success" | "chat_failed" | "failed"}
 * `failed` wins when the SOS row was not recorded, even if a chat send was attempted.
 */
export function classifySosDelivery({ recorded = false, chatOk = false } = {}) {
  if (!recorded) return "failed";
  if (!chatOk) return "chat_failed";
  return "success";
}

export function initialSosSendState() {
  return {
    phase: "idle",
    secondsLeft: SOS_CONFIRM_SECONDS,
    skipped: false,
  };
}

/**
 * Confirm countdown. A second `arm` while confirming sends immediately.
 * Cancel only applies during the countdown.
 */
export function reduceSosSend(state, action) {
  const current = state || initialSosSendState();
  switch (action?.type) {
    case "arm": {
      if (current.phase === "sending") return current;
      if (current.phase === "confirming") {
        return { ...current, phase: "sending", secondsLeft: 0, skipped: true };
      }
      return {
        phase: "confirming",
        secondsLeft: SOS_CONFIRM_SECONDS,
        skipped: false,
      };
    }
    case "tick": {
      if (current.phase !== "confirming") return current;
      const left = Number(current.secondsLeft) || 0;
      if (left <= 1) {
        return { ...current, phase: "sending", secondsLeft: 0, skipped: false };
      }
      return { ...current, secondsLeft: left - 1 };
    }
    case "cancel": {
      if (current.phase !== "confirming") return current;
      return initialSosSendState();
    }
    case "success":
      return { ...current, phase: "success", secondsLeft: 0 };
    case "chat_failed":
      return { ...current, phase: "chat_failed", secondsLeft: 0 };
    case "failed":
      return { ...current, phase: "failed", secondsLeft: 0 };
    case "offline_queued":
      return { ...current, phase: "offline_queued", secondsLeft: 0 };
    case "reset":
      return initialSosSendState();
    default:
      return current;
  }
}

export function countdownLabel(secondsLeft) {
  const n = Math.max(0, Number(secondsLeft) || 0);
  return `Sending SOS in ${n}…`;
}

export function isNavigatorOffline(nav) {
  const target = nav === undefined ? (typeof navigator !== "undefined" ? navigator : undefined) : nav;
  return target?.onLine === false;
}

/** True when localStorage can take a queued SOS. A thrown write means it cannot. */
export function canUseOfflineSosQueue(storage) {
  const target = storage === undefined ? globalThis.localStorage : storage;
  if (!target) return false;
  const key = "__watchman_sos_probe__";
  try {
    target.setItem(key, "1");
    target.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function buildSosChatText({ senderName, homeAddress, phone, description } = {}) {
  const name = String(senderName || "Resident").trim() || "Resident";
  const addressLine = homeAddress ? `Home: ${homeAddress}.` : "";
  const phoneLine = phone ? `Phone: ${phone}.` : "";
  const detail = String(description || "").trim();
  return `SOS — ${name} needs help now. ${addressLine} ${phoneLine} ${detail}`
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSosChatQueueItem({
  localId,
  user,
  card,
  text,
  coords,
  homeAddress,
  now = Date.now(),
} = {}) {
  if (!localId) {
    throw new Error("SOS chat queue item needs a localId.");
  }
  const item = {
    localId,
    sender_id: user?.id || null,
    sender_name: card?.fullName || user?.fullName || user?.email || "Resident",
    sender_avatar: card?.avatarUrl || user?.avatarUrl || null,
    text: String(text || ""),
    is_critical: true,
    is_emergency: true,
    visibility: SOS_CHAT_VISIBILITY,
    type: coords ? "location" : "text",
    queuedAt: now,
  };
  if (coords) {
    item.location_lat = coords.latitude;
    item.location_lng = coords.longitude;
    item.location_address = homeAddress || "Current GPS location";
  }
  return item;
}

export function buildPendingSosQueueItem({
  localId,
  user,
  organizationId,
  notes,
  triggerType,
  coords,
  now = Date.now(),
} = {}) {
  if (!localId) {
    throw new Error("Queued SOS needs a localId.");
  }
  return {
    localId,
    type: SOS_PENDING_QUEUE_TYPE,
    is_emergency: true,
    is_critical: true,
    visibility: SOS_CHAT_VISIBILITY,
    queuedAt: now,
    sos: {
      user: {
        id: user?.id || null,
        fullName: user?.fullName || "",
        email: user?.email || "",
        phone: user?.phone || "",
        address: user?.address || "",
        avatarUrl: user?.avatarUrl || null,
        organizationId: user?.organizationId || organizationId || null,
      },
      organizationId: organizationId || null,
      notes: String(notes || ""),
      triggerType: triggerType || "hold",
      coords: coords || null,
    },
  };
}

export function newSosLocalId(now = Date.now(), rand = Math.random()) {
  return `sos-${now}-${Math.floor(rand * 1e9).toString(16)}`;
}

/** Alt text for a nearby-threat photo. Uses the risk (type) and sighting (description). */
export function threatPhotoAlt(profile) {
  const name = String(profile?.primary_name || "Person").trim() || "Person";
  const risk = String(profile?.risk_level || "").trim().toLowerCase();
  const riskLabel = risk === "critical" ? "critical threat" : "high-risk threat";
  const detail = String(profile?._threatMatch?.label || profile?.last_seen_location || "").trim();
  if (detail) return `${name}, ${riskLabel}: ${detail}`;
  return `${name}, ${riskLabel}`;
}
