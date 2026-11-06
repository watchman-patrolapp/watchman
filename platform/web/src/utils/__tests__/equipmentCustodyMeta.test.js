import test from "node:test";
import assert from "node:assert/strict";
import {
  casNumberError,
  equipmentCustodyErrorText,
  formatRandsFromCents,
  friendlyEquipmentError,
  handoverCodePayload,
  normalizeCasNumber,
  parseHandoverCode,
  randsInputToCents,
  writeOffNeedsSecondAdmin,
} from "../equipmentCustodyMeta.js";

test("normalizeCasNumber accepts the SAPS form and rejects junk", () => {
  assert.equal(normalizeCasNumber(""), "");
  assert.equal(normalizeCasNumber("  cas 123/10/2026 "), "CAS 123/10/2026");
  assert.equal(normalizeCasNumber("CAS123/1/2026"), "CAS 123/1/2026");
  assert.equal(normalizeCasNumber("123/10/2026"), null);
  assert.equal(normalizeCasNumber("CAS 12/2026"), null);
  assert.equal(casNumberError(""), null);
  assert.match(casNumberError("nope"), /SAPS/);
  assert.equal(casNumberError("CAS 1/1/2026"), null);
});

test("write-off four-eyes starts at R2,000 and ignores a missing price", () => {
  assert.equal(writeOffNeedsSecondAdmin(199999), false);
  assert.equal(writeOffNeedsSecondAdmin(200000), true);
  assert.equal(writeOffNeedsSecondAdmin(null), false);
  assert.equal(writeOffNeedsSecondAdmin(undefined), false);
  assert.equal(formatRandsFromCents(200000), "R2 000");
  assert.equal(formatRandsFromCents(150050), "R1 500.50");
});

test("rands input and handover code parsing", () => {
  assert.equal(randsInputToCents(""), null);
  assert.equal(randsInputToCents("R2,000"), 200000);
  assert.equal(randsInputToCents("12.5"), 1250);
  assert.equal(randsInputToCents("12.555"), undefined);
  assert.equal(parseHandoverCode("12 34 56"), "123456");
  assert.equal(parseHandoverCode("12345"), "");
  const id = "11111111-1111-1111-1111-111111111111";
  assert.equal(parseHandoverCode(handoverCodePayload(id, "004200")), "004200");
});

test("custody errors stay friendly and database text is hidden", () => {
  assert.match(equipmentCustodyErrorText({ message: "ERROR: a different admin must approve a write-off of R2,000 or more" }), /No charge/);
  assert.match(equipmentCustodyErrorText({ message: "only an NW admin can decide liability" }), /NW admin/);
  assert.equal(equipmentCustodyErrorText({ message: "unit not found" }), null);
  assert.equal(friendlyEquipmentError("duplicate key value violates unique constraint \"x\""), "Something went wrong. Try again.");
  assert.equal(friendlyEquipmentError("this unit is overdue; it must be returned first"), "this unit is overdue; it must be returned first");
  assert.equal(friendlyEquipmentError(""), "Something went wrong. Try again.");
});
