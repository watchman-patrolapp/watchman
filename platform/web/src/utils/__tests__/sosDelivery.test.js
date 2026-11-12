import test from "node:test";
import assert from "node:assert/strict";
import {
  SOS_PENDING_QUEUE_TYPE,
  shapeBroadcastResult,
  classifySosDelivery,
  initialSosSendState,
  reduceSosSend,
  isNavigatorOffline,
  canUseOfflineSosQueue,
  buildSosChatText,
  buildSosChatQueueItem,
  buildPendingSosQueueItem,
  threatPhotoAlt,
} from "../sosDelivery.js";

test("shapeBroadcastResult distinguishes success from a chat error", () => {
  assert.deepEqual(shapeBroadcastResult(null), { ok: true });
  assert.deepEqual(shapeBroadcastResult(undefined), { ok: true });
  assert.deepEqual(shapeBroadcastResult(new Error("row level security")), {
    ok: false,
    error: "row level security",
  });
  assert.deepEqual(shapeBroadcastResult("  insert failed  "), {
    ok: false,
    error: "insert failed",
  });
  assert.deepEqual(shapeBroadcastResult({}), {
    ok: false,
    error: "Patrol chat did not get the SOS.",
  });
  assert.equal(shapeBroadcastResult({ message: "" }).ok, false);
});

test("classifySosDelivery has three outcomes and recorded-false wins", () => {
  assert.equal(classifySosDelivery({ recorded: true, chatOk: true }), "success");
  assert.equal(classifySosDelivery({ recorded: true, chatOk: false }), "chat_failed");
  assert.equal(classifySosDelivery({ recorded: false, chatOk: false }), "failed");
  assert.equal(classifySosDelivery({ recorded: false, chatOk: true }), "failed");
  assert.equal(classifySosDelivery({}), "failed");
});

test("arm starts sending immediately with no confirm window", () => {
  const state = reduceSosSend(initialSosSendState(), { type: "arm" });
  assert.equal(state.phase, "sending");
  const again = reduceSosSend(state, { type: "arm" });
  assert.equal(again, state);
});

test("cancel does not interrupt an in-flight send", () => {
  const sending = reduceSosSend(initialSosSendState(), { type: "arm" });
  assert.equal(sending.phase, "sending");
  assert.equal(reduceSosSend(sending, { type: "cancel" }).phase, "sending");
  assert.deepEqual(reduceSosSend(initialSosSendState(), { type: "cancel" }), initialSosSendState());
});

test("delivery actions set the three UI phases", () => {
  const sending = reduceSosSend(initialSosSendState(), { type: "arm" });
  assert.equal(reduceSosSend(sending, { type: "success" }).phase, "success");
  assert.equal(reduceSosSend(sending, { type: "chat_failed" }).phase, "chat_failed");
  assert.equal(reduceSosSend(sending, { type: "failed" }).phase, "failed");
  assert.equal(reduceSosSend(sending, { type: "offline_queued" }).phase, "offline_queued");
  assert.equal(reduceSosSend(sending, { type: "reset" }).phase, "idle");
  assert.equal(reduceSosSend(sending, { type: "unknown" }), sending);
});

test("offline helpers", () => {
  assert.equal(isNavigatorOffline({ onLine: false }), true);
  assert.equal(isNavigatorOffline({ onLine: true }), false);
  assert.equal(isNavigatorOffline(null), false);

  const mem = new Map();
  const storage = {
    setItem(key, value) {
      mem.set(key, value);
    },
    removeItem(key) {
      mem.delete(key);
    },
  };
  assert.equal(canUseOfflineSosQueue(storage), true);
  assert.equal(mem.size, 0);
  assert.equal(canUseOfflineSosQueue(null), false);
  assert.equal(
    canUseOfflineSosQueue({
      setItem() {
        throw new Error("denied");
      },
      removeItem() {},
    }),
    false
  );
});

test("chat queue item keeps the patrol audience and prefers a location row", () => {
  const text = buildSosChatText({
    senderName: "Amina Naidoo",
    homeAddress: "12 Palm Street",
    phone: "0820000000",
    description: "Gate is open",
  });
  assert.match(text, /^SOS — Amina Naidoo needs help now\./);
  assert.match(text, /Home: 12 Palm Street\./);
  assert.doesNotMatch(text, /\s{2}/);

  const item = buildSosChatQueueItem({
    localId: "sos-1",
    user: { id: "user-1", fullName: "Amina Naidoo" },
    card: { fullName: "Amina Naidoo", phone: "0820000000" },
    text,
    coords: { latitude: -33.9, longitude: 25.6 },
    homeAddress: "12 Palm Street",
    now: 100,
  });
  assert.equal(item.localId, "sos-1");
  assert.equal(item.visibility, "patrol");
  assert.equal(item.is_critical, true);
  assert.equal(item.is_emergency, true);
  assert.equal(item.type, "location");
  assert.equal(item.location_lat, -33.9);
  assert.equal(item.queuedAt, 100);
  assert.equal(item.sender_id, "user-1");

  const textOnly = buildSosChatQueueItem({
    localId: "sos-2",
    user: { id: "user-1" },
    text: "SOS",
    now: 100,
  });
  assert.equal(textOnly.type, "text");
  assert.equal(textOnly.location_lat, undefined);

  assert.throws(() => buildSosChatQueueItem({ user: { id: "u" } }), /localId/);
});

test("pending SOS queue item is replayed later and does not add recipients", () => {
  const item = buildPendingSosQueueItem({
    localId: "sos-off-1",
    user: { id: "user-9", fullName: "Sam", organizationId: "org-1" },
    organizationId: "org-1",
    notes: "Medical",
    triggerType: "hold",
    coords: { latitude: 1, longitude: 2 },
    now: 50,
  });
  assert.equal(item.type, SOS_PENDING_QUEUE_TYPE);
  assert.equal(item.visibility, "patrol");
  assert.equal(item.is_emergency, true);
  assert.equal(item.sos.organizationId, "org-1");
  assert.equal(item.sos.notes, "Medical");
  assert.equal(item.sos.user.id, "user-9");
  assert.deepEqual(item.sos.coords, { latitude: 1, longitude: 2 });
  assert.equal(item.recipients, undefined);
  assert.equal(item.sos.recipients, undefined);
  assert.throws(() => buildPendingSosQueueItem({}), /localId/);
});

test("threat photo alt uses the risk and the sighting description", () => {
  assert.equal(
    threatPhotoAlt({
      primary_name: "Unknown male",
      risk_level: "critical",
      _threatMatch: { label: "Seen at the spaza" },
    }),
    "Unknown male, critical threat: Seen at the spaza"
  );
  assert.equal(
    threatPhotoAlt({ primary_name: "J. Nkosi", risk_level: "high", last_seen_location: "Main Road" }),
    "J. Nkosi, high-risk threat: Main Road"
  );
  assert.equal(threatPhotoAlt({}), "Person, high-risk threat");
});
