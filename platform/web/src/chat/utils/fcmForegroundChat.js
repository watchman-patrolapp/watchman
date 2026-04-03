import { detectCriticalMessage } from './security';
import { MessageType } from './constants';

/**
 * Parse FCM `onMessage` payload (web) into an overlay queue item.
 * Expects `notify-chat-message` data: tag, senderId, messageId (optional), body via notification.
 *
 * @param {object} payload Firebase `onMessage` payload (`notification` + string `data` fields).
 * @param {string} currentUserId
 * @returns {{ key: string, message: object, receivedAt: number } | null}
 */
export function parseChatForegroundPayload(payload, currentUserId) {
  if (!payload || !currentUserId) return null;

  const data = payload.data || {};
  const n = payload.notification || {};

  const tag = String(data.tag ?? '');
  if (tag && tag !== 'emergency_chat') return null;

  const senderId = String(data.senderId || data.sender_id || '').trim();
  if (!senderId || senderId === String(currentUserId)) return null;

  const rawBody = String(n.body || data.body || '').trim();
  const rawTitle = String(n.title || data.title || '').trim();

  let sender_name = 'Someone';
  let text = rawBody;

  const colon = rawBody.indexOf(':');
  if (colon > 0 && colon < 120) {
    const left = rawBody.slice(0, colon).trim();
    const right = rawBody.slice(colon + 1).trim();
    if (left && right) {
      sender_name = left;
      text = right;
    }
  }

  if (sender_name === 'Someone' && rawTitle) {
    const m = rawTitle.match(/Watchman\s*[—–-]\s*(.+)/i);
    if (m?.[1]) sender_name = m[1].trim();
  }

  const messageId = String(data.messageId || data.message_id || '').trim();
  const key = messageId || `fcm-${Date.now()}-${senderId}`;

  const message = {
    ...(messageId ? { id: messageId } : {}),
    sender_id: senderId,
    sender_name,
    text: text || rawBody || 'New message',
    is_critical: detectCriticalMessage(text || rawBody),
    type: MessageType.TEXT,
  };

  return {
    key,
    message,
    receivedAt: Date.now(),
  };
}
