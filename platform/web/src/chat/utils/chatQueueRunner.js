import { APP_CONFIG } from "./constants";
import { flushChatQueueItem } from "../services/chatQueueFlush";
import { SOS_PENDING_QUEUE_TYPE } from "../../utils/sosDelivery";
import {
  readChatQueue,
  removeChatQueueItem,
  markSosPendingSent,
  readSosPendingSent,
  setChatQueueKick,
} from "./chatQueueStorage";

let started = false;
let flushing = false;
let onlineOverride = null;

export function setChatQueueOnline(isOnline) {
  onlineOverride = typeof isOnline === "boolean" ? isOnline : null;
}

function canFlush() {
  if (onlineOverride === false) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  return true;
}

function pickNext(queue) {
  const sorted = [...queue].sort((a, b) => {
    if (a.is_emergency && !b.is_emergency) return -1;
    if (!a.is_emergency && b.is_emergency) return 1;
    return (a.queuedAt || 0) - (b.queuedAt || 0);
  });
  return sorted.find((row) => row?.localId) || null;
}

async function flushSosPending(item) {
  if (readSosPendingSent(item.localId)) {
    return { ok: true, duplicate: true };
  }
  const { triggerResidentSos } = await import("../../utils/residentSos");
  try {
    const result = await triggerResidentSos(item.sos || {});
    const chatOk = result?.chat?.ok !== false;
    markSosPendingSent(item.localId, {
      chatOk,
      chatLocalId: result?.chat?.localId || null,
    });
    return { ok: true, chatOk, chatLocalId: result?.chat?.localId || null };
  } catch (error) {
    return { ok: false, error };
  }
}

export async function flushQueuedChatItem(itemOrId) {
  const localId = typeof itemOrId === "string" ? itemOrId : itemOrId?.localId;
  if (!localId) return { ok: false, error: new Error("missing localId") };
  if (flushing) return { ok: false, skipped: true };
  const item = readChatQueue().find((row) => row.localId === localId);
  if (!item) return { ok: true, missing: true };

  flushing = true;
  let result = { ok: false };
  try {
    if (item.type === SOS_PENDING_QUEUE_TYPE) {
      result = await flushSosPending(item);
    } else {
      result = await flushChatQueueItem(item);
    }
    if (result.ok) removeChatQueueItem(item.localId);
  } catch (error) {
    result = { ok: false, error };
  } finally {
    flushing = false;
  }

  if (result.ok) {
    queueMicrotask(() => {
      void flushNextQueuedChatItem();
    });
  }
  return result;
}

export async function flushNextQueuedChatItem() {
  if (!canFlush()) return { ok: false, offline: true };
  if (flushing) return { ok: false, skipped: true };
  const item = pickNext(readChatQueue());
  if (!item) return { ok: true, empty: true };
  return flushQueuedChatItem(item);
}

export async function retryQueuedItem(localId) {
  const item = readChatQueue().find((row) => row.localId === localId);
  if (!item) return { ok: true, missing: true };
  let result = await flushQueuedChatItem(item);
  if (result.skipped) {
    await new Promise((resolve) => {
      setTimeout(resolve, 400);
    });
    const again = readChatQueue().find((row) => row.localId === localId);
    if (!again) return { ok: true, missing: true };
    result = await flushQueuedChatItem(again);
  }
  return result;
}

export function installChatQueueRunner() {
  if (started || typeof window === "undefined") return;
  started = true;
  const tick = () => {
    void flushNextQueuedChatItem();
  };
  setChatQueueKick(tick);
  window.addEventListener("online", tick);
  window.setInterval(tick, APP_CONFIG.OFFLINE_RETRY_INTERVAL_MS);
}
