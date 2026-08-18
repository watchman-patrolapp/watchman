import { supabase } from '../../supabase/client';
import { isRpcNotFoundError } from '../../utils/isRpcNotFound';

/** Fired when read cursor updates so hooks can refetch unread count. */
export const CHAT_READ_CURSOR_EVENT = 'chat-read-cursor-updated';

let rpcMissingLogged = false;

function isUnknownRpcArgument(error) {
  const blob = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return blob.includes('p_visibility') || blob.includes('schema cache') || blob.includes('could not find the function');
}

/**
 * Advance read cursor (server) or fall back to localStorage if RPC not deployed.
 * @param {string|null|undefined} messageId — uuid of last seen message, or null = latest in DB
 * @param {string|null|undefined} visibility — 'patrol' | 'resident'
 */
export async function markChatVisited(messageId = null, visibility = null) {
  try {
    const args = { p_message_id: messageId || null };
    if (visibility) args.p_visibility = visibility;
    let { error } = await supabase.rpc('chat_mark_read', args);
    if (error && visibility && isUnknownRpcArgument(error) && !isRpcNotFoundError(error)) {
      ({ error } = await supabase.rpc('chat_mark_read', { p_message_id: messageId || null }));
    }
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
