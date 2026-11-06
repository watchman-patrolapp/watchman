import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabase/client';
import { messageService } from '../services/messageService';
import { APP_CONFIG, MessageStatus } from '../utils/constants';
import { objectUrlManager } from '../utils/objectUrlManager';
import { playChatNotification } from '../../utils/sound';
import toast from '../../utils/notify';
import { markChatVisited } from '../utils/markChatVisited';
import { requestNotificationPermission } from '../services/fcmRegistration';
import { getIncomingPreviewText, reduceIncomingOverlayEnqueue } from '../utils/inAppUrgency';
import { chatNotificationTag } from '../../utils/chatNotificationGuard';
import { parseChatForegroundPayload } from '../utils/fcmForegroundChat';
import { closeServiceWorkerNotifications } from '../utils/clearForegroundNotifications';
import { shouldShowInAppMessageOverlay } from '../../utils/inAppOverlayEligibility';
import { useScrollToBottom } from './useScrollToBottom';
import {
  CHAT_CHANNEL_PATROL,
  CHAT_CHANNEL_RESIDENT,
  defaultChatChannel,
  messageMatchesChannel,
  shouldAlertForChatMessage,
} from '../utils/chatChannels';
import { findExistingMessageIndexForRealtime } from '../utils/chatMessageMerge';

