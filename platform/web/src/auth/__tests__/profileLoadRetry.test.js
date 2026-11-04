import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROFILE_LOAD_MAX_ATTEMPTS,
  PROFILE_LOAD_SCHEDULE,
  PROFILE_LOAD_SKELETON_CAP_MS,
  nextProfileLoadStep,
  profileAccessView,
  profileLoadAttemptPlan,
  profileLoadBudgetMs,
} from "../profileLoadRetry.js";

test("three attempts share a 10 second budget", () => {
  assert.equal(PROFILE_LOAD_SCHEDULE.length, PROFILE_LOAD_MAX_ATTEMPTS);
  assert.equal(PROFILE_LOAD_MAX_ATTEMPTS, 3);
  assert.equal(profileLoadBudgetMs(), PROFILE_LOAD_SKELETON_CAP_MS);
  assert.equal(PROFILE_LOAD_SKELETON_CAP_MS, 10_000);
  assert.equal(profileLoadAttemptPlan(0).delayMs, 0);
  assert.ok(profileLoadAttemptPlan(0).timeoutMs > 0);
  assert.ok(profileLoadAttemptPlan(1).delayMs > 0);
  assert.ok(profileLoadAttemptPlan(2).delayMs > 0);
  assert.equal(profileLoadAttemptPlan(3), null);
  assert.equal(profileLoadAttemptPlan(-1), null);
  assert.equal(profileLoadAttemptPlan(1.5), null);
});

test("online failures retry with backoff then stop", () => {
  const first = nextProfileLoadStep(0, true);
  assert.equal(first.action, "retry");
  assert.equal(first.attemptIndex, 1);
  assert.equal(first.delayMs, PROFILE_LOAD_SCHEDULE[1].delayMs);
  assert.equal(first.timeoutMs, PROFILE_LOAD_SCHEDULE[1].timeoutMs);

  const second = nextProfileLoadStep(1, true);
  assert.equal(second.action, "retry");
  assert.equal(second.attemptIndex, 2);
  assert.ok(second.delayMs > 0);

  assert.deepEqual(nextProfileLoadStep(2, true), { action: "fail", code: "exhausted" });
  assert.deepEqual(nextProfileLoadStep(3, true), { action: "fail", code: "exhausted" });
});

test("offline skips remaining retries", () => {
  assert.deepEqual(nextProfileLoadStep(0, false), { action: "fail", code: "offline" });
  assert.deepEqual(nextProfileLoadStep(1, false), { action: "fail", code: "offline" });
});

test("access view stays pending, then errors, and prefers offline", () => {
  assert.equal(profileAccessView({ elapsedMs: 0 }), "pending");
  assert.equal(profileAccessView({ elapsedMs: PROFILE_LOAD_SKELETON_CAP_MS - 1 }), "pending");
  assert.equal(profileAccessView({ elapsedMs: PROFILE_LOAD_SKELETON_CAP_MS }), "error");
  assert.equal(
    profileAccessView({ elapsedMs: PROFILE_LOAD_SKELETON_CAP_MS, online: false }),
    "offline"
  );
  assert.equal(
    profileAccessView({ profileError: { code: "exhausted" }, elapsedMs: 0, online: true }),
    "error"
  );
  assert.equal(
    profileAccessView({ profileError: { code: "offline" }, elapsedMs: 0, online: true }),
    "offline"
  );
  assert.equal(
    profileAccessView({ profileError: { code: "exhausted" }, online: false, elapsedMs: 0 }),
    "offline"
  );
  assert.equal(
    profileAccessView({
      hydrated: true,
      elapsedMs: 99_000,
      profileError: { code: "exhausted" },
      online: false,
    }),
    "ready"
  );
  assert.equal(profileAccessView({ bypass: true, elapsedMs: 0 }), "ready");
});
