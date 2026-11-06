import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_SCOPE,
  FCM_PUSH_SCOPE,
  OFFLINE_CACHE_VERSION,
  OFFLINE_READ_MESSAGE,
  OFFLINE_SCREENS,
  OFFLINE_WRITE_MESSAGE,
  decideSupabaseFetch,
  fcmRegistrationPlan,
  formatLastUpdated,
  isStaleOfflineKey,
  keyBelongsToUser,
  prepareSnapshot,
  screenCacheKey,
  serviceWorkerMayCache,
  shellUpdateAction,
  toProfileSnapshot,
  userFacingReadError,
  userFacingWriteError,
} from "../policy.js";
import { memoryStore } from "../store.js";
import {
  clearOfflineUser,
  purgeStaleOfflineCache,
  readProfileSnapshot,
  readScreenSnapshot,
  saveProfileSnapshot,
  writeScreenSnapshot,
} from "../snapshots.js";
import { offlineAwareFetch } from "../supabaseFetch.js";

function futureSignedUrl(secondsAhead) {
  const exp = Math.floor(Date.now() / 1000) + secondsAhead;
  const body = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `https://example.supabase.co/storage/v1/object/sign/incident-media/a.jpg?token=hdr.${body}.sig`;
}

test("screen cache is scoped to the person and the neighbourhood", () => {
  const a = screenCacheKey({ userId: "user-a", organizationId: "org-1", screen: OFFLINE_SCREENS.incidents });
  const b = screenCacheKey({ userId: "user-a", organizationId: "org-2", screen: OFFLINE_SCREENS.incidents });
  const c = screenCacheKey({ userId: "user-b", organizationId: "org-1", screen: OFFLINE_SCREENS.incidents });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.equal(keyBelongsToUser(a, "user-a"), true);
  assert.equal(keyBelongsToUser(a, "user-b"), false);
  assert.equal(keyBelongsToUser(screenCacheKey({
    userId: "user-a",
    organizationId: ACCOUNT_SCOPE,
    screen: OFFLINE_SCREENS.profile,
  }), "user-a"), true);
});

test("sign-out removes that person’s screens and leaves everyone else", async () => {
  const store = memoryStore();
  await writeScreenSnapshot({ userId: "user-a", organizationId: "org-1", screen: OFFLINE_SCREENS.incidents }, { pages: [{ rows: [{ id: "1" }] }] }, 1_700_000_000_000, store);
  await writeScreenSnapshot({ userId: "user-a", organizationId: "org-2", screen: OFFLINE_SCREENS.cityHub }, { posts: [{ id: "p" }] }, 1_700_000_000_000, store);
  await writeScreenSnapshot({ userId: "user-b", organizationId: "org-1", screen: OFFLINE_SCREENS.incidents }, { pages: [{ rows: [{ id: "keep" }] }] }, 1_700_000_000_000, store);
  await clearOfflineUser("user-a", store);
  assert.equal(await readScreenSnapshot({ userId: "user-a", organizationId: "org-1", screen: OFFLINE_SCREENS.incidents }, Date.now(), store), null);
  assert.equal(await readScreenSnapshot({ userId: "user-a", organizationId: "org-2", screen: OFFLINE_SCREENS.cityHub }, Date.now(), store), null);
  const kept = await readScreenSnapshot({ userId: "user-b", organizationId: "org-1", screen: OFFLINE_SCREENS.incidents }, Date.now(), store);
  assert.equal(kept.data.pages[0].rows[0].id, "keep");
});

test("a neighbourhood switch reads that neighbourhood’s copy only", async () => {
  const store = memoryStore();
  await writeScreenSnapshot({ userId: "user-a", organizationId: "org-1", screen: OFFLINE_SCREENS.equipment }, { items: [{ item_id: "torch" }] }, Date.now(), store);
  await writeScreenSnapshot({ userId: "user-a", organizationId: "org-2", screen: OFFLINE_SCREENS.equipment }, { items: [{ item_id: "radio" }] }, Date.now(), store);
  const org2 = await readScreenSnapshot({ userId: "user-a", organizationId: "org-2", screen: OFFLINE_SCREENS.equipment }, Date.now(), store);
  assert.equal(org2.data.items[0].item_id, "radio");
  assert.equal(JSON.stringify(org2).includes("torch"), false);
});

