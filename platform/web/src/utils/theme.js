/**
 * Theme sync for initial paint + ThemeToggle.
 * Mirrors localStorage preference, else prefers-color-scheme (avoids auth flash).
 */
import { nativeStatusBarOptions } from './statusBarAppearance';

export function getStoredTheme() {
  try {
    return localStorage.getItem('theme');
  } catch {
    return null;
  }
}

export function setStoredTheme(value) {
  try {
    localStorage.setItem('theme', value);
  } catch {
    /* restricted storage */
  }
}

export function getInitialDark() {
  const stored = getStoredTheme();
  if (stored === 'dark') return true;
  if (stored === 'light') return false;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** Class + browser chrome + native status-bar icons. Does not write localStorage. */
export function applyDocumentTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  try {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0f1f1c' : '#0d9488');
  } catch {
    /* no meta or DOM */
  }
  void syncNativeStatusBar(dark);
}

/** Call before React root render so auth routes respect system dark mode. */
export function applyInitialTheme() {
  applyDocumentTheme(getInitialDark());
}

async function syncNativeStatusBar(dark) {
  const options = nativeStatusBarOptions(dark);
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    if (Capacitor.getPlatform() === 'android') {
      await StatusBar.setOverlaysWebView({ overlay: options.overlay });
      await StatusBar.setBackgroundColor({ color: options.backgroundColor });
    }
    await StatusBar.setStyle({ style: options.style === 'LIGHT' ? Style.Light : Style.Dark });
  } catch {
    /* Browser and PWA keep env(safe-area-inset-*) only. */
  }
}
