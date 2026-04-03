/**
 * Theme sync for initial paint + ThemeToggle.
 * Mirrors localStorage preference, else prefers-color-scheme (avoids auth flash).
 */
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

/** Call before React root render so auth routes respect system dark mode. */
export function applyInitialTheme() {
  const dark = getInitialDark();
  document.documentElement.classList.toggle('dark', dark);
  try {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0f1f1c' : '#0d9488');
  } catch {
    /* no meta or DOM */
  }
}
