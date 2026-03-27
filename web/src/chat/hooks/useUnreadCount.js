import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabase/client';

export const useUnreadCount = (userId) => {
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    if (!userId) {
      setCount(0);
      return;
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
      console.error('Error fetching unread count:', err);
    }
  }, [userId]);

  useEffect(() => {
    // Wrap async call to avoid "setState in effect" warning
    const loadData = async () => {
      await fetchCount();
    };
    loadData();
    
    // Real-time updates
    const subscription = supabase
      .channel('unread-count')
      .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          if (payload.new.sender_id !== userId && 
              window.location.pathname !== '/chat') {
            setCount(prev => prev + 1);
          }
        }
      )
      .subscribe();

    // Update on visibility change
    const handleVisibility = () => {
      if (!document.hidden) fetchCount();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      supabase.removeChannel(subscription);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [userId, fetchCount]);

  return { count, refetch: fetchCount };
};