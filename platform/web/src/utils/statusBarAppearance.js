/** Page background. The status-bar scrim uses the same tokens in CSS. */
export const STATUS_BAR_LIGHT = '#f5f3ef';
export const STATUS_BAR_DARK = '#0f1f1c';

/**
 * Capacitor's Style.Dark is light icons on a dark bar. Style.Light is dark icons
 * on a light bar. Overlay stays on so Android 15 edge-to-edge and older phones
 * share one inset path (the WebView reports env(safe-area-inset-*) as 0).
 */
export function nativeStatusBarOptions(dark) {
  return {
    overlay: true,
    backgroundColor: dark ? STATUS_BAR_DARK : STATUS_BAR_LIGHT,
    style: dark ? 'DARK' : 'LIGHT',
  };
}
