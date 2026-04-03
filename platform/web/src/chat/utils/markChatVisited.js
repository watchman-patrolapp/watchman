import { supabase } from '../../supabase/client';
import { isRpcNotFoundError } from '../../utils/isRpcNotFound';

/** Fired when read cursor updates so hooks can refetch unread count. */
export const CHAT_READ_CURSOR_EVENT = 'chat-read-cursor-updated';

let rpcMissingLogged = false;

/**
 * Advance read cursor (server) or fall back to localStorage if RPC not deployed.
 * @param {string|null|undefined} messageId — uuid of last seen message, or null = latest in DB
 */
export async function markChatVisited(messageId = null) {
  try {
    const { error } = await supabase.rpc('chat_mark_read', {
      p_message_id: messageId || null,
    });
    if (error) {
      if (isRpcNotFoundError(error)) {
        if (!rpcMissingLogged) {
          rpcMissingLogged = true;
          console.warn('[chat] chat_mark_read RPC missing — run latest Supabase migrations or use localStorage fallback.');
        }
        localStorage.setItem('lastChatVisit', new Date().toISOString());
      } else {
        console.warn('[chat] chat_mark_read:', error.message || error);
        localStorage.setItem('lastChatVisit', new Date().toISOString());
      }
    }
  } catch (e) {
    console.warn('[chat] markChatVisited failed', e);
    try {
      localStorage.setItem('lastChatVisit', new Date().toISOString());
    } catch {
      /* ignore */
    }
  }
  try {
    window.dispatchEvent(new Event(CHAT_READ_CURSOR_EVENT));
  } catch {
    /* ignore */
  }
}
