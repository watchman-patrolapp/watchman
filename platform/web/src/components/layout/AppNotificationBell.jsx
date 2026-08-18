import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaBell } from "react-icons/fa";
import { useAuth } from "../../auth/useAuth";
import { formatRelativeTime } from "../../utils/formatRelativeTime";
import { useAppNotifications } from "../../utils/appNotifications";

const VARIANT = {
  toolbar:
    "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200",
  surface:
    "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200",
  brand: "bg-white/20 text-white hover:bg-white/30",
};

export default function AppNotificationBell({ variant = "toolbar" }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { rows, unreadCount, markRead } = useAppNotifications(user?.id);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!user?.id) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`relative flex h-9 w-9 items-center justify-center rounded-full ${VARIANT[variant] || VARIANT.toolbar}`}
        aria-label={unreadCount ? `${unreadCount} unread notifications` : "Notifications"}
      >
        <FaBell className="h-4 w-4" />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-red-500 px-1 text-center font-mono text-[10px] font-bold leading-4 text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-800">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Notifications</p>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => void markRead()}
                className="text-xs font-medium text-teal-700 dark:text-teal-300"
              >
                Mark all read
              </button>
            ) : null}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {rows.length === 0 ? (
              <li className="px-3 py-6 text-sm text-gray-500">No notifications yet.</li>
            ) : (
              rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => {
                      void markRead([row.id]);
                      setOpen(false);
                      if (row.href) navigate(row.href);
                    }}
                    className={`block w-full px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 ${
                      row.read_at ? "" : "bg-teal-50/70 dark:bg-teal-950/30"
                    }`}
                  >
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{row.title}</p>
                    {row.body ? <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{row.body}</p> : null}
                    <p className="mt-1 text-[11px] text-gray-400">{formatRelativeTime(row.created_at)}</p>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
