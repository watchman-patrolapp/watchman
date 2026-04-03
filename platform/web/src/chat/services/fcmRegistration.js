import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';

function getFirebaseConfig() {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID;
  if (!apiKey || !appId) return null;
  return {
    apiKey,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId,
  };
}

async function getMessagingInstance() {
  if (typeof window === 'undefined') return null;
  const { Capacitor } = await import('@capacitor/core');
  if (Capacitor.isNativePlatform()) return null;
  const cfg = getFirebaseConfig();
  if (!cfg) return null;
  if (!(await isSupported())) return null;
  const app = getApps().length === 0 ? initializeApp(cfg) : getApps()[0];
  return getMessaging(app);
}

/** Ensures the FCM service worker controls the page (or registers it). */
async function getFcmServiceWorkerRegistration() {
  const existing = await navigator.serviceWorker.getRegistration();
  const url = existing?.active?.scriptURL || '';
  if (url.includes('firebase-messaging-sw')) return existing;
  return navigator.serviceWorker.register('/firebase-messaging-sw.js');
}

/**
 * Ask for notification permission, obtain FCM token, store in `user_push_tokens`.
 * @returns {Promise<string|null>}
 */
export async function requestNotificationPermission(supabaseClient, userId) {
  if (!supabaseClient || !userId) return null;
  const vapidKey = import.meta.env.VITE_FCM_VAPID_KEY;
  if (!vapidKey) {
    console.warn('[FCM] VITE_FCM_VAPID_KEY is not set');
    return null;
  }
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return null;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('[FCM] Notification permission denied');
      return null;
    }

    const messaging = await getMessagingInstance();
    if (!messaging) return null;

    const serviceWorkerRegistration = await getFcmServiceWorkerRegistration();
    await navigator.serviceWorker.ready;

    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration,
    });

    if (!token) {
      console.warn('[FCM] No token received');
      return null;
    }

    await saveFcmToken(supabaseClient, userId, token);
    return token;
  } catch (err) {
    console.error('[FCM] getToken error:', err);
    return null;
  }
}

async function saveFcmToken(supabaseClient, userId, token) {
  const { error } = await supabaseClient.from('user_push_tokens').upsert(
    {
      user_id: userId,
      token,
      platform: 'web',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,token' }
  );

  if (error) console.error('[FCM] Error saving token:', error);
}

/**
 * Foreground FCM messages (when a notification is not shown by the OS).
 * @returns {Promise<(function(): void)>} Unsubscribe function.
 */
export async function onForegroundMessage(callback) {
  const messaging = await getMessagingInstance();
  if (!messaging) return () => {};
  return onMessage(messaging, callback);
}

