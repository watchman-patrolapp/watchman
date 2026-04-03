import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabase/client';
import { CHAT_READ_CURSOR_EVENT } from '../utils/markChatVisited';
import { isActiveChatPath } from '../utils/chatPaths';
import { isRpcNotFoundError } from '../../utils/isRpcNotFound';

export const useUnreadCount = (userId) => {
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    if (!userId) {
      setCount(0);
      return;
    }

    try {
      const { data, error } = await supabase.rpc('chat_unread_for_me');
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
          (e.message.includes('NetworkError') || e.message.includes('Failed to fetch')))
      if (!transient) {
        console.warn('chat_unread_for_me failed', e)
      }
    }

    const lastVisit = localStorage.getItem('lastChatVisit');
    if (!lastVisit) {
      setCount(0);
      return;
    }

    try {
      const { count: newCount, error } = await supabase
        .from('chat_messages')
        .select('*', { count: 'exact', head: true })
        .gt('created_at', lastVisit)
        .neq('sender_id', userId)
        .gt('expires_at', new Date().toISOString());

      if (!error) {
        setCount(newCount || 0);
      }
    } catch (err) {
      console.error('Error fetching unread count (fallback):', err);
    }
  }, [userId]);

  useEffect(() => {
    const loadData = async () => {
      await fetchCount();
    };
    void loadData();

    const subscription = supabase
      .channel('unread-count')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          if (payload.new.sender_id !== userId && !isActiveChatPath()) {
            setCount((prev) => prev + 1);
          }
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
  }, [userId, fetchCount]);

  return { count, refetch: fetchCount };
};
