import { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { useUnreadCount } from '../../chat';
import DashboardMobileDock from './DashboardMobileDock';

const HIDE_EXACT = new Set(['/login', '/register', '/confirm-email', '/sop']);

function shouldShowDock(pathname, hasUser) {
  if (!hasUser) return false;
  if (HIDE_EXACT.has(pathname)) return false;
  if (pathname.includes('/print')) return false;
  return true;
}

/**
 * Renders the bottom mobile nav on patroller routes (not auth/SOP/print).
 * Adds body padding on small screens so content clears the fixed dock.
 */
export default function MobilePatrolDockHost() {
  const { user } = useAuth();
  const location = useLocation();
  const { count: unreadCount } = useUnreadCount(user?.id);

  const show = useMemo(
    () => shouldShowDock(location.pathname, !!user),
    [location.pathname, user]
  );

  useEffect(() => {
    if (!show) return;
    document.body.classList.add('mobile-patrol-dock-pad');
    return () => document.body.classList.remove('mobile-patrol-dock-pad');
  }, [show]);

  if (!show) return null;

  return <DashboardMobileDock unreadCount={unreadCount} />;
}
