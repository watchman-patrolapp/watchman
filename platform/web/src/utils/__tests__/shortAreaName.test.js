import { test } from "node:test";
import assert from "node:assert/strict";
import { shortAreaName, shareAreaName, buildShareCardModel, buildShareCaption } from "../patrolFormat.js";

test("strips trailing Neighbourhood/Neighborhood Watch and NW, case-insensitive", () => {
  assert.equal(shortAreaName("Theescombe Neighbourhood Watch"), "Theescombe");
  assert.equal(shortAreaName("Theescombe Neighborhood Watch"), "Theescombe");
  assert.equal(shortAreaName("theescombe NEIGHBOURHOOD   watch"), "theescombe");
  assert.equal(shortAreaName("Bluewater Bay NW"), "Bluewater Bay");
  assert.equal(shortAreaName("Bluewater Bay nw"), "Bluewater Bay");
});

test("leaves other names alone", () => {
  assert.equal(shortAreaName("Theescombe"), "Theescombe");
  assert.equal(shortAreaName("Newton Park"), "Newton Park");
  assert.equal(shortAreaName("Watchtower Hill"), "Watchtower Hill");
  assert.equal(shortAreaName("Neighbourhood Watch"), "Neighbourhood Watch");
  assert.equal(shortAreaName(""), "");
  assert.equal(shortAreaName(null), "");
});

test("card model and caption use the short area name", () => {
  const patrol = { user_name: "Sam", zone: "Theescombe Neighbourhood Watch", start_time: "2026-10-31T20:31:00+02:00" };
  assert.equal(shareAreaName(patrol), "Theescombe");
  assert.equal(shareAreaName({}, "Theescombe Neighborhood Watch"), "Theescombe");
  const m = buildShareCardModel({ kind: "start", patrol });
  assert.equal(m.area, "Theescombe");
  assert.equal(m.areaName, "Theescombe");
  const caption = buildShareCaption({ kind: "start", patrol });
  assert.ok(!/neighbou?rhood watch/i.test(caption));
  assert.ok(caption.includes("Theescombe"));
});

test("card header is generic, area box is suburb only", async () => {
  const { SHARE_APP_NAME, SHARE_HEADER_TITLE } = await import("../patrolFormat.js");
  assert.equal(SHARE_APP_NAME, "Watchman");
  assert.equal(SHARE_HEADER_TITLE, "Neighbourhood Watch");
  const m = buildShareCardModel({ kind: "end", patrol: { user_name: "Sam", zone: "Theescombe Neighbourhood Watch", start_time: "2026-10-31T20:31:00+02:00", end_time: "2026-10-31T22:00:00+02:00" } });
  assert.equal(m.area, "Theescombe");
  assert.equal(m.appName, "Watchman");
});
