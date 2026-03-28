import { useLocation, useNavigate } from 'react-router-dom';
import { FaHome, FaListUl, FaPlusCircle, FaUserSecret, FaComment } from 'react-icons/fa';

/**
 * Mobile-first quick nav (bento / shell pattern). Hidden on md+ where dashboard tiles suffice.
 */
export default function DashboardMobileDock({ unreadCount = 0 }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const goChat = () => {
    try {
      localStorage.setItem('lastChatVisit', new Date().toISOString());
    } catch {
      /* ignore */
    }
    navigate('/chat');
  };

  const items = [
    { path: '/dashboard', label: 'Home', icon: FaHome, onClick: () => navigate('/dashboard'), active: pathname === '/dashboard' },
    { path: '/incidents', label: 'Incidents', icon: FaListUl, onClick: () => navigate('/incidents'), active: pathname.startsWith('/incidents') && !pathname.includes('/new') },
    { path: '/incident/new', label: 'Report', icon: FaPlusCircle, onClick: () => navigate('/incident/new'), active: pathname === '/incident/new' },
    { path: '/intelligence', label: 'Intel', icon: FaUserSecret, onClick: () => navigate('/intelligence'), active: pathname.startsWith('/intelligence') },
    { path: '/chat', label: 'Chat', icon: FaComment, onClick: goChat, active: pathname === '/chat', badge: unreadCount },
  ];

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-gray-200/80 dark:border-gray-700/80 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md pb-[env(safe-area-inset-bottom,0px)] motion-safe:transition-shadow"
      aria-label="Primary navigation"
    >
      <ul className="flex justify-around items-stretch max-w-lg mx-auto px-1 pt-1">
        {items.map(({ path, label, icon: Icon, onClick, active, badge }) => (
          <li key={path} className="flex-1 min-w-0">
            <button
              type="button"
              onClick={onClick}
              aria-current={active ? 'page' : undefined}
              className={`w-full flex flex-col items-center gap-0.5 py-2 px-1 rounded-xl text-[10px] font-semibold uppercase tracking-wide motion-safe:transition-colors ${
                active
                  ? 'text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/50'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <span className="relative inline-flex">
                <Icon className="w-5 h-5" aria-hidden />
                {badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[1rem] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold">
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </span>
              {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
