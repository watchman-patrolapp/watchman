import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FLEXIBLE_CHECK_INTERVAL_MS,
  INSTALL_STATUS_DOWNLOADED,
  UPDATE_AVAILABLE,
  UPDATE_IN_PROGRESS,
  appUpdateMode,
  appVersionReportPayload,
  canPerformImmediateUpdate,
  compareVersionCodes,
  flexibleUpdateOffer,
  forcedUpdateDecision,
  parseVersionCode,
  shouldRunCheck,
} from "../appUpdate.js";

test("parses version codes", () => {
  assert.equal(parseVersionCode(12), 12);
  assert.equal(parseVersionCode("13"), 13);
  assert.equal(parseVersionCode(" 7 "), 7);
  for (const bad of [0, -1, 1.5, "", "1.0.10", "abc", null, undefined, NaN, {}]) {
    assert.equal(parseVersionCode(bad), null, String(bad));
  }
});

test("compares version codes numerically, not as text", () => {
  assert.equal(compareVersionCodes("9", "10"), -1);
  assert.equal(compareVersionCodes(13, "13"), 0);
  assert.equal(compareVersionCodes("100", 99), 1);
  assert.equal(compareVersionCodes("x", 1), null);
});

test("only the installed Android app checks for updates", () => {
  assert.equal(appUpdateMode({ isNative: true, platform: "android", isDev: false }), "android");
  assert.equal(appUpdateMode({ isNative: false, platform: "web", isDev: false }), "off");
  assert.equal(appUpdateMode({ isNative: true, platform: "ios", isDev: false }), "off");
  assert.equal(appUpdateMode({ isNative: true, platform: "android", isDev: true }), "off");
});

test("forced update blocks only below the minimum", () => {
  const cfg = { min_supported_version_code: 13, update_message: "  Security fix  " };
  assert.deepEqual(forcedUpdateDecision({ installedVersionCode: "12", config: cfg }), {
    blocked: true,
    message: "Security fix",
  });
  assert.equal(forcedUpdateDecision({ installedVersionCode: "13", config: cfg }).blocked, false);
  assert.equal(forcedUpdateDecision({ installedVersionCode: 14, config: cfg }).blocked, false);
  assert.equal(
    forcedUpdateDecision({ installedVersionCode: 5, config: { min_supported_version_code: 13 } }).message,
    null
  );
});

test("forced update fails open", () => {
  for (const config of [null, undefined, {}, { min_supported_version_code: 0 }, { min_supported_version_code: "abc" }]) {
    assert.equal(forcedUpdateDecision({ installedVersionCode: 1, config }).blocked, false);
  }
  assert.equal(
    forcedUpdateDecision({ installedVersionCode: null, config: { min_supported_version_code: 99 } }).blocked,
    false
  );
  assert.equal(
    forcedUpdateDecision({ installedVersionCode: "1.0.10", config: { min_supported_version_code: 99 } }).blocked,
    false
  );
});

test("throttles checks to once a day", () => {
  const now = 1_800_000_000_000;
  assert.equal(shouldRunCheck(null, now), true);
  assert.equal(shouldRunCheck("garbage", now), true);
  assert.equal(shouldRunCheck(now + 5000, now), true);
  assert.equal(shouldRunCheck(now - 1000, now), false);
  assert.equal(shouldRunCheck(now - FLEXIBLE_CHECK_INTERVAL_MS, now), true);
  assert.equal(shouldRunCheck(now - 60_000, now, 30_000), true);
});

test("flexible offer reads Play update info", () => {
  const base = { currentVersionCode: "12", availableVersionCode: "13", updateAvailability: UPDATE_AVAILABLE };
  assert.equal(flexibleUpdateOffer(base), "available");
  assert.equal(flexibleUpdateOffer({ ...base, flexibleUpdateAllowed: false }), "none");
  assert.equal(flexibleUpdateOffer({ ...base, updateAvailability: 1 }), "none");
  assert.equal(flexibleUpdateOffer({ ...base, availableVersionCode: "12" }), "none");
  assert.equal(flexibleUpdateOffer({ ...base, installStatus: INSTALL_STATUS_DOWNLOADED }), "restart");
  assert.equal(flexibleUpdateOffer(null), "none");
});

test("immediate update needs Play to allow it", () => {
  assert.equal(canPerformImmediateUpdate({ updateAvailability: UPDATE_AVAILABLE }), true);
  assert.equal(canPerformImmediateUpdate({ updateAvailability: UPDATE_IN_PROGRESS }), true);
  assert.equal(canPerformImmediateUpdate({ updateAvailability: UPDATE_AVAILABLE, immediateUpdateAllowed: false }), false);
  assert.equal(canPerformImmediateUpdate({ updateAvailability: 1 }), false);
  assert.equal(canPerformImmediateUpdate(undefined), false);
});

test("app version report payload from App.getInfo()", () => {
  assert.deepEqual(appVersionReportPayload({ build: "13", version: "1.0.11" }, "android"), {
    p_code: 13,
    p_name: "1.0.11",
    p_platform: "android",
  });
  assert.deepEqual(appVersionReportPayload({ build: 12, version: "<b>" }, "android"), {
    p_code: 12,
    p_name: null,
    p_platform: "android",
  });
  assert.equal(appVersionReportPayload({ build: "abc", version: "1.0.11" }, "android"), null);
  assert.equal(appVersionReportPayload({ build: "13" }, "web"), null);
  assert.equal(appVersionReportPayload(null, "android"), null);
});
