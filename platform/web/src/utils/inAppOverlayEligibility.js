import { Capacitor } from '@capacitor/core';

/**
 * True when the UI should show the in-app incoming-message overlay instead of only a system notification.
 * Android/iOS WebView often reports document.hasFocus() === false while the app is clearly in the foreground.
 */
export function shouldShowInAppMessageOverlay() {
  if (typeof document === 'undefined') return false;
  if (document.visibilityState !== 'visible') return false;
  if (Capacitor.isNativePlatform()) return true;
  return document.hasFocus();
}
