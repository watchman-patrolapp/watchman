/**
 * Guards for chat alerts so old messages never fire a notification
 * (e.g. the newest message in the area after a hard reload).
 */

/** Allowed clock skew between this device and the database. */
export const CHAT_ALERT_LEEWAY_MS = 60 * 1000;

function toMs(value) {
  if (value == null || value === "") return NaN;
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
}

/**
 * True when the message was created after the listener started (minus leeway).
 * Messages without a valid created_at are treated as not fresh.
 */
export function isFreshChatMessage(message, startedAtMs, leewayMs = CHAT_ALERT_LEEWAY_MS) {
  const created = toMs(message?.created_at);
  if (!Number.isFinite(created) || !Number.isFinite(startedAtMs)) return false;
  return created >= startedAtMs - leewayMs;
}

/** Stable tag so a repeated alert replaces the earlier notification instead of stacking. */
export function chatNotificationTag(message) {
  return message?.id != null ? `chat-msg-${message.id}` : "chat-msg";
}
