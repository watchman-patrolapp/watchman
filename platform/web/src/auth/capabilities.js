import { canPostAreaBroadcast } from "./roleMatrix";

/** Per-organization capabilities granted on top of users.role (P0a org_capability_grants). */
export const CAPABILITIES = Object.freeze({
  RESIDENT_BROADCASTER: "resident_broadcaster",
  RESIDENT_MODERATOR: "resident_moderator",
  EQUIPMENT_CUSTODIAN: "equipment_custodian",
});

export const CAPABILITY_LABELS = Object.freeze({
  [CAPABILITIES.RESIDENT_BROADCASTER]: "Street rep",
  [CAPABILITIES.RESIDENT_MODERATOR]: "Moderator",
  [CAPABILITIES.EQUIPMENT_CUSTODIAN]: "Custodian",
});

export const ALL_CAPABILITIES = Object.freeze(Object.values(CAPABILITIES));

export function normalizeCapability(cap) {
  return String(cap ?? "").trim().toLowerCase().replace(/-/g, "_");
}

export function capabilityLabel(cap) {
  return CAPABILITY_LABELS[normalizeCapability(cap)] ?? "";
}

/** Same rule as public.user_has_org_capability: a moderator can also broadcast. */
export function capabilityImplies(held, wanted) {
  const h = normalizeCapability(held);
  const w = normalizeCapability(wanted);
  if (!h || !w) return false;
  if (h === w) return true;
  return w === CAPABILITIES.RESIDENT_BROADCASTER && h === CAPABILITIES.RESIDENT_MODERATOR;
}

export function hasCapability(caps, wanted) {
  if (!Array.isArray(caps)) return false;
  return caps.some((held) => capabilityImplies(held, wanted));
}

export function canPostAreaBroadcastWithCaps(role, platformRole, caps) {
  return canPostAreaBroadcast(role, platformRole) || hasCapability(caps, CAPABILITIES.RESIDENT_BROADCASTER);
}
