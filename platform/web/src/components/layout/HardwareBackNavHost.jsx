import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { useAuth } from '../../auth/useAuth';
import { homePathForRole } from '../../auth/roleMatrix';

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

function isRoleHome(pathname, homePath) {
  return pathname === homePath || pathname === '/';
}

/**
 * Android / native: hardware back jumps to the role home (or exits when already home).
 * Browser / PWA: after the history entry changes (back), non-auth routes are replaced with
 * the role home so users skip long in-app stacks. Auth screens keep normal back behavior.
 */
export default function HardwareBackNavHost() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, sessionReady } = useAuth();
  const pathRef = useRef(location.pathname);
  const homePath = homePathForRole(user?.role, user?.platformRole);

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
        if (isRoleHome(p, homePath)) {
          void App.exitApp();
          return;
        }
        navigate(homePath, { replace: true });
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
        if (isAuthPath(p) || isBackNavigationExcluded(p) || isRoleHome(p, homePath)) return;
        navigate(homePath, { replace: true });
      });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [homePath, navigate, sessionReady, user?.id]);

  return null;
}
