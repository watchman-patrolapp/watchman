/**
 * Close notifications displayed by the service worker (e.g. FCM background) for this origin.
 */
export async function closeServiceWorkerNotifications() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const notifications = await reg.getNotifications();
    for (const n of notifications) {
      try {
        n.close();
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}
