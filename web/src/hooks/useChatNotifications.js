// src/hooks/useChatNotifications.js
import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabase/client';
import { playChatNotification } from '../utils/sound';

/**
 * Hook for Dashboard to receive chat notifications
 * Works with existing Dashboard structure
 */
export const useChatNotifications = (userId, onNewMessage) => {
  const soundThrottleRef = useRef({});

  const playThrottled = useCallback((key, fn) => {
    const now = Date.now();
    if (!soundThrottleRef.current[key] || now - soundThrottleRef.current[key] > 2000) {
      fn();
      soundThrottleRef.current[key] = now;
    }
  }, []);

  useEffect(() => {
    if (!userId) return;

    const subscription = supabase
      .channel('dashboard-chat-notifications')
      .on('postgres_changes', 
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'chat_messages' 
        }, 
        (payload) => {
          const message = payload.new;
          
          // Don't notify for own messages
          if (message.sender_id === userId) return;
          
          // Don't notify if user is currently on chat page
          if (window.location.pathname === '/chat') return;
          
          // Play sound
          playThrottled('chat', playChatNotification);
          
          // Call callback with message data
          onNewMessage?.(message);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [userId, onNewMessage, playThrottled]);
};

/**
 * Hook to get unread count for Dashboard badge
 */
export const useUnreadCount = (userId) => {
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    if (!userId) return;
    
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
    fetchCount();
    
    // Real-time updates
    const subscription = supabase
      .channel('unread-count')
      .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          if (payload.new.sender_id !== userId && window.location.pathname !== '/chat') {
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