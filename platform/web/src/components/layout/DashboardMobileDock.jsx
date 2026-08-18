import { useLocation, useNavigate } from 'react-router-dom';
import { FaHome, FaListUl, FaPlusCircle, FaComment, FaClipboardCheck, FaShieldAlt, FaCalendarAlt, FaBell, FaPhone, FaUserFriends } from 'react-icons/fa';
import { markChatVisited } from '../../chat/utils/markChatVisited';
import { useAuth } from '../../auth/useAuth';
import { canAccessAdminPanel } from '../../auth/staffRoles';
import { canAccessPatrolSchedule, homePathForRole, isHouseholdModeRole, isResidentAppRole } from '../../auth/roleMatrix';

/**
 * Mobile-first quick nav (bento / shell pattern). Hidden on md+ where dashboard tiles suffice.
 * @param {number} [pendingIncidentsCount] — incidents awaiting moderation
 * @param {number} [pendingFeedbackCount] — unreviewed feedback rows
 */
export default function DashboardMobileDock({
  unreadCount = 0,
  pendingIncidentsCount = 0,
  pendingFeedbackCount = 0,
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const isStaffAdminNav = canAccessAdminPanel(user?.role);
  const canUsePatrolSchedule = canAccessPatrolSchedule(user?.role);
  const homePath = homePathForRole(user?.role, user?.platformRole);
  const adminDockBadge = pendingIncidentsCount + pendingFeedbackCount;
  const residentNav = isResidentAppRole(user?.role);
  const householdMode = isHouseholdModeRole(user?.role);
  const onHouseholdPath = pathname.startsWith('/resident');

  const goChat = () => {
    void markChatVisited(null);
    navigate('/chat');
  };

  const householdDockItem = {
    path: '/resident',
    label: 'Resident',
    icon: FaUserFriends,
    onClick: () => navigate('/resident'),
    active: onHouseholdPath,
  };

  const residentItems = [
    { path: homePath, label: 'Home', icon: FaHome, onClick: () => navigate(homePath), active: pathname === homePath },
    { path: '/resident/activity', label: 'Reports', icon: FaListUl, onClick: () => navigate('/resident/activity'), active: pathname.startsWith('/resident/activity') },
    { path: '/resident/neighbours', label: 'Neighbours', icon: FaUserFriends, onClick: () => navigate('/resident/neighbours'), active: pathname.startsWith('/resident/neighbours') || pathname.startsWith('/resident/sector') },
    { path: '/resident/sos', label: 'SOS', icon: FaBell, onClick: () => navigate('/resident/sos'), active: pathname === '/resident/sos', danger: true },
    { path: '/chat', label: 'Chat', icon: FaComment, onClick: goChat, active: pathname === '/chat', badge: unreadCount },
    { path: '/resident/contacts', label: 'Contacts', icon: FaPhone, onClick: () => navigate('/resident/contacts'), active: pathname.startsWith('/resident/contacts') },
  ];

  let items;
  if (residentNav) {
    items = residentItems;
  } else if (householdMode && onHouseholdPath) {
    items = [
      { path: homePath, label: 'Patrol', icon: FaShieldAlt, onClick: () => navigate(homePath), active: false },
      { path: '/resident', label: 'Home', icon: FaHome, onClick: () => navigate('/resident'), active: pathname === '/resident' },
      { path: '/resident/neighbours', label: 'Neighbours', icon: FaUserFriends, onClick: () => navigate('/resident/neighbours'), active: pathname.startsWith('/resident/neighbours') || pathname.startsWith('/resident/sector') },
      { path: '/resident/sos', label: 'SOS', icon: FaBell, onClick: () => navigate('/resident/sos'), active: pathname === '/resident/sos', danger: true },
      { path: '/chat', label: 'Chat', icon: FaComment, onClick: goChat, active: pathname === '/chat', badge: unreadCount },
    ];
  } else if (isStaffAdminNav) {
    items = [
      { path: homePath, label: 'Home', icon: FaHome, onClick: () => navigate(homePath), active: pathname === homePath || (homePath === '/dashboard' && pathname === '/dashboard') },
      ...(householdMode ? [householdDockItem] : []),
      {
        path: '/admin',
        label: 'Admin',
        icon: FaShieldAlt,
        onClick: () => navigate('/admin'),
        active: pathname.startsWith('/admin'),
        badge: adminDockBadge,
      },
      { path: '/chat', label: 'Chat', icon: FaComment, onClick: goChat, active: pathname === '/chat', badge: unreadCount },
      { path: '/incident/new', label: 'Report', icon: FaPlusCircle, onClick: () => navigate('/incident/new'), active: pathname === '/incident/new' },
      { path: '/incidents', label: 'Incident', icon: FaClipboardCheck, onClick: () => navigate('/incidents'), active: pathname.startsWith('/incidents') && !pathname.includes('/new') },
    ];
  } else {
    items = [
      { path: homePath, label: 'Home', icon: FaHome, onClick: () => navigate(homePath), active: pathname === homePath },
      ...(householdMode ? [householdDockItem] : []),
      ...(canUsePatrolSchedule
        ? [{ path: '/schedule', label: 'Schedule', icon: FaCalendarAlt, onClick: () => navigate('/schedule'), active: pathname === '/schedule' }]
        : []),
      { path: '/chat', label: 'Chat', icon: FaComment, onClick: goChat, active: pathname === '/chat', badge: unreadCount },
      { path: '/incident/new', label: 'Report', icon: FaPlusCircle, onClick: () => navigate('/incident/new'), active: pathname === '/incident/new' },
      { path: '/incidents', label: 'Incident', icon: FaListUl, onClick: () => navigate('/incidents'), active: pathname.startsWith('/incidents') && !pathname.includes('/new') },
    ];
  }

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-gray-200/80 dark:border-gray-700/80 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md pb-[env(safe-area-inset-bottom,0px)] motion-safe:transition-shadow"
      aria-label="Primary navigation"
    >
      <ul className="flex justify-around items-stretch max-w-lg mx-auto px-1 pt-1">
        {items.map(({ path, label, icon: Icon, onClick, active, badge, danger }) => {
          const n = badge ?? 0;
          const hasAlert = n > 0;
          const alertInactive =
            hasAlert && !active
              ? 'text-red-800 dark:text-red-200 bg-red-50 dark:bg-red-950/45 ring-2 ring-red-500/85 shadow-[0_0_12px_rgba(239,68,68,0.28)]'
              : '';
          const alertActive =
            hasAlert && active
              ? 'ring-2 ring-red-500/90 ring-offset-2 ring-offset-white dark:ring-offset-gray-900 shadow-[0_0_10px_rgba(239,68,68,0.25)]'
              : '';
          const baseActive =
            active && !hasAlert
              ? danger
                ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50'
                : 'text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/50'
              : active && hasAlert
                ? 'text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/50'
                : '';
          const baseInactive =
            !active && !hasAlert
              ? danger
                ? 'text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              : '';

          return (
            <li key={`${path}-${label}`} className="flex-1 min-w-0">
              <button
                type="button"
                onClick={onClick}
                aria-current={active ? 'page' : undefined}
                className={`w-full flex flex-col items-center gap-0.5 py-2 px-1 rounded-xl text-[10px] font-semibold uppercase tracking-wide motion-safe:transition-colors ${baseActive} ${baseInactive} ${alertInactive} ${alertActive}`}
              >
                <span className="relative inline-flex">
                  <Icon className="w-5 h-5" aria-hidden />
                  {n > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[1rem] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold shadow-sm">
                      {n > 9 ? '9+' : n}
                    </span>
                  )}
                </span>
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