test("signed media is dropped once the token is expired and auth is never cached", async () => {
  const fresh = futureSignedUrl(3600);
  const stale = futureSignedUrl(-60);
  const now = Date.now();
  const saved = await writeScreenSnapshot(
    { userId: "user-a", organizationId: "org-1", screen: OFFLINE_SCREENS.cityHub },
    { posts: [{ id: "1", photo: fresh, old: stale, access_token: "secret" }] },
    now,
    memoryStore()
  );
  assert.equal(saved.data.posts[0].photo, fresh);
  assert.equal(saved.data.posts[0].old, null);
  assert.equal(saved.data.posts[0].access_token, undefined);

  const store = memoryStore();
  await writeScreenSnapshot(
    { userId: "user-a", organizationId: "org-1", screen: OFFLINE_SCREENS.cityHub },
    { posts: [{ photo: fresh }] },
    now - 7200_000,
    store
  );
  const later = await readScreenSnapshot(
    { userId: "user-a", organizationId: "org-1", screen: OFFLINE_SCREENS.cityHub },
    now + 7200_000,
    store
  );
  assert.equal(later.data.posts[0].photo, null);

  assert.equal(serviceWorkerMayCache("https://example.supabase.co/auth/v1/token"), false);
  assert.equal(serviceWorkerMayCache(fresh), false);
  assert.equal(serviceWorkerMayCache("https://example.supabase.co/rest/v1/incidents"), false);
  assert.equal(serviceWorkerMayCache("/assets/app-abc.js"), true);
});

test("offline writes are friendly, queued patrol and equipment writes still go through", () => {
  const patrol = decideSupabaseFetch({
    url: "https://example.supabase.co/rest/v1/patrol_locations",
    method: "POST",
    online: false,
  });
  assert.equal(patrol.action, "passthrough");
  assert.equal(patrol.cache, "never");

  const gear = decideSupabaseFetch({
    url: "https://example.supabase.co/rest/v1/rpc/confirm_equipment_still_held",
    method: "POST",
    online: false,
  });
  assert.equal(gear.action, "passthrough");

  const post = decideSupabaseFetch({
    url: "https://example.supabase.co/rest/v1/city_hub_posts",
    method: "POST",
    online: false,
  });
  assert.equal(post.action, "block");
  assert.equal(post.message, OFFLINE_WRITE_MESSAGE);

  const auth = decideSupabaseFetch({
    url: "https://example.supabase.co/auth/v1/logout",
    method: "POST",
    online: false,
  });
  assert.equal(auth.action, "passthrough");
  assert.equal(auth.cache, "never");

  const sign = decideSupabaseFetch({
    url: "https://example.supabase.co/storage/v1/object/sign/incident-media/a.jpg",
    method: "POST",
    online: false,
  });
  assert.equal(sign.action, "block");
  assert.equal(sign.cache, "never");

  assert.equal(userFacingWriteError({ message: "Failed to fetch" }), OFFLINE_WRITE_MESSAGE);
  assert.equal(
    userFacingWriteError({ message: "duplicate key value violates unique constraint" }, "Check-in didn’t go through. Try again."),
    "Check-in didn’t go through. Try again."
  );
  assert.equal(userFacingReadError({ message: "PGRST116" }), OFFLINE_READ_MESSAGE);
});