export function useChatSession({
  user,
  chatChannel,
  setChatChannel,
  activeOrganizationId,
  isOpsChat,
  searchParams,
}) {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [typingUsers, setTypingUsers] = useState([]);
  const [reactionState, setReactionState] = useState({});
  const [incomingOverlay, setIncomingOverlay] = useState({ queue: [], index: 0 });
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  const isMountedRef = useRef(true);
  const messagesRef = useRef([]);
  const typingChanRef = useRef(null);
  const typingIdleRef = useRef(null);
  const browserNotificationsRef = useRef([]);
  const chatChannelRef = useRef(chatChannel);
  chatChannelRef.current = chatChannel;
  const isOpsChatRef = useRef(isOpsChat);
  isOpsChatRef.current = isOpsChat;

  const { containerRef, endRef, scrollToBottom } = useScrollToBottom([messages.length]);

  useEffect(() => {
    const room = searchParams.get('room');
    if (isOpsChat && (room === CHAT_CHANNEL_PATROL || room === CHAT_CHANNEL_RESIDENT)) {
      setChatChannel(room);
      return;
    }
    setChatChannel(defaultChatChannel(user?.role));
  }, [user?.id, user?.role, isOpsChat, searchParams, setChatChannel]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!user?.id || !notificationsEnabled) return;
    void requestNotificationPermission(supabase, user.id);
  }, [user?.id, notificationsEnabled]);

  useEffect(
    () => () => {
      if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
    },
    []
  );

  useEffect(() => {
    return () => {
      const list = messagesRef.current;
      const last = list?.[list.length - 1];
      const serverId =
        last?.id && typeof last.id === 'string' && !String(last.id).startsWith('msg-')
          ? last.id
          : null;
      void markChatVisited(serverId, chatChannelRef.current);
    };
  }, []);

  useEffect(() => {
    if (!user?.id) return undefined;
    const ch = supabase
      .channel('emergency-chat-typing', { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const uid = payload?.userId;
        const uname = payload?.userName || 'Someone';
        const active = !!payload?.active;
        if (!uid || uid === user.id) return;
        if (!active) {
          setTypingUsers((prev) => prev.filter((u) => u.userId !== uid));
          return;
        }
        setTypingUsers((prev) => {
          const existing = prev.find((u) => u.userId === uid);
          if (existing && existing.user_name === uname) return prev;
          const rest = prev.filter((u) => u.userId !== uid);
          return [...rest, { userId: uid, user_name: uname }];
        });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') typingChanRef.current = ch;
      });
    return () => {
      typingChanRef.current = null;
      supabase.removeChannel(ch);
    };
  }, [user?.id]);

  const emitTyping = useCallback(
    (active) => {
      if (!user?.id) return;
      typingChanRef.current?.send({
        type: 'broadcast',
        event: 'typing',
        payload: {
          userId: user.id,
          userName: user.fullName || user.email || 'Member',
          active,
        },
      });
    },
    [user]
  );

  const lastTypingEmitRef = useRef(0);
  const onComposerTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingEmitRef.current >= 400) {
      lastTypingEmitRef.current = now;
      emitTyping(true);
    }
    if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
    typingIdleRef.current = setTimeout(() => emitTyping(false), 2200);
  }, [emitTyping]);

  const handleCriticalMessageVisible = useCallback((messageId) => {
    void messageService.markCriticalRead(messageId);
  }, []);

  useEffect(() => {
    const alreadyRequested = localStorage.getItem('notificationsRequested');
    if (!alreadyRequested && 'Notification' in window) {
      Notification.requestPermission().then(permission => {
        if (isMountedRef.current) {
          setNotificationsEnabled(permission === 'granted');
          localStorage.setItem('notificationsRequested', 'true');
        }
      });
    } else if ('Notification' in window && Notification.permission === 'granted') {
      if (isMountedRef.current) setNotificationsEnabled(true);
    }
  }, []);

  const toggleSound = useCallback(() => setSoundEnabled(prev => !prev), []);

  const toggleNotifications = useCallback(() => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      setNotificationsEnabled(prev => !prev);
    } else {
      Notification.requestPermission().then(permission => {
        if (isMountedRef.current) {
          setNotificationsEnabled(permission === 'granted');
          if (permission === 'granted') localStorage.setItem('notificationsRequested', 'true');
        }
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (isMountedRef.current) {
        setIsLoading(true);
        setMessages([]);
      }
      try {
        const data = await messageService.fetchMessages(APP_CONFIG.MAX_MESSAGES, chatChannel);
        if (!cancelled && isMountedRef.current) setMessages(data);
        if (!cancelled) void markChatVisited(null, chatChannel);
      } catch (err) {
        console.error('Failed to load messages:', err);
        if (!cancelled) toast.error('Failed to load messages');
      } finally {
        if (!cancelled && isMountedRef.current) setIsLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [chatChannel, activeOrganizationId]);

  useEffect(() => {
    const serverIds = messages.map((m) => m.id).filter(Boolean);
    if (!serverIds.length) {
      setReactionState({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await messageService.fetchReactions(serverIds);
        if (cancelled) return;
        const next = {};
        for (const row of rows) {
          if (!next[row.message_id]) next[row.message_id] = {};
          if (!next[row.message_id][row.reaction]) next[row.message_id][row.reaction] = [];
          next[row.message_id][row.reaction].push(row.user_id);
        }
        setReactionState(next);
      } catch {
        // Non-blocking; chat works without reactions.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messages]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const unsubscribe = messageService.subscribeReactions((payload) => {
      const row = payload.new || payload.old;
      if (!row?.message_id || !row?.reaction) return;
      setReactionState((prev) => {
        const next = { ...prev };
        const messageBucket = { ...(next[row.message_id] || {}) };
        const users = new Set(messageBucket[row.reaction] || []);
        if (payload.eventType === 'DELETE') users.delete(row.user_id);
        else users.add(row.user_id);
        if (users.size === 0) delete messageBucket[row.reaction];
        else messageBucket[row.reaction] = Array.from(users);
        next[row.message_id] = messageBucket;
        return next;
      });
    });
    return unsubscribe;
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;

    const unsubscribe = messageService.subscribe((newMessage) => {
      const activeChannel = chatChannelRef.current;
      const isOps = isOpsChatRef.current;
      const matchesRoom = messageMatchesChannel(newMessage, activeChannel);
      const shouldAlert =
        newMessage.sender_id !== user.id &&
        shouldAlertForChatMessage(newMessage, { activeChannel, isOps });

      if (soundEnabled && shouldAlert) {
        playChatNotification();
      }

      if (shouldAlert) {
        if (shouldShowInAppMessageOverlay()) {
          if (isMountedRef.current) {
            const key =
              newMessage.id != null
                ? String(newMessage.id)
                : `pending-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            setIncomingOverlay((prev) =>
              reduceIncomingOverlayEnqueue(prev, {
                key,
                message: newMessage,
                receivedAt: Date.now(),
              })
            );
          }
        } else if (notificationsEnabled && 'Notification' in window) {
          const preview = getIncomingPreviewText(newMessage);
          const title =
            newMessage.is_critical
              ? 'SOS'
              : newMessage.visibility === CHAT_CHANNEL_RESIDENT
                ? 'Neighbour chat'
                : 'Patrol ops';
          try {
            const n = new Notification(title, {
              body: `${newMessage.sender_name}: ${preview.slice(0, 100)}`,
              icon: '/favicon.ico',
              tag: chatNotificationTag(newMessage),
            });
            browserNotificationsRef.current.push(n);
          } catch {
            /* ignore */
          }
        }
      }

      if (!matchesRoom) return;

      if (isMountedRef.current) {
        setMessages(prev => {
          const existingIndex = findExistingMessageIndexForRealtime(prev, newMessage);

          if (existingIndex !== -1) {
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              ...newMessage,
              status: MessageStatus.SENT,
              media_url: newMessage.media_url || updated[existingIndex].media_url
            };
            return updated;
          }

          return [...prev.slice(-APP_CONFIG.MAX_MESSAGES + 1), {
            ...newMessage,
            status: MessageStatus.SENT
          }];
        });
      }
    });

    return unsubscribe;
  }, [user, soundEnabled, notificationsEnabled]);

  useEffect(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    let unsubscribe = () => {};

    (async () => {
      const { onForegroundMessage } = await import('../services/fcmRegistration');
      const off = await onForegroundMessage((payload) => {
        if (cancelled || !isMountedRef.current) return;
        if (!shouldShowInAppMessageOverlay()) return;
        const parsed = parseChatForegroundPayload(payload, user.id);
        if (!parsed) return;
        if (
          !shouldAlertForChatMessage(parsed.message, {
            activeChannel: chatChannelRef.current,
            isOps: isOpsChatRef.current,
          })
        ) {
          return;
        }
        setIncomingOverlay((prev) => {
          const next = reduceIncomingOverlayEnqueue(prev, parsed);
          if (next !== prev && soundEnabled) {
            queueMicrotask(() => playChatNotification());
          }
          return next;
        });
      });
      unsubscribe = off;
      if (cancelled) off();
    })();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user?.id, soundEnabled]);

  const clearPendingForegroundNotifications = useCallback(() => {
    if (!isMountedRef.current) return;
    setIncomingOverlay({ queue: [], index: 0 });
    for (const n of browserNotificationsRef.current) {
      try {
        n.close();
      } catch {
        /* ignore */
      }
    }
    browserNotificationsRef.current = [];
    void closeServiceWorkerNotifications();
  }, []);

  useEffect(() => {
    if (!user?.id) return undefined;

    const wasHiddenRef = { current: document.visibilityState === 'hidden' };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        wasHiddenRef.current = true;
        return;
      }
      if (document.visibilityState === 'visible' && wasHiddenRef.current) {
        wasHiddenRef.current = false;
        clearPendingForegroundNotifications();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);

    let resumeHandle = null;
    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        resumeHandle = await App.addListener('resume', () => {
          clearPendingForegroundNotifications();
        });
      } catch {
        /* not running in Capacitor */
      }
    })();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      resumeHandle?.remove?.();
    };
  }, [user?.id, clearPendingForegroundNotifications]);

  useEffect(() => {
    return () => objectUrlManager.revokeAll();
  }, []);

  const removeCurrentIncomingItem = useCallback(() => {
    setIncomingOverlay((prev) => {
      if (prev.queue.length === 0) return prev;
      const { queue, index } = prev;
      const next = queue.filter((_, i) => i !== index);
      const nextIndex = next.length === 0 ? 0 : Math.min(index, next.length - 1);
      return { queue: next, index: nextIndex };
    });
  }, []);

  const handleIncomingOverlayOpen = useCallback(() => {
    setIncomingOverlay((prev) => {
      const item = prev.queue.length
        ? prev.queue[Math.min(prev.index, prev.queue.length - 1)]
        : null;
      const vis = item?.message?.visibility;
      if (isOpsChatRef.current && vis && vis !== chatChannelRef.current) {
        queueMicrotask(() => setChatChannel(vis));
      }
      if (prev.queue.length === 0) return prev;
      const { queue, index } = prev;
      const next = queue.filter((_, i) => i !== index);
      const nextIndex = next.length === 0 ? 0 : Math.min(index, next.length - 1);
      return { queue: next, index: nextIndex };
    });
    scrollToBottom('smooth', true);
  }, [scrollToBottom, setChatChannel]);

  const dismissAllIncoming = useCallback(() => {
    setIncomingOverlay({ queue: [], index: 0 });
  }, []);

  const goPrevIncoming = useCallback(() => {
    setIncomingOverlay((prev) => {
      const maxIdx = Math.max(0, prev.queue.length - 1);
      const idx = Math.min(prev.index, maxIdx);
      return { ...prev, index: Math.max(0, idx - 1) };
    });
  }, []);

  const goNextIncoming = useCallback(() => {
    setIncomingOverlay((prev) => {
      const maxIdx = Math.max(0, prev.queue.length - 1);
      const idx = Math.min(prev.index, maxIdx);
      return { ...prev, index: Math.min(maxIdx, idx + 1) };
    });
  }, []);

  return {
    messages,
    setMessages,
    isLoading,
    typingUsers,
    reactionState,
    setReactionState,
    incomingOverlay,
    isMountedRef,
    messagesRef,
    chatChannelRef,
    containerRef,
    endRef,
    scrollToBottom,
    emitTyping,
    onComposerTyping,
    handleCriticalMessageVisible,
    removeCurrentIncomingItem,
    handleIncomingOverlayOpen,
    dismissAllIncoming,
    goPrevIncoming,
    goNextIncoming,
    soundEnabled,
    notificationsEnabled,
    toggleSound,
    toggleNotifications,
  };
}
