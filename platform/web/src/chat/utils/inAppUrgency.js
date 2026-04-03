import { detectCriticalMessage } from './security';
import { MessageType } from './constants';

/** Max queued foreground notifications (FIFO drops oldest). */
export const INCOMING_OVERLAY_QUEUE_MAX = 5;

/**
 * @param {{ queue: Array<{ key: string, message: object, receivedAt: number }>, index: number }} prev
 * @param {{ key: string, message: object, receivedAt: number }} item
 * @returns {{ queue: Array<{ key: string, message: object, receivedAt: number }>, index: number }}
 */
export function reduceIncomingOverlayEnqueue(prev, item) {
  if (prev.queue.some((q) => q.key === item.key)) return prev;
  let queue = [...prev.queue, item];
  while (queue.length > INCOMING_OVERLAY_QUEUE_MAX) queue.shift();
  const index = queue.length - 1;
  return { queue, index };
}

/** Non-critical phrases that still warrant elevated (amber) treatment in the overlay. */
const ELEVATED_PHRASES = [
  'suspicious',
  'domestic',
  'burglary',
  'robbery',
  'stolen',
  'vehicle',
  'shots',
  'shooting',
  'gunshots',
  'fight',
  'break-in',
  'breaking in',
  'lurking',
  'prowler',
  'dog attack',
  'fire',
  'smoke',
  'accident',
  'crash',
  'injured',
  '911',
];

/**
 * Preview text for overlay (matches MessageList / composer semantics).
 * @param {object} message
 * @returns {string}
 */
export function getIncomingPreviewText(message) {
  if (!message) return '';
  if (message.text?.trim()) return message.text.trim();
  if (message.type === MessageType.IMAGE) return '[Image]';
  if (message.type === MessageType.VOICE) return '[Voice note]';
  if (message.type === MessageType.LOCATION) return '[Location]';
  return '[Message]';
}

/**
 * @param {string} name
 * @returns {string}
 */
export function getSenderInitials(name) {
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * @param {number} receivedAt
 * @returns {string}
 */
export function formatShortRelativeTime(receivedAt) {
  const sec = Math.floor((Date.now() - receivedAt) / 1000);
  if (sec < 45) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return new Date(receivedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * @param {object} message
 * @returns {{ tier: 'critical' | 'elevated' | 'standard', preview: string, label: string }}
 */
export function classifyIncomingUrgency(message) {
  const preview = getIncomingPreviewText(message);
  const lower = preview.toLowerCase();

  const critical =
    Boolean(message?.is_critical) || detectCriticalMessage(preview);

  if (critical) {
    return {
      tier: 'critical',
      preview,
      label: 'Critical',
    };
  }

  const elevated = ELEVATED_PHRASES.some((p) => lower.includes(p));
  if (elevated) {
    return {
      tier: 'elevated',
      preview,
      label: 'Elevated',
    };
  }

  return {
    tier: 'standard',
    preview,
    label: 'Message',
  };
}
