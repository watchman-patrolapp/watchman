/**
 * Notification kinds for G6 preferences.
 * MANDATORY_NOTIFICATION_KINDS must match public.is_mandatory_notification_kind()
 * in platform/supabase/migrations/20261030010000_notification_prefs.sql.
 * Detailed in-app kinds (membership_verified, etc.) roll up to a preference kind
 * via notificationPrefKind(), mirroring public.notification_pref_kind().
 */

export const MANDATORY_NOTIFICATION_KINDS = [
  "sos",
  "panic",
  "emergency",
  "security",
  "account",
  "equipment_overdue_escalation",
];

/** Kinds shown in Profile -> Notifications, in display order. */
export const NOTIFICATION_KINDS = [
  { kind: "sos", label: "SOS and street alerts", description: "Emergency chat SOS and panic alerts." },
  { kind: "emergency", label: "Emergency alerts", description: "Urgent safety messages for your area." },
  { kind: "security", label: "Security alerts", description: "Security company and account safety notices." },
  { kind: "account", label: "Account", description: "Sign-in, password and account changes." },
  { kind: "equipment_overdue_escalation", label: "Overdue equipment (24 h)", description: "Escalations for equipment not returned." },
  { kind: "broadcast", label: "Neighbourhood notices", description: "Notices posted to your area." },
  { kind: "chat", label: "Chat messages", description: "Non-SOS messages in the watch chat." },
  { kind: "incident_status", label: "Report updates", description: "Status changes on incidents you reported." },
  { kind: "vouch", label: "Neighbour vouches", description: "When a neighbour vouches for you." },
  { kind: "membership", label: "Security membership", description: "Verified, rejected or transferred client claims." },
  { kind: "moderation", label: "Moderation", description: "When something you posted is hidden or restored." },
  { kind: "info", label: "Other updates", description: "General app notices." },
];

/** Every kind string the server may send (SQL + edge functions). */
export const KNOWN_NOTIFICATION_KINDS = [
  ...NOTIFICATION_KINDS.map((row) => row.kind),
  "panic",
  "membership_verified",
  "membership_rejected",
  "membership_transferred",
  "membership_lost",
  "membership_won",
];

export function notificationPrefKind(kind) {
  const k = String(kind || "").trim().toLowerCase() || "info";
  return k.startsWith("membership_") ? "membership" : k;
}

export function isMandatoryNotificationKind(kind) {
  return MANDATORY_NOTIFICATION_KINDS.includes(notificationPrefKind(kind));
}
