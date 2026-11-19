import test from "node:test";
import assert from "node:assert/strict";
import { friendlyError, friendlyMessage, GENERIC_ERROR } from "../friendlyError.js";

test("keeps plain friendly messages", () => {
  assert.equal(friendlyMessage("Could not save hotspot."), "Could not save hotspot.");
  assert.equal(friendlyError(new Error("Please choose a date.")), "Please choose a date.");
});

test("uses the friendly property first", () => {
  assert.equal(friendlyError({ message: "violates foreign key", friendly: "Pick a member." }), "Pick a member.");
});

test("hides database and code errors", () => {
  assert.equal(friendlyError({ message: 'new row violates row-level security policy for table "x"' }), "You don't have permission to do that.");
  assert.equal(friendlyError({ code: "PGRST202", message: "Could not find the function public.x" }), "This feature isn't available yet. Please try again later.");
  assert.equal(friendlyError(new TypeError("Cannot read properties of undefined (reading 'id')")), GENERIC_ERROR);
  assert.equal(friendlyError({ message: 'duplicate key value violates unique constraint "a"' }), "That's already been saved.");
  assert.equal(friendlyError(new Error("Failed to fetch")), "You seem to be offline. Check your connection and try again.");
});

test("keeps the lead-in and swaps the raw part", () => {
  assert.equal(friendlyMessage('Delete failed: permission denied for table incidents'), "Delete failed. You don't have permission to do that.");
  assert.equal(friendlyMessage('Failed to submit: null value in column "x"'), "Failed to submit. Please try again.");
});

test("falls back when empty", () => {
  assert.equal(friendlyError(null, "Could not load."), "Could not load.");
  assert.equal(friendlyError({ message: "" }, "Could not load."), "Could not load.");
});
