import assert from "node:assert/strict";
import test from "node:test";
import { toastIdentity } from "../toastPolicy.js";

test("identical success messages share an id and a short duration", () => {
  const a = toastIdentity("success", "Incident deleted");
  const b = toastIdentity("success", "Incident deleted");
  assert.equal(a.id, b.id);
  assert.equal(a.duration, 2000);
});

test("errors last longer and keep a caller-supplied id and duration", () => {
  const result = toastIdentity("error", "Failed to submit", { id: "save", duration: 12000 });
  assert.equal(result.id, "save");
  assert.equal(result.duration, 12000);
});

test("custom render toasts are not collapsed", () => {
  const result = toastIdentity("toast", () => null, { duration: 7000 });
  assert.equal(result.id, undefined);
  assert.equal(result.duration, 7000);
});
