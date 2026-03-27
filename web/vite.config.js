import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Check if running in Vercel
const isVercel = process.env.VERCEL === '1';

export default defineConfig({
  plugins: [
    react(),
    !isVercel && VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // Skip waiting so updates apply immediately
        skipWaiting: true,
        clientsClaim: true,
      },
      // Simplified manifest to avoid potential issues
      manifest: {
        name: 'Watchman Patrol',
        short_name: 'Watchman',
        theme_color: '#ffffff',
      },
      // Critical: Don't fail build on workbox errors
      selfDestroying: false,
      devOptions: {
        enabled: true,
        type: 'module',
      },
    })
  ].filter(Boolean),
  optimizeDeps: {
    include: ['leaflet', 'react-leaflet'],
  },
  build: {
    chunkSizeWarningLimit: 1000, // Increase limit to suppress warning
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
});