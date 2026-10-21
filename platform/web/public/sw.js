/* Network-first document worker.
 * Vercel production does not build the Workbox service worker. This file replaces
 * an older registration at /sw.js so a cached shell cannot keep serving stale
 * index.html or answer /assets/* with HTML. New visits are not registered here;
 * web push stays on /firebase-messaging-sw.js.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(clients.map(async (client) => {
      try {
        await client.navigate(client.url);
      } catch {
        /* A client that cannot navigate keeps the new worker on the next load. */
      }
    }));
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/assets/")) return;

  const isDocument = request.mode === "navigate"
    || url.pathname === "/"
    || url.pathname === "/index.html";
  if (!isDocument) return;

  event.respondWith((async () => {
    const cache = await caches.open("html-network-first");
    try {
      const fresh = await fetch(request);
      if (fresh && fresh.ok) {
        await cache.put(request, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const cached = await cache.match(request);
      if (cached) return cached;
      throw err;
    }
  })());
});
