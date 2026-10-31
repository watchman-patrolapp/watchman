import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../supabase/client';
import { playChatNotification } from '../../utils/sound';
import { isActiveChatPath } from '../utils/chatPaths';
import { adaptivePollIntervalMs } from '../../utils/dataSaverProfile';
import {
  applyWorkingOrganizationScope,
  getWorkingOrganizationId,
  messageBelongsToWorkingOrganization,
} from '../../utils/organizationScope';
import { isFreshChatMessage } from '../../utils/chatNotificationGuard';

const POLL_FIELDS = 'id, sender_id, sender_name, text, created_at, organization_id, visibility, is_critical';
import { useAuth } from '../../auth/useAuth';
import { canAccessPatrolOpsChat, shouldAlertForChatMessage } from '../utils/chatChannels';

/**
 * Dashboard (and similar) listener for new chat_messages.
 * - Uses Realtime when the JS runtime is active.
 * - When the document is hidden, polls periodically — browsers often throttle WebSockets
 *   in background tabs (sound may still be blocked; system Notification helps).
 * - Never alerts for messages created before the hook started (minus clock leeway), and the
 *   poll baseline is seeded silently once the working organisation is known. Without this, a
 *   hard reload could alert for the newest (possibly months-old) message in the area.
 */
export const useChatNotifications = (userId, onNewMessage) => {
  const { user } = useAuth();
  const isOps = canAccessPatrolOpsChat(user?.role);
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
    let seeding = false;
    const startedAtMs = Date.now();

    const applyRemoteMessage = (message) => {
      if (!message || message.sender_id === userId) return;
      if (!messageBelongsToWorkingOrganization(message)) return;
      if (!isFreshChatMessage(message, startedAtMs)) return;
      if (!shouldAlertForChatMessage(message, { isOps })) return;
      const mid = message.id;
      if (mid && lastRemoteMessageIdRef.current === mid) return;
      if (mid) lastRemoteMessageIdRef.current = mid;
      if (isActiveChatPath()) return;
      playThrottled('chat', playChatNotification);
      onNewMessage?.(message);
    };

    // Silent baseline, only once the working organisation is known (straight after a
    // hard reload it is not set yet, so the scoped query returned nothing).
    const seedBaseline = async () => {
      if (seeded || seeding || !getWorkingOrganizationId()) return;
      seeding = true;
      try {
        const { data, error } = await applyWorkingOrganizationScope(
          supabase.from('chat_messages').select('id')
        )
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled || error) return;
        if (data?.id) lastRemoteMessageIdRef.current = data.id;
        seeded = true;
      } finally {
        seeding = false;
      }
    };
    void seedBaseline();

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
      if (!seeded) {
        await seedBaseline();
        return; // the first successful seed never alerts
      }
      if (document.visibilityState !== 'hidden') return;
      const { data, error } = await applyWorkingOrganizationScope(
        supabase.from('chat_messages').select(POLL_FIELDS)
      )
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
  }, [userId, onNewMessage, playThrottled, isOps]);
};
