import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabase/client';
import { CHAT_READ_CURSOR_EVENT } from '../utils/markChatVisited';
import { isActiveChatPath } from '../utils/chatPaths';
import { isRpcNotFoundError } from '../../utils/isRpcNotFound';
import {
  applyWorkingOrganizationScope,
  getWorkingOrganizationId,
  messageBelongsToWorkingOrganization,
} from '../../utils/organizationScope';

function messageVisibility(message) {
  return message?.visibility || 'patrol';
}

export const useUnreadCount = (userId, visibility = null, options = {}) => {
  const pauseIncrements = Boolean(options.pauseIncrements);
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    if (!userId) {
      setCount(0);
      return;
    }

    try {
      const args = {
        p_organization_id: getWorkingOrganizationId() || null,
      };
      if (visibility) args.p_visibility = visibility;
      let { data, error } = await supabase.rpc('chat_unread_for_me', args);
      if (
        error &&
        visibility &&
        !isRpcNotFoundError(error) &&
        /p_visibility|schema cache|could not find the function/i.test(error.message || '')
      ) {
        ({ data, error } = await supabase.rpc('chat_unread_for_me', {
          p_organization_id: getWorkingOrganizationId() || null,
        }));
      }
      if (!error && typeof data === 'number') {
        setCount(data);
        return;
      }
      if (error && !isRpcNotFoundError(error)) {
        console.warn('chat_unread_for_me:', error.message || error);
      }
    } catch (e) {
      const transient =
        e instanceof TypeError ||
        (typeof e?.message === 'string' &&
          (e.message.includes('NetworkError') || e.message.includes('Failed to fetch')));
      if (!transient) {
        console.warn('chat_unread_for_me failed', e);
      }
    }

    const lastVisit = localStorage.getItem('lastChatVisit');
    if (!lastVisit) {
      setCount(0);
      return;
    }

    try {
      let query = applyWorkingOrganizationScope(
        supabase.from('chat_messages').select('*', { count: 'exact', head: true })
      )
        .gt('created_at', lastVisit)
        .neq('sender_id', userId)
        .gt('expires_at', new Date().toISOString());
      if (visibility) query = query.eq('visibility', visibility);
      const { count: newCount, error } = await query;

      if (!error) {
        setCount(newCount || 0);
      }
    } catch (err) {
      console.error('Error fetching unread count (fallback):', err);
    }
  }, [userId, visibility]);

  useEffect(() => {
    if (!userId) {
      setCount(0);
      return undefined;
    }

    void fetchCount();

    const subscription = supabase
      .channel(`unread-count-${visibility || 'default'}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          if (!messageBelongsToWorkingOrganization(payload.new)) return;
          if (payload.new.sender_id === userId) return;
          const vis = messageVisibility(payload.new);
          if (visibility && vis !== visibility) return;
          if (pauseIncrements) return;
          if (!visibility && isActiveChatPath()) return;
          setCount((prev) => prev + 1);
        }
      )
      .subscribe();

    const handleVisibility = () => {
      if (!document.hidden) fetchCount();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    const onReadCursor = () => fetchCount();
    window.addEventListener(CHAT_READ_CURSOR_EVENT, onReadCursor);

    return () => {
      supabase.removeChannel(subscription);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener(CHAT_READ_CURSOR_EVENT, onReadCursor);
    };
  }, [userId, visibility, pauseIncrements, fetchCount]);

  return { count, refetch: fetchCount };
};
