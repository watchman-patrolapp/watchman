import { useState, useEffect } from 'react';
import { FaSun, FaMoon } from 'react-icons/fa';

// Safe localStorage helpers
const getStoredTheme = () => {
  try {
    return localStorage.getItem('theme'); // 'dark' | 'light' | null
  } catch {
    return null;
  }
};

const setStoredTheme = (value) => {
  try {
    localStorage.setItem('theme', value);
  } catch {
    // Silently ignore restricted environments
  }
};

// Resolve initial dark state:
// 1. Use stored preference if available
// 2. Fall back to OS/system preference
const getInitialDark = () => {
  const stored = getStoredTheme();
  if (stored === 'dark') return true;
  if (stored === 'light') return false;
  // No stored preference — respect OS setting
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
};

export default function ThemeToggle() {
  const [dark, setDark] = useState(() => getInitialDark());

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add('dark');
      setStoredTheme('dark');
    } else {
      document.documentElement.classList.remove('dark');
      setStoredTheme('light');
    }
  }, [dark]);

  // Also listen for OS theme changes — if user hasn't set a preference,
  // follow the system setting in real time
  useEffect(() => {
    const stored = getStoredTheme();
    if (stored) return; // User has an explicit preference — don't override it

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setDark(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return (
    <button
      onClick={() => setDark(prev => !prev)}
      className="p-1 rounded-full text-white hover:bg-indigo-500 transition"
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={dark}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? <FaSun className="w-5 h-5" /> : <FaMoon className="w-5 h-5" />}
    </button>
  );
}