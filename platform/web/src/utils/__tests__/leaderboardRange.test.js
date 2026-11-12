import test from "node:test";
import assert from "node:assert/strict";
import { fuelDefaultPeriodFromPreset } from "../leaderboardRange.js";

test("fuelDefaultPeriodFromPreset maps known presets", () => {
  assert.equal(fuelDefaultPeriodFromPreset("month"), "month");
  assert.equal(fuelDefaultPeriodFromPreset("all"), "all");
  assert.equal(fuelDefaultPeriodFromPreset("week"), "week");
  assert.equal(fuelDefaultPeriodFromPreset("90d"), "week");
  assert.equal(fuelDefaultPeriodFromPreset("custom"), "week");
});

test("fuelDefaultPeriodFromPreset defaults to all", () => {
  assert.equal(fuelDefaultPeriodFromPreset(undefined), "all");
  assert.equal(fuelDefaultPeriodFromPreset(null), "all");
  assert.equal(fuelDefaultPeriodFromPreset("nonsense"), "all");
});
