import { MessageType } from './constants.js';
import { parsePatrolTime } from '../../utils/watchTime.js';

export function localDateTimeParts(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return { date: `${y}-${mo}-${day}`, time: `${h}:${min}` };
}

export function summarizeMessageForReply(msg) {
  if (!msg) return '';
  if (msg.text?.trim()) return msg.text.trim();
  if (msg.type === MessageType.IMAGE) return '[Image]';
  if (msg.type === MessageType.VOICE) return '[Voice note]';
  if (msg.type === MessageType.LOCATION) return '[Location]';
  return '[Message]';
}

/** Merge realtime INSERT with optimistic row (same user may wait on geocode + slow network). */
export function findExistingMessageIndexForRealtime(prev, newMessage) {
  const byId = prev.findIndex((m) => m.id != null && newMessage.id != null && m.id === newMessage.id);
  if (byId !== -1) return byId;

  if (newMessage.client_message_id) {
    const byClient = prev.findIndex(
      (m) =>
        m.localId &&
        String(m.localId) === String(newMessage.client_message_id) &&
        String(m.sender_id) === String(newMessage.sender_id)
    );
    if (byClient !== -1) return byClient;
  }

  return prev.findIndex((m) => {
    if (!m.localId) return false;
    if (m.id != null) return false;
    if (String(m.sender_id) !== String(newMessage.sender_id)) return false;
    if (m.type !== newMessage.type) return false;

    if (
      m.type === MessageType.LOCATION &&
      newMessage.location_lat != null &&
      newMessage.location_lng != null
    ) {
      const dLat = Math.abs(Number(m.location_lat) - Number(newMessage.location_lat));
      const dLng = Math.abs(Number(m.location_lng) - Number(newMessage.location_lng));
      if (Number.isFinite(dLat) && Number.isFinite(dLng) && dLat < 1e-5 && dLng < 1e-5) {
        return true;
      }
      return false;
    }

    if (m.type === MessageType.TEXT) {
      if (String(m.text || '') !== String(newMessage.text || '')) return false;
    } else if (
      (m.type === MessageType.IMAGE || m.type === MessageType.VOICE) &&
      m.media_url &&
      newMessage.media_url
    ) {
      if (String(m.media_url) !== String(newMessage.media_url)) return false;
    }

    const t1 = parsePatrolTime(m.localTimestamp)?.getTime() || Number(m.localTimestamp) || 0;
    const t2 = parsePatrolTime(newMessage.created_at)?.getTime() || 0;
    return Number.isFinite(t1) && Number.isFinite(t2) && Math.abs(t1 - t2) < 120_000;
  });
}
