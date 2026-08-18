import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

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
  const isVercel = process.env.VERCEL === '1';

  return {
    base: isCapacitor ? './' : '/',
    plugins: [
      destroyStaleServiceWorkersInDev(),
      react(),
      !isVercel &&
        !isCapacitor &&
        VitePWA({
          registerType: 'autoUpdate',
          includeAssets: [
            'favicon.ico',
            'apple-touch-icon.png',
            'mask-icon.svg',
            'app-mark.png',
            'offline.html',
            'assets/icons/icon-192.webp',
            'assets/icons/icon-512.webp',
          ],
          manifest: {
            name: 'Neighbourhood Watch',
            short_name: 'PatrolWatch',
            description: 'Emergency patrol and neighbourhood watch coordination',
            theme_color: '#0d9488',
            background_color: '#0f766e',
            display: 'standalone',
            orientation: 'portrait-primary',
            scope: '/',
            start_url: '/',
            icons: [
              {
                src: '/assets/icons/icon-192.webp',
                sizes: '192x192',
                type: 'image/webp',
              },
              {
                src: '/assets/icons/icon-512.webp',
                sizes: '512x512',
                type: 'image/webp',
              },
              {
                src: '/assets/icons/icon-512.webp',
                sizes: '512x512',
                type: 'image/webp',
                purpose: 'any maskable',
              },
            ],
          },
          workbox: {
            navigateFallback: '/index.html',
            navigateFallbackAllowlist: [/^\/.*$/],
            navigateFallbackDenylist: [
              /^\/api/,
              /^\/supabase/,
              /\.(?:js|css|png|svg|ico|woff2?|map|json|webmanifest)$/i,
            ],
            // OSM tiles: do not route through Workbox CacheFirst — cross-origin tile
            // caching often triggers "unexpected error" / opaque response issues; the
            // browser’s HTTP cache still applies. Trade-off: no dedicated offline tile pack.
            runtimeCaching: [],
            globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webp}'],
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
