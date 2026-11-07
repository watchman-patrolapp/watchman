import fs from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/** Same manifest document that is served from public/, so the plugin output and the static file agree. */
const webManifest = JSON.parse(
  fs.readFileSync(new URL('./public/manifest.webmanifest', import.meta.url), 'utf8'),
);

/** Replaces a leftover production Workbox SW so localhost is not stuck on offline.html. */
const DEV_DESTROY_STALE_SW = `/* vite-dev: unregister stale PWA workers */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    await self.registration.unregister();
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(clients.map((client) => client.navigate(client.url)));
  })());
});
`;

function destroyStaleServiceWorkersInDev() {
  const isKillSwitchPath = (url = '') => {
    const path = url.split('?')[0];
    return path === '/sw.js' || path === '/dev-sw.js';
  };

  const writeKillSwitch = (res) => {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Service-Worker-Allowed', '/');
    res.end(DEV_DESTROY_STALE_SW);
  };

  return {
    name: 'destroy-stale-service-workers-in-dev',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!isKillSwitchPath(req.url)) return next();
        writeKillSwitch(res);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const isCapacitor = mode === 'capacitor';

  return {
    base: isCapacitor ? './' : '/',
    plugins: [
      destroyStaleServiceWorkersInDev(),
      react(),
      !isCapacitor &&
        VitePWA({
          registerType: 'autoUpdate',
          includeAssets: [
            'favicon.ico',
            'apple-touch-icon.png',
            'mask-icon.svg',
            'app-mark.png',
            'offline.html',
            'icons/icon-192.png',
            'icons/icon-512.png',
            'icons/icon-maskable-512.png',
            'fonts/inter-latin-wght-normal.woff2',
            'fonts/inter-latin-ext-wght-normal.woff2',
          ],
          manifest: webManifest,
          workbox: {
            // Precache the shell and hashed assets. Navigations to client routes
            // fall back to that shell, so the app opens with no signal.
            // A new deploy ships a new /sw.js (Cache-Control: no-cache). autoUpdate
            // activates it and reloads. While offline the installed shell stays.
            // Do not add runtime routes for Supabase. Auth responses and signed
            // media URLs must never enter the Cache API (see offline/policy.js).
            navigateFallback: 'index.html',
            navigateFallbackDenylist: [/^\/_/, /\/[^/?]+\.[^/]+$/],
            // OSM tiles stay on the browser HTTP cache. Opaque cross-origin tile
            // responses break CacheFirst.
            globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webp}'],
            // Export-only libraries (about 2 MB together) are loaded with dynamic
            // import() when an admin exports. Keep them out of the install download
            // and cache them on first use instead (runtimeCaching below).
            globIgnores: ['**/exceljs*.js', '**/html2pdf*.js'],
            runtimeCaching: [
              {
                // Same-origin, content-hashed files, so a cached copy never goes stale.
                urlPattern: ({ sameOrigin, url }) =>
                  sameOrigin && /\/assets\/(exceljs|html2pdf)[^/]*\.js$/.test(url.pathname),
                handler: 'CacheFirst',
                options: {
                  cacheName: 'export-libs',
                  expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 30 },
                },
              },
            ],
            maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
            cleanupOutdatedCaches: true,
            skipWaiting: true,
            clientsClaim: true,
          },
          selfDestroying: false,
          // Do not run Workbox / precache on localhost — it fights Vite HMR, spams the console,
          // and can make SPA routes feel “offline”. Test PWA with `npm run build && npm run preview`.
          devOptions: {
            enabled: false,
            type: 'module',
          },
        }),
    ].filter(Boolean),
    optimizeDeps: {
      include: ['leaflet', 'react-leaflet'],
    },
    server: {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
    build: {
      chunkSizeWarningLimit: 1000,
      commonjsOptions: {
        transformMixedEsModules: true,
      },
    },
  };
});
