import assert from "node:assert/strict";
import test from "node:test";
import {
  CITY_HUB_PHOTO_BUCKET,
  COMMUNITY_MEDIA_BUCKET,
  INCIDENT_PHOTOS_BUCKET,
  bareMediaPath,
  prefixedMediaRef,
  resolveMediaRef,
} from "../privateMediaPath.js";

const INCIDENT_URL =
  "https://example.supabase.co/storage/v1/object/public/incident-photos/abc-incident/entry/1.jpg?token=ignored";

test("public incident URL becomes the object path", () => {
  assert.deepEqual(resolveMediaRef(INCIDENT_URL), {
    bucket: INCIDENT_PHOTOS_BUCKET,
    path: "abc-incident/entry/1.jpg",
  });
  assert.equal(bareMediaPath(INCIDENT_URL, INCIDENT_PHOTOS_BUCKET), "abc-incident/entry/1.jpg");
});

test("bare path uses the caller's bucket and a second pass stays stable", () => {
  const path = "org/needs/item/1.webp";
  assert.equal(bareMediaPath(path, COMMUNITY_MEDIA_BUCKET), path);
  assert.equal(bareMediaPath(bareMediaPath(path, COMMUNITY_MEDIA_BUCKET), COMMUNITY_MEDIA_BUCKET), path);
});

test("prefixed city hub path round-trips", () => {
  const stored = prefixedMediaRef("post/copy_1.jpg", CITY_HUB_PHOTO_BUCKET);
  assert.equal(stored, "city-hub-photos/post/copy_1.jpg");
  assert.deepEqual(resolveMediaRef(stored), {
    bucket: CITY_HUB_PHOTO_BUCKET,
    path: "post/copy_1.jpg",
  });
});

test("dot-dot, other buckets, and blob urls are rejected", () => {
  assert.equal(
    resolveMediaRef("https://example.supabase.co/storage/v1/object/public/incident-photos/../secret.jpg"),
    null
  );
  assert.equal(resolveMediaRef("org/../secret.jpg", COMMUNITY_MEDIA_BUCKET), null);
  assert.equal(
    resolveMediaRef("https://example.supabase.co/storage/v1/object/public/avatars/user.png", INCIDENT_PHOTOS_BUCKET),
    null
  );
  assert.equal(resolveMediaRef("blob:http://localhost/preview"), null);
});
