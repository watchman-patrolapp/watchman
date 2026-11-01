import test from "node:test";
import assert from "node:assert/strict";
import { shareImageFileName } from "../patrolFormat.js";

test("share image file name", () => {
  assert.equal(shareImageFileName("PT-7KQ3", "start"), "watchman-PT-7KQ3-on.png");
  assert.equal(shareImageFileName("PT-7KQ3", "end"), "watchman-PT-7KQ3-off.png");
  assert.equal(shareImageFileName("", "end"), "watchman-patrol-off.png");
  assert.equal(shareImageFileName("PT/../x y", "start"), "watchman-PTxy-on.png");
});
