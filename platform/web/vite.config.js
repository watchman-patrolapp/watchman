import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const isCapacitor = mode === 'capacitor';
  const isVercel = process.env.VERCEL === '1';

  return {
    base: isCapacitor ? './' : '/',
    plugins: [
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
            navigateFallback: '/offline.html',
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
    build: {
      chunkSizeWarningLimit: 1000,
      commonjsOptions: {
        transformMixedEsModules: true,
      },
    },
  };
});