test("fetch wrapper does not call the network for a blocked write and hides transport errors", async () => {
  let called = 0;
  const blocked = await offlineAwareFetch("https://example.supabase.co/rest/v1/incidents", { method: "POST" }, {
    online: false,
    fetch: async () => {
      called += 1;
      return new Response("nope");
    },
  });
  assert.equal(called, 0);
  assert.equal(blocked.status, 503);
  const body = await blocked.json();
  assert.equal(body.message, OFFLINE_WRITE_MESSAGE);

  const failed = await offlineAwareFetch("https://example.supabase.co/rest/v1/incidents?select=*", { method: "GET" }, {
    online: true,
    fetch: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
  const readBody = await failed.json();
  assert.match(readBody.message, /connected/i);
  assert.equal(readBody.message.includes("Failed to fetch"), false);

  let authCalls = 0;
  await assert.rejects(
    () => offlineAwareFetch("https://example.supabase.co/auth/v1/token", { method: "POST" }, {
      online: false,
      fetch: async () => {
        authCalls += 1;
        throw new TypeError("Failed to fetch");
      },
    })
  );
  assert.equal(authCalls, 1);
});

test("profile cache restores a role and a newer cache version drops the old keys", async () => {
  const store = memoryStore();
  const saved = await saveProfileSnapshot({
    id: "user-a",
    role: "patroller",
    fullName: "Asha",
    organizationId: "org-1",
    access_token: "nope",
    avatarUrl: futureSignedUrl(-10),
  }, Date.now(), store);
  assert.equal(saved.data.role, "patroller");
  assert.equal(saved.data.access_token, undefined);
  assert.equal(saved.data.avatarUrl, null);
  const read = await readProfileSnapshot("user-a", Date.now(), store);
  assert.equal(read.data.fullName, "Asha");
  assert.equal(toProfileSnapshot({ role: "admin" }).role, "admin");

  const staleKey = screenCacheKey({ userId: "user-a", organizationId: "org-1", screen: OFFLINE_SCREENS.dashboard }, OFFLINE_CACHE_VERSION + 9);
  await store.set(staleKey, "{}");
  assert.equal(isStaleOfflineKey(staleKey), true);
  await purgeStaleOfflineCache(store);
  assert.equal(await store.get(staleKey), null);
  assert.ok(await readProfileSnapshot("user-a", Date.now(), store));
});

test("last updated label and the deploy update stay predictable", () => {
  const now = Date.parse("2026-11-06T12:00:00.000Z");
  assert.equal(formatLastUpdated(now - 10_000, now), "Last updated just now");
  assert.equal(formatLastUpdated(now - 5 * 60_000, now), "Last updated 5 min ago");
  assert.match(formatLastUpdated("2026-11-06T08:00:00.000Z", now), /^Last updated /);
  assert.equal(shellUpdateAction({ online: true, installedRevision: "a", nextRevision: "a" }), "current");
  assert.equal(shellUpdateAction({ online: false, installedRevision: "a", nextRevision: "b" }), "keep-installed");
  assert.equal(shellUpdateAction({ online: true, installedRevision: "a", nextRevision: "b" }), "activate-and-reload");
});

test("FCM push scope does not take the shell worker’s place", () => {
  assert.equal(FCM_PUSH_SCOPE.startsWith("/"), true);
  assert.equal(fcmRegistrationPlan({
    scriptUrl: "https://watchman.example/firebase-messaging-sw.js",
    scopePath: "/",
  }), "move-to-push-scope");
  assert.equal(fcmRegistrationPlan({
    scriptUrl: "https://watchman.example/firebase-messaging-sw.js",
    scopePath: FCM_PUSH_SCOPE,
  }), "keep-push-worker");
  assert.equal(fcmRegistrationPlan({
    scriptUrl: "https://watchman.example/sw.js",
    scopePath: "/",
  }), "keep-shell");
});

test("a huge incident page is stored without its evidence bulk", () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    id: `id-${index}`,
    type: "theft",
    evidenceRows: [{ media_urls: ["x".repeat(20_000)] }],
    sectionUpdates: [{ note: "y".repeat(20_000) }],
  }));
  const prepared = prepareSnapshot(OFFLINE_SCREENS.incidents, { pages: [{ rows }] });
  assert.ok(prepared);
  assert.equal(prepared.pages[0].rows[0].id, "id-0");
  assert.equal(JSON.stringify(prepared).length < 350_000, true);
  assert.equal(prepared.pages[0].rows[0].evidenceRows, undefined);
});
