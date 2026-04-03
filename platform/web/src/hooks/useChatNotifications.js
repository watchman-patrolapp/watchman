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

// useUnreadCount lives in src/chat/hooks/useUnreadCount.js (import from '../chat')