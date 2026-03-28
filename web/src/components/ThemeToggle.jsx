import { useState, useEffect } from 'react';
import { FaSun, FaMoon } from 'react-icons/fa';
import { getStoredTheme, setStoredTheme, getInitialDark } from '../utils/theme';

/**
 * @param {'brand' | 'surface'} variant — brand: light icon on gradient headers; surface: muted on light/dark panels
 */
export default function ThemeToggle({ variant = 'brand' }) {
  const [dark, setDark] = useState(() => getInitialDark());

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    setStoredTheme(dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    const stored = getStoredTheme();
    if (stored) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setDark(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  const surface =
    'p-2 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200/80 dark:border-gray-700/80';
  const brand = 'p-1 rounded-full text-white hover:bg-white/20 transition';

  return (
    <button
      type="button"
      onClick={() => setDark((prev) => !prev)}
      className={variant === 'surface' ? surface : brand}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={dark}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? <FaSun className="w-5 h-5" /> : <FaMoon className="w-5 h-5" />}
    </button>
  );
}
