import { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { useUnreadCount } from '../../chat';
import { usePendingIncidentsCount } from '../../hooks/usePendingIncidentsCount';
import { usePendingFeedbackCount } from '../../hooks/usePendingFeedbackCount';
import { canReviewFeedback, isStaffForModerationAlerts } from '../../auth/staffRoles';
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
  const staffAlerts = isStaffForModerationAlerts(user?.role);
  const pendingIncidentsCount = usePendingIncidentsCount(!!user?.id && staffAlerts);
  const pendingFeedbackCount = usePendingFeedbackCount(!!user?.id && canReviewFeedback(user?.role));

  const show = useMemo(
    () => shouldShowDock(location.pathname, !!user),
    [location.pathname, user]
  );

  useEffect(() => {
    if (!show) return;
    // Chat fills the viewport with its own bottom inset for the fixed dock; body padding
    // here would double-reserve space and leave a gap + page scroll under the chat card.
    if (location.pathname === '/chat') {
      document.body.classList.remove('mobile-patrol-dock-pad');
      return undefined;
    }
    document.body.classList.add('mobile-patrol-dock-pad');
    return () => document.body.classList.remove('mobile-patrol-dock-pad');
  }, [show, location.pathname]);

  if (!show) return null;

  return (
    <DashboardMobileDock
      unreadCount={unreadCount}
      pendingIncidentsCount={pendingIncidentsCount}
      pendingFeedbackCount={pendingFeedbackCount}
    />
  );
}
