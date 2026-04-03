import { useState, useEffect } from 'react';
import { FaSun, FaMoon } from 'react-icons/fa';
import { getStoredTheme, setStoredTheme, getInitialDark } from '../utils/theme';

const VARIANT_CLASS = {
  /** Teal / gradient headers (e.g. dashboard welcome strip) */
  brand: 'p-1 rounded-full text-white hover:bg-white/20 transition',
  /** Auth cards, wide panels */
  surface:
    'p-2 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200/80 dark:border-gray-700/80',
  /** Same size/weight as Patrol Schedule week-nav icon buttons */
  toolbar:
    'p-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 motion-safe:transition shrink-0',
  /** Dark hero / photo headers (e.g. mobile intel profile) */
  overlay:
    'p-2 rounded-full text-white bg-black/50 backdrop-blur-md hover:bg-black/60 motion-safe:transition shrink-0',
};

/**
 * @param {'brand' | 'surface' | 'toolbar' | 'overlay'} variant
 * @param {string} [className] — appended (e.g. extra layout)
 */
export default function ThemeToggle({ variant = 'brand', className = '' }) {
  const [dark, setDark] = useState(() => getInitialDark());

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    setStoredTheme(dark ? 'dark' : 'light');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', dark ? '#0f1f1c' : '#0d9488');
    }
  }, [dark]);

  useEffect(() => {
    const stored = getStoredTheme();
    if (stored) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setDark(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  const base = VARIANT_CLASS[variant] || VARIANT_CLASS.brand;
  const iconClass =
    variant === 'toolbar' ? 'w-3.5 h-3.5' : variant === 'overlay' ? 'w-4 h-4' : 'w-5 h-5';

  return (
    <button
      type="button"
      onClick={() => setDark((prev) => !prev)}
      className={`${base} ${className}`.trim()}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={dark}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? <FaSun className={iconClass} /> : <FaMoon className={iconClass} />}
    </button>
  );
}
