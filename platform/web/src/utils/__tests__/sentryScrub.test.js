import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scrubBreadcrumb, scrubEvent, scrubString, scrubValue, stripQuery } from "../sentryScrub.js";

test("scrubString removes emails, phones, coordinates and tokens", () => {
  const out = scrubString(
    "user jane@example.com phone 082 555 1234 at -33.96123, 25.60211 Bearer eyJabc.def.ghi"
  );
  assert.ok(!out.includes("jane@example.com"));
  assert.ok(!out.includes("555 1234"));
  assert.ok(!out.includes("25.60211"));
  assert.ok(!out.includes("eyJabc"));
  assert.match(out, /\[email\].*\[phone\].*\[coords\].*\[token\]/);
});

test("scrubString leaves UUIDs and ordinary numbers alone", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  assert.equal(scrubString(`profile ${id} failed with status 500`), `profile ${id} failed with status 500`);
});

test("stripQuery drops query strings", () => {
  assert.equal(stripQuery("https://x.supabase.co/rest/v1/users?id=eq.abc&lat=1"), "https://x.supabase.co/rest/v1/users");
  assert.equal(stripQuery("/no-query"), "/no-query");
});

test("scrubValue redacts sensitive keys recursively", () => {
  const out = scrubValue({ operation: "send", lat: -33.9, nested: { email: "a@b.co", note: "call 0825551234" } });
  assert.equal(out.operation, "send");
  assert.equal(out.lat, "[redacted]");
  assert.equal(out.nested.email, "[redacted]");
  assert.equal(out.nested.note, "call [phone]");
});

test("scrubEvent keeps only the user id and strips request details", () => {
  const event = scrubEvent({
    user: { id: "u1", email: "a@b.co", ip_address: "1.2.3.4" },
    request: { url: "https://app/x?token=abc", headers: { a: 1 }, cookies: "c", data: "d", query_string: "token=abc" },
    exception: { values: [{ value: "failed for a@b.co" }] },
    breadcrumbs: [{ category: "console", message: "x" }, { category: "fetch", data: { url: "https://n/reverse?lat=1&lon=2" } }],
  });
  assert.deepEqual(event.user, { id: "u1" });
  assert.equal(event.request.url, "https://app/x");
  assert.equal(event.request.headers, undefined);
  assert.equal(event.request.cookies, undefined);
  assert.equal(event.request.data, undefined);
  assert.equal(event.request.query_string, undefined);
  assert.equal(event.exception.values[0].value, "failed for [email]");
  assert.equal(event.breadcrumbs.length, 1);
  assert.equal(event.breadcrumbs[0].data.url, "https://n/reverse");
});

test("scrubBreadcrumb drops console breadcrumbs", () => {
  assert.equal(scrubBreadcrumb({ category: "console", message: "hi" }), null);
});

test("initSentry sets sendDefaultPii false and adds no session replay", () => {
  const src = readFileSync(new URL("../initSentry.js", import.meta.url), "utf8");
  assert.match(src, /sendDefaultPii:\s*false/);
  assert.match(src, /beforeSend:/);
  assert.match(src, /beforeBreadcrumb:/);
  assert.doesNotMatch(src, /replayIntegration\(/);
});
