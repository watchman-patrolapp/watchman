// src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { applyInitialTheme } from './utils/theme'
import App from './App'
import './index.css'
import 'leaflet/dist/leaflet.css'  // ✅ ADD THIS - Leaflet base styles
import './utils/leaflet-icons'      // ✅ Leaflet icon fix — MUST be before any map loads
import { AuthProvider } from './auth/AuthProvider'
import ErrorBoundary from './components/ErrorBoundary'
import { Toaster } from 'react-hot-toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { supabase } from './supabase/client';
import { initSentry } from './utils/initSentry';

function vitePwaRegisterScriptPresent() {
  if (typeof document === 'undefined') return false;
  return !!document.querySelector('[id="vite-plugin-pwa:register-sw"]');
}

/** Vercel builds omit vite-plugin-pwa; Workbox otherwise owns `/` and FCM must be merged via injectManifest. */
async function registerFcmServiceWorkerWhenNeeded() {
  if (import.meta.env.DEV) return;
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
  if (Capacitor.isNativePlatform()) return;
  if (vitePwaRegisterScriptPresent()) return;

  try {
    const existing = await navigator.serviceWorker.getRegistration('/');
    const activeUrl = existing?.active?.scriptURL || '';
    if (activeUrl.includes('sw.js') && !activeUrl.includes('firebase-messaging-sw')) return;
    if (activeUrl.includes('firebase-messaging-sw')) return;
    await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  } catch (e) {
    console.warn('[FCM SW] register failed', e);
  }
}

function setupFcmNotificationBridge() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker?.addEventListener) return;
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'NAVIGATE_TO_CHAT') return;
    const roomId = event.data.roomId;
    const qs = roomId ? `?room=${encodeURIComponent(roomId)}` : '';
    window.location.assign(`/chat${qs}`);
  });
}

void registerFcmServiceWorkerWhenNeeded();
setupFcmNotificationBridge();

initSentry();
window.supabase = supabase;

// Drop stale dev service workers (Workbox) so localhost uses plain network + Vite HMR.
if (import.meta.env.DEV && typeof navigator !== 'undefined' && navigator.serviceWorker) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => void r.unregister());
  });
}

// Configure React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30, // 30 minutes (TanStack Query v5; was cacheTime in v4)
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

applyInitialTheme()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <AuthProvider>
          <Toaster position="top-right" />
          <App />
        </AuthProvider>
        {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
      </ErrorBoundary>
    </QueryClientProvider>
  </React.StrictMode>
)
