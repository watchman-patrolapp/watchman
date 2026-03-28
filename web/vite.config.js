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
          includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
          manifest: {
            name: 'Neighbourhood Watch',
            short_name: 'PatrolWatch',
            description: 'Emergency Patrol Management',
            theme_color: '#0d9488',
            background_color: '#0f766e',
            display: 'standalone',
            scope: '/',
            start_url: '/',
            icons: [
              {
                src: '/icon-192.png',
                sizes: '192x192',
                type: 'image/png',
              },
              {
                src: '/icon-512.png',
                sizes: '512x512',
                type: 'image/png',
              },
              {
                src: '/icon-512.png',
                sizes: '512x512',
                type: 'image/png',
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
            runtimeCaching: [
              {
                urlPattern: /^https:\/\/.*\.tile\.openstreetmap\.org\/.*/,
                handler: 'CacheFirst',
                options: {
                  cacheName: 'map-tiles',
                  expiration: {
                    maxEntries: 500,
                    maxAgeSeconds: 30 * 24 * 60 * 60,
                  },
                },
              },
            ],
            globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
            skipWaiting: true,
            clientsClaim: true,
          },
          selfDestroying: false,
          devOptions: {
            enabled: true,
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
