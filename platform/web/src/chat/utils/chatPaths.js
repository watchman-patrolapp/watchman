/** Paths where emergency chat is considered "open" for unread badge + notifications. */
export const ACTIVE_CHAT_PATH_PREFIXES = ['/chat', '/admin/chat'];

export function isActiveChatPath(pathname = typeof window !== 'undefined' ? window.location.pathname : '') {
  return ACTIVE_CHAT_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
