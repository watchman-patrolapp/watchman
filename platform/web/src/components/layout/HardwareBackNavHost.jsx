import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { useAuth } from '../../auth/useAuth';

const AUTH_PATHS = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/update-password',
  '/confirm-email',
]);

function isAuthPath(p) {
  return AUTH_PATHS.has(p);
}

function isBackNavigationExcluded(p) {
  return p.includes('/print');
}

/**
 * Android / native: hardware back jumps to the dashboard (or exits when already home).
 * Browser / PWA: after the history entry changes (back), non-auth routes are replaced with
 * `/dashboard` so users skip long in-app stacks. Auth screens keep normal back behavior.
 */
export default function HardwareBackNavHost() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, sessionReady } = useAuth();
  const pathRef = useRef(location.pathname);

  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    if (!sessionReady || !user?.id) return undefined;

    if (Capacitor.isNativePlatform()) {
      let sub;
      void App.addListener('backButton', () => {
        const p = pathRef.current;
        if (isAuthPath(p) || isBackNavigationExcluded(p)) {
          window.history.back();
          return;
        }
        if (p === '/dashboard' || p === '/') {
          void App.exitApp();
          return;
        }
        navigate('/dashboard', { replace: true });
      }).then((handle) => {
        sub = handle;
      });
      return () => {
        void sub?.remove();
      };
    }

    const onPopState = () => {
      queueMicrotask(() => {
        const p = window.location.pathname;
        if (isAuthPath(p) || isBackNavigationExcluded(p) || p === '/dashboard' || p === '/') return;
        navigate('/dashboard', { replace: true });
      });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [navigate, sessionReady, user?.id]);

  return null;
}
