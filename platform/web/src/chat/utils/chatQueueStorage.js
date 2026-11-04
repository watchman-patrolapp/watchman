export const CHAT_QUEUE_STORAGE_KEY = "chat_message_queue";
export const CHAT_QUEUE_CHANGED_EVENT = "watchman:chat-queue-changed";

const SOS_PENDING_SENT_KEY = "sos_pending_sent_v1";

let kick = null;

/** Runner registers this so a new item is tried without waiting for the interval. */
export function setChatQueueKick(fn) {
  kick = typeof fn === "function" ? fn : null;
}

export function readChatQueue() {
  if (typeof localStorage === "undefined") return [];
  try {
    const stored = localStorage.getItem(CHAT_QUEUE_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeChatQueue(queue) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CHAT_QUEUE_STORAGE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.warn("[chat] queue persist failed", error);
    return;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHAT_QUEUE_CHANGED_EVENT));
  }
}

export function enqueueChatQueueItem(message) {
  if (!message?.localId) return { ok: false, error: "missing localId" };
  const queue = readChatQueue();
  if (queue.some((row) => row.localId === message.localId)) {
    return { ok: true, duplicate: true };
  }
  const next = [...queue, { ...message, queuedAt: message.queuedAt || Date.now() }];
  writeChatQueue(next);
  const stored = readChatQueue();
  if (!stored.some((row) => row.localId === message.localId)) {
    return { ok: false, error: "Could not save the SOS for retry." };
  }
  kick?.();
  return { ok: true };
}

export function removeChatQueueItem(localId) {
  if (!localId) return;
  writeChatQueue(readChatQueue().filter((row) => row.localId !== localId));
}

function readSentMap() {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(SOS_PENDING_SENT_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function markSosPendingSent(localId, detail = {}) {
  if (!localId || typeof localStorage === "undefined") return;
  const map = readSentMap();
  map[localId] = {
    at: Date.now(),
    chatOk: detail.chatOk !== false,
    chatLocalId: detail.chatLocalId || null,
  };
  const entries = Object.entries(map).slice(-40);
  try {
    localStorage.setItem(SOS_PENDING_SENT_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* the queue row is the source of retry; the marker only blocks a duplicate send */
  }
}

export function readSosPendingSent(localId) {
  if (!localId) return null;
  return readSentMap()[localId] || null;
}
