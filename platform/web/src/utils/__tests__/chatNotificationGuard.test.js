import test from "node:test";
import assert from "node:assert/strict";
import { CHAT_ALERT_LEEWAY_MS, chatNotificationTag, isFreshChatMessage } from "../chatNotificationGuard.js";

const started = Date.parse("2026-11-01T01:00:00+02:00");

test("old messages are never fresh", () => {
  assert.equal(isFreshChatMessage({ created_at: "2026-07-01T10:00:00+02:00" }, started), false);
  assert.equal(isFreshChatMessage({ created_at: new Date(started - CHAT_ALERT_LEEWAY_MS - 1).toISOString() }, started), false);
});

test("messages after start (or within leeway) are fresh", () => {
  assert.equal(isFreshChatMessage({ created_at: new Date(started + 5000).toISOString() }, started), true);
  assert.equal(isFreshChatMessage({ created_at: new Date(started - 30000).toISOString() }, started), true);
});

test("missing or invalid created_at is not fresh", () => {
  assert.equal(isFreshChatMessage({}, started), false);
  assert.equal(isFreshChatMessage({ created_at: "nope" }, started), false);
  assert.equal(isFreshChatMessage(null, started), false);
});

test("stable tag per message id", () => {
  assert.equal(chatNotificationTag({ id: 42 }), "chat-msg-42");
  assert.equal(chatNotificationTag({ id: "abc" }), chatNotificationTag({ id: "abc" }));
  assert.equal(chatNotificationTag({}), "chat-msg");
});
