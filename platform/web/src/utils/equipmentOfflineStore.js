import { Preferences } from "@capacitor/preferences";
import { equipmentErrorMessage } from "./equipment";
import {
  confirmHandoverGiverWithClient,
  confirmEquipmentStillHeld,
  countEquipmentUnit,
  reportEquipmentIssueWithClient,
  requestEquipmentReturn,
  submitEquipmentPaperClaim,
} from "./equipmentReporting";
import {
  attentionItems,
  createQueuedAction,
  dismissQueuedAction,
  isRetryableEquipmentError,
  pendingItems,
  settleQueuedAction,
} from "./equipmentReportingMeta";

const QUEUE_KEY = "equipment_queue_v1";
const CACHE_KEY = "equipment_read_cache_v1";

let flushing = false;

async function readJson(key, fallback) {
  try {
    const { value } = await Preferences.get({ key });
    if (!value) return fallback;
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(key, value) {
  await Preferences.set({ key, value: JSON.stringify(value) });
}

export async function loadEquipmentQueue() {
  const rows = await readJson(QUEUE_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

async function saveEquipmentQueue(queue) {
  await writeJson(QUEUE_KEY, queue);
  return queue;
}

export async function rememberEquipmentRead(bucket, value) {
  const cache = await readJson(CACHE_KEY, {});
  cache[bucket] = { savedAt: new Date().toISOString(), value };
  await writeJson(CACHE_KEY, cache);
}

export async function readEquipmentCache(bucket) {
  const cache = await readJson(CACHE_KEY, {});
  return cache[bucket]?.value ?? null;
}

async function callQueued(item) {
  const args = item.args || {};
  const id = item.client_event_id;
  const at = item.occurred_at;
  switch (item.action) {
    case "return_request":
      return requestEquipmentReturn(args.loanId, id, at);
    case "report_issue":
      return reportEquipmentIssueWithClient({ ...args, clientEventId: id, occurredAt: at });
    case "handover_giver":
      return confirmHandoverGiverWithClient(args.transferId, id, at);
    case "stocktake_count":
      return countEquipmentUnit({ ...args, clientEventId: id, occurredAt: at });
    case "still_held":
      return confirmEquipmentStillHeld(args.unitId, id, at);
    case "paper_claim":
      return submitEquipmentPaperClaim({ ...args, clientEventId: id, occurredAt: at });
    default:
      return { data: null, error: { message: "That saved action is no longer supported." } };
  }
}

async function dispatch(item) {
  try {
    const { data, error } = await callQueued(item);
    if (!error) return { ok: true, data };
    return {
      ok: false,
      data: null,
      retryable: isRetryableEquipmentError(error),
      message: equipmentErrorMessage(error, "That saved action could not be sent."),
    };
  } catch {
    return { ok: false, data: null, retryable: true, message: "Saved on this phone. It will send when you are back online." };
  }
}

export async function flushEquipmentQueue() {
  if (flushing) return loadEquipmentQueue();
  flushing = true;
  try {
    let queue = await loadEquipmentQueue();
    for (const item of [...queue].filter((row) => !row.needs_attention)) {
      const outcome = await dispatch(item);
      queue = settleQueuedAction(queue, item.client_event_id, outcome);
      await saveEquipmentQueue(queue);
    }
    return queue;
  } finally {
    flushing = false;
  }
}

/** Run now, or keep the action on this phone when the network is down. */
export async function runEquipmentAction(action, args) {
  const item = createQueuedAction(action, args);
  const online = typeof navigator === "undefined" || navigator.onLine;
  if (!online) {
    const queue = await loadEquipmentQueue();
    await saveEquipmentQueue([...queue, item]);
    return { data: { queued: true }, error: null };
  }
  const outcome = await dispatch(item);
  if (outcome.ok) return { data: outcome.data ?? { ok: true }, error: null };
  if (outcome.retryable) {
    const queue = await loadEquipmentQueue();
    await saveEquipmentQueue([...queue, { ...item, attempts: 1, last_error: outcome.message, needs_attention: false }]);
    return { data: { queued: true }, error: null };
  }
  return { data: null, error: { message: outcome.message } };
}

/** Sign-out drops saved gear reads and unsent actions so they cannot run as the next person. */
export async function clearEquipmentOfflineState() {
  try {
    await Preferences.remove({ key: QUEUE_KEY });
    await Preferences.remove({ key: CACHE_KEY });
  } catch {
    /* Preferences can be missing in a plain browser test */
  }
}

export async function dismissEquipmentAction(clientEventId) {
  const queue = dismissQueuedAction(await loadEquipmentQueue(), clientEventId);
  return saveEquipmentQueue(queue);
}

export { attentionItems, pendingItems };
