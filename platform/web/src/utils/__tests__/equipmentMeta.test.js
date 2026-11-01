import test from "node:test";
import assert from "node:assert/strict";
import {
  equipmentAvailabilityLabel,
  equipmentCategoryChips,
  equipmentCategoryEmoji,
  equipmentErrorMessage,
  equipmentQrTokenFromText,
  equipmentStatusMeta,
  filterEquipmentCatalogue,
  isValidAssetTag,
  equipmentItemPhotoPaths,
  equipmentQrUrl,
  formatLoanLimit,
  centsToRandsInput,
  equipmentAvailabilityBadge,
  paginateLabels,
} from "../equipmentMeta.js";

test("asset tag matches the server rule", () => {
  assert.equal(isValidAssetTag("RAD-01"), true);
  assert.equal(isValidAssetTag("rad-01"), true);
  assert.equal(isValidAssetTag("-RAD"), false);
  assert.equal(isValidAssetTag("R"), false);
  assert.equal(isValidAssetTag("BAD TAG"), false);
  assert.equal(isValidAssetTag("A".repeat(25)), false);
});

test("availability label", () => {
  assert.equal(equipmentAvailabilityLabel({ unit_count: 3, available_count: 2 }), "2 free");
  assert.equal(equipmentAvailabilityLabel({ unit_count: 3, available_count: 0 }), "None free");
  assert.equal(equipmentAvailabilityLabel({ unit_count: 0, available_count: 0 }), "No units yet");
});

test("filter and category chips", () => {
  const items = [
    { item_id: 1, name: "Two-way radio", category_id: "r", category_name: "Radios", category_sort: 20 },
    { item_id: 2, name: "Torch", description: "Rechargeable", category_id: "l", category_name: "Lighting", category_sort: 30 },
    { item_id: 3, name: "Odd thing", category_id: null, category_name: null },
  ];
  assert.deepEqual(filterEquipmentCatalogue(items, { categoryId: "r" }).map((i) => i.item_id), [1]);
  assert.deepEqual(filterEquipmentCatalogue(items, { query: "recharge" }).map((i) => i.item_id), [2]);
  assert.deepEqual(filterEquipmentCatalogue(items, { categoryId: "none" }).map((i) => i.item_id), [3]);
  assert.deepEqual(equipmentCategoryChips(items).map((c) => c.name), ["Radios", "Lighting", "Other"]);
});

test("qr token from scanned url or raw token", () => {
  assert.equal(equipmentQrTokenFromText("https://app.example/equipment/u/AbC_12-xyz9"), "AbC_12-xyz9");
  assert.equal(equipmentQrTokenFromText("AbC_12-xyz9"), "AbC_12-xyz9");
  assert.equal(equipmentQrTokenFromText("short"), null);
});

test("status meta, emoji and errors", () => {
  assert.equal(equipmentStatusMeta("checked_out").label, "Checked out");
  assert.equal(equipmentStatusMeta("weird").label, "weird");
  assert.equal(equipmentCategoryEmoji("Radios"), "📻");
  assert.equal(equipmentCategoryEmoji("nope"), "🧰");
  assert.match(equipmentErrorMessage({ message: "unit not found" }), /not found/);
  assert.match(equipmentErrorMessage(null, true), /P3a SQL/);
});

test("equipmentItemPhotoPaths prefers photo_paths, falls back to cover", () => {
  assert.deepEqual(equipmentItemPhotoPaths({ photo_paths: ["a", "", "b"], photo_path: "z" }), ["a", "b"]);
  assert.deepEqual(equipmentItemPhotoPaths({ photo_paths: [], photo_path: "z" }), ["z"]);
  assert.deepEqual(equipmentItemPhotoPaths({}), []);
});

test("equipmentQrUrl builds the scan URL", () => {
  assert.equal(equipmentQrUrl("https://x.app/", "abcDEF12"), "https://x.app/equipment/u/abcDEF12");
  assert.equal(equipmentQrUrl("https://x.app", ""), "");
  assert.equal(equipmentQrTokenFromText(equipmentQrUrl("https://x.app", "abcDEF12_-")), "abcDEF12_-");
});

test("formatLoanLimit", () => {
  assert.equal(formatLoanLimit(12), "Up to 12 hours");
  assert.equal(formatLoanLimit(48), "Up to 2 days");
  assert.equal(formatLoanLimit(24), "Up to 1 day");
  assert.equal(formatLoanLimit(null), null);
});

test("centsToRandsInput", () => {
  assert.equal(centsToRandsInput(150000), "1500");
  assert.equal(centsToRandsInput(150050), "1500.50");
  assert.equal(centsToRandsInput(null), "");
});

test("equipmentAvailabilityBadge tones", () => {
  assert.match(equipmentAvailabilityBadge({ unit_count: 2, available_count: 1 }).tone, /emerald/);
  assert.match(equipmentAvailabilityBadge({ unit_count: 2, available_count: 0 }).tone, /amber/);
  assert.equal(equipmentAvailabilityBadge({ unit_count: 0 }).label, "No units yet");
  assert.equal(equipmentAvailabilityBadge({ is_archived: true }).label, "Archived");
});

test("paginateLabels splits into sheets", () => {
  const rows = Array.from({ length: 50 }, (_, i) => i);
  const pages = paginateLabels(rows);
  assert.equal(pages.length, 3);
  assert.equal(pages[2].length, 2);
});
