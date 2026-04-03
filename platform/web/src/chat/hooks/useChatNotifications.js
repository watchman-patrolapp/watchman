import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../supabase/client';
import { playChatNotification } from '../../utils/sound';
import { isActiveChatPath } from '../utils/chatPaths';
import { adaptivePollIntervalMs } from '../../utils/dataSaverProfile';

/**
 * Dashboard (and similar) listener for new chat_messages.
 * - Uses Realtime when the JS runtime is active.
 * - When the document is hidden, polls periodically — browsers often throttle WebSockets
 *   in background tabs (sound may still be blocked; system Notification helps).
 */
export const useChatNotifications = (userId, onNewMessage) => {
  const soundThrottleRef = useRef({});
  const lastRemoteMessageIdRef = useRef(null);

  const playThrottled = useCallback((key, fn) => {
    const now = Date.now();
    if (!soundThrottleRef.current[key] || now - soundThrottleRef.current[key] > 2000) {
      fn();
      soundThrottleRef.current[key] = now;
    }
  }, []);

  useEffect(() => {
    if (!userId) return undefined;

    let cancelled = false;
    let pollInterval = 0;
    let seeded = false;

    const applyRemoteMessage = (message) => {
      if (!message || message.sender_id === userId) return;
      const mid = message.id;
      if (mid && lastRemoteMessageIdRef.current === mid) return;
      if (mid) lastRemoteMessageIdRef.current = mid;
      if (isActiveChatPath()) return;
      playThrottled('chat', playChatNotification);
      onNewMessage?.(message);
    };

    (async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('id')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data?.id) lastRemoteMessageIdRef.current = data.id;
      seeded = true;
    })();

    const subscription = supabase
      .channel('dashboard-chat-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
        },
        (payload) => {
          applyRemoteMessage(payload.new);
        }
      )
      .subscribe();

    const pollTick = async () => {
      if (!seeded || document.visibilityState !== 'hidden') return;
      const { data, error } = await supabase
        .from('chat_messages')
        .select('id, sender_id, sender_name, text, created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || error || !data) return;
      applyRemoteMessage(data);
    };

    const onVisibility = () => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = 0;
      }
      if (document.visibilityState === 'hidden') {
        pollInterval = window.setInterval(
          pollTick,
          adaptivePollIntervalMs(30000, { maxMs: 120000 })
        );
        void pollTick();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    onVisibility();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (pollInterval) clearInterval(pollInterval);
      supabase.removeChannel(subscription);
    };
  }, [userId, onNewMessage, playThrottled]);
};
