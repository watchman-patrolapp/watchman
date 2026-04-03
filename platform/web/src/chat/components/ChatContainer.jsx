// src/chat/components/ChatContainer.jsx
import React, { useState, useCallback, useEffect, useRef, useReducer } from 'react';
import { supabase } from '../../supabase/client';
import { MapContainer, TileLayer, CircleMarker, useMap, useMapEvents, ZoomControl } from 'react-leaflet';
import { useAuth } from '../../auth/useAuth';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useMessageQueue } from '../hooks/useMessageQueue';
import { useScrollToBottom } from '../hooks/useScrollToBottom';
import { messageService } from '../services/messageService';
import { storageService } from '../services/storageService';
import { 
  detectCriticalMessage, 
  generateSecureId,
  RateLimiter,
} from '../utils/security';
import { objectUrlManager } from '../utils/objectUrlManager';
import { APP_CONFIG, MessageType, MessageStatus, EmergencyLevel } from '../utils/constants';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { OfflineBanner } from './OfflineBanner';
import { playChatNotification, playMessageSent } from '../../utils/sound';
import toast from 'react-hot-toast';
import { markChatVisited } from '../utils/markChatVisited';
import { getChatGeolocationPosition } from '../utils/getChatGeolocation';
import { captureChatError } from '../utils/chatTelemetry';
import { requestNotificationPermission } from '../services/fcmRegistration';
import BrandedLoader from '../../components/layout/BrandedLoader';
import { ChatIncomingOverlay } from './ChatIncomingOverlay';
import { getIncomingPreviewText, reduceIncomingOverlayEnqueue } from '../utils/inAppUrgency';
import { parseChatForegroundPayload } from '../utils/fcmForegroundChat';
import { closeServiceWorkerNotifications } from '../utils/clearForegroundNotifications';
import { shouldShowInAppMessageOverlay } from '../../utils/inAppOverlayEligibility';

const rateLimiter = new RateLimiter(30, 60000);
const INCIDENT_TYPE_OPTIONS = [
  'Suspicious Activity',
  'Theft',
  'Vandalism',
  'Noise Complaint',
  'Suspicious Vehicle',
  'Assault',
  'Other',
];

function localDateTimeParts() {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return { date: `${y}-${mo}-${day}`, time: `${h}:${min}` };
}

function IncidentPinPicker({ pin, onPick }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [mapTarget, setMapTarget] = useState(null);

  function MapRecenter({ target }) {
    const map = useMap();
    useEffect(() => {
      if (!target) return;
      map.setView([target.lat, target.lng], 16, { animate: true });
    }, [map, target]);
    return null;
  }

  function ClickCapture() {
    useMapEvents({
      click(e) {
        onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
      },
    });
    return null;
  }

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'NeighbourhoodWatch/1.0' } });
      if (!res.ok) throw new Error('Search failed');
      const rows = await res.json();
      const top = rows?.[0];
      if (!top) throw new Error('No match found');
      const lat = Number(top.lat);
      const lng = Number(top.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Invalid coordinates');
      onPick({ lat, lng });
      setMapTarget({ lat, lng });
    } catch (e) {
      toast.error(e.message || 'Could not find location');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="relative">
      <MapContainer
        center={pin ? [pin.lat, pin.lng] : [-33.95, 25.58]}
        zoom={14}
        style={{ height: 180, width: '100%', borderRadius: 10 }}
        scrollWheelZoom
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ZoomControl position="bottomright" />
        <ClickCapture />
        <MapRecenter target={mapTarget || pin} />
        {pin && (
          <CircleMarker center={[pin.lat, pin.lng]} radius={8} pathOptions={{ color: '#0d9488', fillColor: '#14b8a6', fillOpacity: 0.9 }} />
        )}
      </MapContainer>
      <div className="pointer-events-auto absolute top-2 left-2 right-2 z-[1000] flex items-center gap-1 rounded-lg bg-white/95 p-1 shadow dark:bg-gray-900/95">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void runSearch();
            }
          }}
          placeholder="Search place..."
          className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600"
          disabled={searching}
        >
          {searching ? '...' : 'Go'}
        </button>
      </div>
    </div>
  );
}

/** Merge realtime INSERT with optimistic row (same user may wait on geocode + slow network). */
function findExistingMessageIndexForRealtime(prev, newMessage) {
  const byId = prev.findIndex((m) => m.id != null && newMessage.id != null && m.id === newMessage.id);
  if (byId !== -1) return byId;

  return prev.findIndex((m) => {
    if (!m.localId) return false;
    if (m.id != null) return false;
    if (String(m.sender_id) !== String(newMessage.sender_id)) return false;
    if (m.type !== newMessage.type) return false;

    if (
      m.type === MessageType.LOCATION &&
      newMessage.location_lat != null &&
      newMessage.location_lng != null
    ) {
      const dLat = Math.abs(Number(m.location_lat) - Number(newMessage.location_lat));
      const dLng = Math.abs(Number(m.location_lng) - Number(newMessage.location_lng));
      if (Number.isFinite(dLat) && Number.isFinite(dLng) && dLat < 1e-5 && dLng < 1e-5) {
        return true;
      }
    }

    const t1 = new Date(m.localTimestamp || 0).getTime();
    const t2 = new Date(newMessage.created_at || 0).getTime();
    return Number.isFinite(t1) && Number.isFinite(t2) && Math.abs(t1 - t2) < 120_000;
  });
}

export default function ChatContainer() {
  const { user } = useAuth();
  const { isOnline } = useNetworkStatus();
  const { addToQueue, queueLength } = useMessageQueue(isOnline);
  
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEmergencyMode, setIsEmergencyMode] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
  const [reactionState, setReactionState] = useState({});
  const [replyToMessage, setReplyToMessage] = useState(null);
  const [, rateLimitUiTick] = useReducer((n) => n + 1, 0);
  const [reportDraft, setReportDraft] = useState(null);
  const [incomingOverlay, setIncomingOverlay] = useState({ queue: [], index: 0 });

  const inputRateLimited = rateLimiter.isRateLimited();

  // Re-render periodically while throttled so the composer re-enables when the window slides.
  useEffect(() => {
    if (!inputRateLimited) return undefined;
    const id = window.setInterval(() => rateLimitUiTick(), 1000);
    return () => window.clearInterval(id);
  }, [inputRateLimited]);

  // Mounted ref to guard async callbacks
  const isMountedRef = useRef(true);
  const messagesRef = useRef([]);
  const typingChanRef = useRef(null);
  const typingIdleRef = useRef(null);
  /** Main-thread `Notification` instances shown while chat was in background — closed when app is foregrounded again. */
  const browserNotificationsRef = useRef([]);

  const { containerRef, endRef, scrollToBottom } = useScrollToBottom([messages.length]);

  // Cleanup mounted ref on unmount
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
    void markChatVisited(null);
  }, []);

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
      void markChatVisited(serverId);
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

  const summarizeMessageForReply = useCallback((msg) => {
    if (!msg) return '';
    if (msg.text?.trim()) return msg.text.trim();
    if (msg.type === MessageType.IMAGE) return '[Image]';
    if (msg.type === MessageType.VOICE) return '[Voice note]';
    if (msg.type === MessageType.LOCATION) return '[Location]';
    return '[Message]';
  }, []);

  const onComposerTyping = useCallback(() => {
    emitTyping(true);
    if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
    typingIdleRef.current = setTimeout(() => emitTyping(false), 2200);
  }, [emitTyping]);

  const handleCriticalMessageVisible = useCallback((messageId) => {
    void messageService.markCriticalRead(messageId);
  }, []);

  // Auto‑request notification permission on mount
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

  // Load messages
  useEffect(() => {
    const load = async () => {
      try {
        const data = await messageService.fetchMessages();
        if (isMountedRef.current) setMessages(data);
      } catch (err) {
        console.error('Failed to load messages:', err);
        toast.error('Failed to load messages');
      } finally {
        if (isMountedRef.current) setIsLoading(false);
      }
    };
    load();
  }, []);

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

  // 🔥 UPDATED: Subscribe to realtime with SMART optimistic update merging
  useEffect(() => {
    if (!user) return;
    
    const unsubscribe = messageService.subscribe((newMessage) => {
      // Play sound for incoming messages (if not from self)
      if (soundEnabled && newMessage.sender_id !== user.id) {
        playChatNotification();
      }
      
      // Foreground: in-app overlay (avoid duplicate OS banner). Background tab: system notification.
      if (newMessage.sender_id !== user.id) {
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
          try {
            const n = new Notification('New Emergency Message', {
              body: `${newMessage.sender_name}: ${preview.slice(0, 100)}`,
              icon: '/favicon.ico',
            });
            browserNotificationsRef.current.push(n);
          } catch {
            /* ignore */
          }
        }
      }
      
      if (isMountedRef.current) {
        setMessages(prev => {
          // 🔑 Match optimistic row (5s was too tight after geocode + slow insert → stuck "sending")
          const existingIndex = findExistingMessageIndexForRealtime(prev, newMessage);
          
          if (existingIndex !== -1) {
            // 🔑 Update existing message with server data (including media_url)
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              ...newMessage,
              status: MessageStatus.SENT,
              // 🔑 Ensure media_url from server is used
              media_url: newMessage.media_url || updated[existingIndex].media_url
            };
            return updated;
          }
          
          // Add new message from other user
          return [...prev.slice(-APP_CONFIG.MAX_MESSAGES + 1), {
            ...newMessage,
            status: MessageStatus.SENT
          }];
        });
      }
    });
    
    return unsubscribe;
  }, [user, soundEnabled, notificationsEnabled]);

  // FCM foreground (web): same overlay as realtime when tab focused — dedupes on message id via reduceIncomingOverlayEnqueue.
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

  // When the app/tab returns to the foreground, clear in-app overlay queue and OS notifications.
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

  // Cleanup object URLs
  useEffect(() => {
    return () => objectUrlManager.revokeAll();
  }, []);

  // ============================================================
  // Handle quick template send – detect location by presence
  // ============================================================
  const handleQuickSend = useCallback(async (templateData, options = {}) => {
    const { instant = false } = options;
    if (!instant) return;

    const localId = generateSecureId();
    
    const hasLocation = !!(
      templateData.location || 
      templateData.location_lat || 
      templateData.location_lng
    );
    
    const messageContent = {
      text: templateData.text,
      location_lat: hasLocation ? (templateData.location?.lat || templateData.location_lat) : null,
      location_lng: hasLocation ? (templateData.location?.lng || templateData.location_lng) : null,
      location_address: hasLocation ? (templateData.location?.address || templateData.location_address) : null,
    };

    const messageType = hasLocation ? MessageType.LOCATION : MessageType.TEXT;
    const replyPreviewText =
      replyToMessage?.reply_preview_text ||
      summarizeMessageForReply(replyToMessage) ||
      null;

    const optimisticMessage = {
      localId,
      text: messageContent.text,
      sender_id: user.id,
      sender_name: user.fullName || user.email,
      sender_avatar: user.avatarUrl,
      is_critical: templateData.isCritical,
      is_emergency: templateData.priority <= EmergencyLevel.HIGH,
      priority: templateData.priority,
      type: messageType,
      status: isOnline ? MessageStatus.SENDING : MessageStatus.PRIORITY_QUEUED,
      localTimestamp: new Date().toISOString(),
      reply_to_message_id: replyToMessage?.id || null,
      reply_preview_text: replyPreviewText,
      ...(hasLocation && {
        location_lat: messageContent.location_lat,
        location_lng: messageContent.location_lng,
        location_address: messageContent.location_address,
      }),
    };

    if (optimisticMessage.is_emergency) {
      setIsEmergencyMode(true);
      setTimeout(() => setIsEmergencyMode(false), 10000);
    }

    if (isMountedRef.current) {
      setMessages(prev => [...prev, optimisticMessage]);
      scrollToBottom('auto', true);
    }

    if (!isOnline) {
      addToQueue(optimisticMessage);
      toast.info('Message queued - will send when online');
      return;
    }

    (async () => {
      try {
        let sent;
        if (hasLocation) {
          sent = await messageService.sendLocation({
            lat: messageContent.location_lat,
            lng: messageContent.location_lng,
            address: messageContent.location_address,
            text: messageContent.text,
            senderId: user.id,
            senderName: user.fullName || user.email,
            senderAvatar: user.avatarUrl,
            isCritical: templateData.isCritical,
            replyToMessageId: replyToMessage?.id || null,
            replyPreviewText,
          });
        } else {
          sent = await messageService.sendText({
            text: messageContent.text,
            senderId: user.id,
            senderName: user.fullName || user.email,
            senderAvatar: user.avatarUrl,
            isCritical: templateData.isCritical,
            replyToMessageId: replyToMessage?.id || null,
            replyPreviewText,
          });
        }

        if (isMountedRef.current) {
          setMessages(prev => prev.map(m => 
            m.localId === localId ? { ...sent, status: MessageStatus.SENT } : m
          ));
          playMessageSent();

          if (optimisticMessage.is_emergency) {
            toast.success('🚨 Emergency sent', { icon: '🚨', duration: 2000 });
          }
          setReplyToMessage(null);
        }

      } catch (error) {
        captureChatError(error, { operation: 'quickSend' });
        if (isMountedRef.current) {
          setMessages(prev => prev.map(m => 
            m.localId === localId ? { ...m, status: MessageStatus.FAILED } : m
          ));
          addToQueue(optimisticMessage);
          toast.error('Send failed - queued for retry');
        }
      }
    })();

  }, [user, isOnline, addToQueue, scrollToBottom, replyToMessage, summarizeMessageForReply]);

  // Regular text send
  const handleSendText = useCallback(async (text, options = {}) => {
    if (!rateLimiter.canProceed()) {
      toast.error('Please slow down');
      return;
    }

    const isCritical = detectCriticalMessage(text);
    const localId = generateSecureId();
    const replyToMessageId = options.replyToMessageId || replyToMessage?.id || null;
    const replyPreviewText =
      options.replyPreviewText ||
      replyToMessage?.reply_preview_text ||
      summarizeMessageForReply(replyToMessage) ||
      null;
    
    const optimisticMessage = {
      localId,
      text,
      sender_id: user.id,
      sender_name: user.fullName || user.email,
      sender_avatar: user.avatarUrl,
      is_critical: isCritical,
      type: MessageType.TEXT,
      status: isOnline ? MessageStatus.SENDING : MessageStatus.FAILED,
      localTimestamp: new Date().toISOString(),
      reply_to_message_id: replyToMessageId,
      reply_preview_text: replyPreviewText,
    };

    if (isMountedRef.current) {
      setMessages(prev => [...prev, optimisticMessage]);
      scrollToBottom();
    }

    if (!isOnline) {
      addToQueue(optimisticMessage);
      return;
    }

    try {
      const sent = await messageService.sendText({
        text,
        senderId: user.id,
        senderName: user.fullName || user.email,
        senderAvatar: user.avatarUrl,
        isCritical,
        replyToMessageId,
        replyPreviewText,
      });

      if (isMountedRef.current) {
        setMessages(prev => prev.map(m => 
          m.localId === localId ? { ...sent, status: MessageStatus.SENT } : m
        ));
        playMessageSent();
        setReplyToMessage(null);
      }
    } catch (err) {
      captureChatError(err, { operation: 'sendText' });
      if (isMountedRef.current) {
        setMessages(prev => prev.map(m => 
          m.localId === localId ? { ...m, status: MessageStatus.FAILED } : m
        ));
        addToQueue(optimisticMessage);
      }
    }
  }, [user, isOnline, addToQueue, scrollToBottom, replyToMessage, summarizeMessageForReply]);

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
    removeCurrentIncomingItem();
    // User explicitly chose "Open" — scroll even if they had scrolled up (shouldScrollRef would block otherwise).
    scrollToBottom('smooth', true);
  }, [removeCurrentIncomingItem, scrollToBottom]);

  const handleIncomingOverlayQuickReply = useCallback(
    async (text) => {
      await handleSendText(text);
      if (!isMountedRef.current) return;
      removeCurrentIncomingItem();
      scrollToBottom('smooth', true);
    },
    [handleSendText, removeCurrentIncomingItem, scrollToBottom]
  );

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

  // Image send
  const handleSendImage = useCallback(async (file) => {
    const localId = generateSecureId();
    const objectUrl = objectUrlManager.create(file, localId);

    const optimisticMessage = {
      localId,
      text: '',
      type: MessageType.IMAGE,
      media_url: objectUrl,
      sender_id: user.id,
      sender_name: user.fullName || user.email,
      sender_avatar: user.avatarUrl,
      status: MessageStatus.SENDING,
      localTimestamp: new Date().toISOString(),
      reply_to_message_id: replyToMessage?.id || null,
      reply_preview_text:
        replyToMessage?.reply_preview_text || summarizeMessageForReply(replyToMessage) || null,
    };

    if (isMountedRef.current) {
      setMessages(prev => [...prev, optimisticMessage]);
      scrollToBottom();
    }

    try {
      const { url } = await storageService.uploadImage(file);
      const sent = await messageService.sendImage({
        fileUrl: url,
        senderId: user.id,
        senderName: user.fullName || user.email,
        senderAvatar: user.avatarUrl,
        replyToMessageId: replyToMessage?.id || null,
        replyPreviewText:
          replyToMessage?.reply_preview_text || summarizeMessageForReply(replyToMessage) || null,
      });

      objectUrlManager.revoke(localId);
      
      if (isMountedRef.current) {
        setMessages(prev => prev.map(m => 
          m.localId === localId ? { ...sent, status: MessageStatus.SENT, media_url: url } : m
        ));
        playMessageSent();
        setReplyToMessage(null);
      }
    } catch (err) {
      captureChatError(err, { operation: 'sendImage' });
      if (isMountedRef.current) {
        setMessages(prev => prev.map(m => 
          m.localId === localId ? { ...m, status: MessageStatus.FAILED } : m
        ));
        addToQueue({ ...optimisticMessage, file });
      }
    }
  }, [user, addToQueue, scrollToBottom, replyToMessage, summarizeMessageForReply]);

  // 🔥 UPDATED: Voice send with previewUrl parameter + smarter URL handling
  const handleSendVoice = useCallback(async (blob, duration, previewUrl) => {
    const localId = generateSecureId();
    
    const objectUrl = previewUrl || objectUrlManager.create(blob, localId);

    const optimisticMessage = {
      localId,
      text: '',
      type: MessageType.VOICE,
      media_url: objectUrl,  // 🔑 Use media_url consistently
      blob: blob,
      duration: duration,
      sender_id: user.id,
      sender_name: user.fullName || user.email,
      sender_avatar: user.avatarUrl,
      status: MessageStatus.SENDING,
      localTimestamp: new Date().toISOString(),
      reply_to_message_id: replyToMessage?.id || null,
      reply_preview_text:
        replyToMessage?.reply_preview_text || summarizeMessageForReply(replyToMessage) || null,
    };

    if (isMountedRef.current) {
      setMessages(prev => [...prev, optimisticMessage]);
      scrollToBottom();
    }

    try {
      // Upload to Supabase storage
      const { url: storageUrl } = await storageService.uploadVoice(blob, duration);
      console.log('Voice uploaded to:', storageUrl);
      
      // Send message to database
      const sent = await messageService.sendVoice({
        fileUrl: storageUrl,
        duration,
        senderId: user.id,
        senderName: user.fullName || user.email,
        senderAvatar: user.avatarUrl,
        replyToMessageId: replyToMessage?.id || null,
        replyPreviewText:
          replyToMessage?.reply_preview_text || summarizeMessageForReply(replyToMessage) || null,
      });

      console.log('Message saved to DB:', sent);

      // Clean up temporary object URL
      objectUrlManager.revoke(localId);
      if (previewUrl && previewUrl !== objectUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      
      if (isMountedRef.current) {
        setMessages(prev => prev.map(m => 
          m.localId === localId ? { 
            ...m, 
            id: sent.id,
            status: MessageStatus.SENT,
            media_url: storageUrl,  // 🔑 Ensure we use the storage URL
            blob: null
          } : m
        ));
        playMessageSent();
        setReplyToMessage(null);
      }
    } catch (err) {
      captureChatError(err, { operation: 'sendVoice' });
      if (isMountedRef.current) {
        setMessages(prev => prev.map(m => 
          m.localId === localId ? { ...m, status: MessageStatus.FAILED } : m
        ));
        addToQueue({ ...optimisticMessage, blob });
      }
    }
  }, [user, addToQueue, scrollToBottom, replyToMessage, summarizeMessageForReply]);

  // ============================================================
  // Location send with defensive destructuring + mounted guard
  // ============================================================
  const handleSendLocation = useCallback(async (position) => {
    if (!user?.id) {
      toast.error('You must be signed in to send location');
      return;
    }

    // Defensive: GeolocationPosition, { latitude, longitude }, or { lat, lng }
    let latitude;
    let longitude;

    if (position?.coords) {
      ({ latitude, longitude } = position.coords);
    } else if (position?.lat != null && position?.lng != null) {
      ({ lat: latitude, lng: longitude } = position);
    } else if (position?.latitude != null && position?.longitude != null) {
      ({ latitude, longitude } = position);
    } else {
      console.error('Invalid position format received:', position);
      toast.error('Invalid location data received');
      return;
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      console.error('Invalid coordinates:', { latitude, longitude, lat, lng });
      toast.error('Invalid location coordinates');
      return;
    }

    if (!isMountedRef.current) return;

    try {
      // Geocoding (optional) — must not hang indefinitely (blocks bubble + send)
      let address = null;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
          {
            headers: { 'User-Agent': 'NeighbourhoodWatch/1.0' },
            signal: controller.signal,
          }
        );
        clearTimeout(timeoutId);
        if (response.ok && isMountedRef.current) {
          const data = await response.json();
          address = data.display_name?.split(',').slice(0, 3).join(',');
        }
      } catch (e) {
        if (e?.name !== 'AbortError') {
          console.log('Geocoding failed (non-critical):', e);
        }
      }

      if (!isMountedRef.current) return;

      const localId = generateSecureId();
      const optimisticMessage = {
        localId,
        text: '',
        type: MessageType.LOCATION,
        location_lat: lat,
        location_lng: lng,
        location_address: address,
        sender_id: user.id,
        sender_name: user.fullName || user.email,
        sender_avatar: user.avatarUrl,
        status: MessageStatus.SENDING,
        localTimestamp: new Date().toISOString(),
        reply_to_message_id: replyToMessage?.id || null,
        reply_preview_text:
          replyToMessage?.reply_preview_text || summarizeMessageForReply(replyToMessage) || null,
      };

      setMessages(prev => [...prev, optimisticMessage]);
      scrollToBottom();

      if (!isOnline) {
        addToQueue(optimisticMessage);
        toast.success('Location saved; will send when you are back online');
        return;
      }

      try {
        const sent = await messageService.sendLocation({
          lat,
          lng,
          address,
          senderId: user.id,
          senderName: user.fullName || user.email,
          senderAvatar: user.avatarUrl,
          replyToMessageId: replyToMessage?.id || null,
          replyPreviewText:
            replyToMessage?.reply_preview_text || summarizeMessageForReply(replyToMessage) || null,
        });

        if (isMountedRef.current) {
          setMessages(prev => prev.map(m => 
            m.localId === localId ? { ...sent, status: MessageStatus.SENT } : m
          ));
          playMessageSent();
          toast.success('Location sent');
          setReplyToMessage(null);
        }
      } catch (err) {
        captureChatError(err, { operation: 'sendLocation' });
        if (isMountedRef.current) {
          toast.error(err?.message || 'Could not send location');
          setMessages(prev => prev.map(m => 
            m.localId === localId ? { ...m, status: MessageStatus.FAILED } : m
          ));
          addToQueue(optimisticMessage);
        }
      }
    } catch {
      console.error('Location send error');
      toast.error('Failed to process location');
    }
  }, [user, isOnline, addToQueue, scrollToBottom, replyToMessage, summarizeMessageForReply]);

  const handleReplyRequest = useCallback(
    (message) => {
      if (!message?.id) return;
      setReplyToMessage({
        id: message.id,
        sender_name: message.sender_name,
        text: message.text,
        type: message.type,
        reply_preview_text: summarizeMessageForReply(message),
      });
    },
    [summarizeMessageForReply]
  );

  const handleCompileReport = useCallback((message) => {
    const summary = summarizeMessageForReply(message);
    const when = localDateTimeParts();
    setReportDraft({
      sourceMessageId: message?.id || null,
      type: 'Suspicious Activity',
      location: message?.location_address || '',
      description:
        `Compiled from emergency chat (${new Date(message?.created_at || Date.now()).toLocaleString()}):\n` +
        `Initial message by: ${message?.sender_name || 'Unknown'}\n` +
        `Compiled into report by: ${user?.fullName || user?.email || 'Unknown'}\n` +
        `${summary}`,
      suspectName: '',
      incidentDate: when.date,
      incidentTime: when.time,
      pinLat: message?.location_lat ?? null,
      pinLng: message?.location_lng ?? null,
      showMapPicker: false,
      sourceSenderName: message?.sender_name || 'Unknown',
      compiledByName: user?.fullName || user?.email || 'Unknown',
    });
  }, [summarizeMessageForReply, user?.email, user?.fullName]);

  const handleSaveCompiledReport = useCallback(async () => {
    const hasPin =
      Number.isFinite(Number(reportDraft?.pinLat)) &&
      Number.isFinite(Number(reportDraft?.pinLng));
    const hasLocationText = Boolean(reportDraft?.location?.trim());
    const hasLocation = hasLocationText || hasPin;
    if (!reportDraft?.description?.trim() || !hasLocation || !reportDraft?.type) {
      if (!reportDraft?.description?.trim()) {
        toast.error('Please add a description');
      } else if (!hasLocation) {
        toast.error('Add a location in the text field or drop a pin on the map');
      } else {
        toast.error('Please choose an incident type');
      }
      return;
    }
    try {
      const pinText = hasPin
        ? `Pinned coordinates: ${Number(reportDraft.pinLat).toFixed(6)}, ${Number(reportDraft.pinLng).toFixed(6)}`
        : null;
      const dateStr = reportDraft.incidentDate || new Date().toISOString().split('T')[0];
      const timeRaw = (reportDraft.incidentTime || '00:00').slice(0, 5);
      const [th, tm] = timeRaw.split(':').map((x) => Number.parseInt(x, 10));
      const safeH = Number.isFinite(th) ? Math.min(23, Math.max(0, th)) : 0;
      const safeM = Number.isFinite(tm) ? Math.min(59, Math.max(0, tm)) : 0;
      const localWhen = new Date(
        `${dateStr}T${String(safeH).padStart(2, '0')}:${String(safeM).padStart(2, '0')}:00`
      );
      const timeLabel = `${String(safeH).padStart(2, '0')}:${String(safeM).padStart(2, '0')}`;
      let bodyText = reportDraft.description.trim();
      bodyText = pinText ? `${bodyText}\n\n${pinText}` : bodyText;
      bodyText = `${bodyText}\n\nIncident occurred (local): ${dateStr} ${timeLabel}`;
      const finalDescription = bodyText;
      const finalLocation =
        reportDraft.location.trim() ||
        (hasPin
          ? `Pinned location (${Number(reportDraft.pinLat).toFixed(5)}, ${Number(reportDraft.pinLng).toFixed(5)})`
          : '');
      const payload = {
        incident_date: Number.isFinite(localWhen.getTime()) ? localWhen.toISOString() : dateStr,
        location: finalLocation,
        type: reportDraft.type,
        description: finalDescription,
        suspect_name: reportDraft.suspectName?.trim() || null,
        status: 'pending',
        submitted_at: new Date().toISOString(),
        submitted_by: user.id,
        submitted_by_name: user.fullName || user.email,
      };
      const { error } = await supabase.from('incidents').insert(payload);
      if (error) throw error;
      toast.success('Incident compiled and saved');
      setReportDraft(null);
    } catch (err) {
      toast.error(`Could not save report: ${err.message || 'unknown error'}`);
    }
  }, [reportDraft, user]);

  // Get location for quick templates
  const getLocation = useCallback(() => {
    return getChatGeolocationPosition({ quick: true }).then((pos) => ({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
    }));
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

  const handleToggleReaction = useCallback(
    async (messageId, emoji) => {
      if (!user?.id || !messageId || !emoji) return;
      const hasReacted = !!reactionState?.[messageId]?.[emoji]?.includes(user.id);
      setReactionState((prev) => {
        const next = { ...prev };
        const messageBucket = { ...(next[messageId] || {}) };
        const users = new Set(messageBucket[emoji] || []);
        if (hasReacted) users.delete(user.id);
        else users.add(user.id);
        if (users.size === 0) delete messageBucket[emoji];
        else messageBucket[emoji] = Array.from(users);
        next[messageId] = messageBucket;
        return next;
      });
      try {
        if (hasReacted) {
          await messageService.removeReaction({ messageId, reaction: emoji, userId: user.id });
        } else {
          await messageService.addReaction({ messageId, reaction: emoji, userId: user.id });
        }
      } catch {
        setReactionState((prev) => {
          const next = { ...prev };
          const messageBucket = { ...(next[messageId] || {}) };
          const users = new Set(messageBucket[emoji] || []);
          if (hasReacted) users.add(user.id);
          else users.delete(user.id);
          if (users.size === 0) delete messageBucket[emoji];
          else messageBucket[emoji] = Array.from(users);
          next[messageId] = messageBucket;
          return next;
        });
        toast.error('Could not update reaction');
      }
    },
    [reactionState, user?.id]
  );

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <BrandedLoader message="Loading chat…" size="lg" />
      </div>
    );
  }

  const overlayQueue = incomingOverlay.queue;
  const overlayIdx = overlayQueue.length
    ? Math.min(incomingOverlay.index, overlayQueue.length - 1)
    : 0;
  const overlayCurrent = overlayQueue.length ? overlayQueue[overlayIdx] : null;

  // ============================================================================
  // 🔑 MOBILE-OPTIMIZED CONTAINER (Replaces lines ~350+)
  // ============================================================================
  return (
    <div
      className="min-h-0 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 px-2 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] max-md:flex max-md:min-h-0 max-md:flex-col max-md:overflow-hidden max-md:h-[calc(100dvh-4rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] max-[639px]:overflow-x-hidden sm:px-4 sm:pt-[calc(1.5rem+env(safe-area-inset-top,0px))] md:h-auto md:min-h-screen md:min-h-[100dvh] md:overflow-visible md:pb-6 md:pt-[calc(1.5rem+env(safe-area-inset-top,0px))] lg:px-8"
    >
      <div className="max-w-4xl mx-auto flex min-h-0 w-full flex-1 flex-col h-chat-shell">
        <ChatHeader
          isOnline={isOnline}
          messageCount={messages.length}
          isEmergencyMode={isEmergencyMode}
        />

        <OfflineBanner
          isOnline={isOnline}
          pendingCount={queueLength}
        />

        <div className={`flex-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-2xl shadow-lg border overflow-hidden flex flex-col min-h-0 transition-all ${
          isEmergencyMode ? 'border-red-500 shadow-red-500/20' : 'border-gray-200 dark:border-gray-700'
        }`}>
          <MessageList
            messages={messages}
            currentUserId={user?.id}
            containerRef={containerRef}
            endRef={endRef}
            typingUsers={typingUsers}
            onCriticalMessageVisible={handleCriticalMessageVisible}
            reactionsByMessage={reactionState}
            onToggleReaction={handleToggleReaction}
            onReplyRequest={handleReplyRequest}
            onCompileReport={handleCompileReport}
          />

          <MessageInput
            onSendText={handleSendText}
            onSendImage={handleSendImage}
            onSendVoice={handleSendVoice}
            onSendLocation={handleSendLocation}
            onQuickTemplateSend={handleQuickSend}
            isOnline={isOnline}
            disabled={inputRateLimited}
            isEmergencyMode={isEmergencyMode}
            soundEnabled={soundEnabled}
            onToggleSound={toggleSound}
            notificationsEnabled={notificationsEnabled}
            onToggleNotifications={toggleNotifications}
            getLocationForTemplates={getLocation}
            onComposerTyping={onComposerTyping}
            replyToMessage={replyToMessage}
            onClearReply={() => setReplyToMessage(null)}
          />
        </div>
      </div>
      {overlayQueue.length > 0 && overlayCurrent && (
        <ChatIncomingOverlay
          currentItem={overlayCurrent}
          position={{ current: overlayIdx + 1, total: overlayQueue.length }}
          onDismissCurrent={removeCurrentIncomingItem}
          onDismissAll={dismissAllIncoming}
          onNavigatePrev={goPrevIncoming}
          onNavigateNext={goNextIncoming}
          onOpen={handleIncomingOverlayOpen}
          onQuickReply={handleIncomingOverlayQuickReply}
          quickReplyDisabled={inputRateLimited}
        />
      )}
      {reportDraft && (
        <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/50 p-3 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-800">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Compile Incident Report</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Drafted from selected chat message. Save and continue chatting.
            </p>
            <div className="mt-3 space-y-2">
              <select
                value={reportDraft.type}
                onChange={(e) => setReportDraft((p) => ({ ...p, type: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                {INCIDENT_TYPE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <input
                value={reportDraft.location}
                onChange={(e) => setReportDraft((p) => ({ ...p, location: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                placeholder="Location"
              />
              <div className="rounded-lg border border-gray-200 p-2 dark:border-gray-600">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-gray-600 dark:text-gray-300">Optional: place location pin on map</p>
                  <button
                    type="button"
                    onClick={() =>
                      setReportDraft((p) => ({ ...p, showMapPicker: !p.showMapPicker }))
                    }
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-gray-600"
                  >
                    {reportDraft.showMapPicker ? 'Hide map' : 'Open map'}
                  </button>
                </div>
                {Number.isFinite(Number(reportDraft.pinLat)) && Number.isFinite(Number(reportDraft.pinLng)) && (
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-teal-700 dark:text-teal-300">
                      Pin: {Number(reportDraft.pinLat).toFixed(6)}, {Number(reportDraft.pinLng).toFixed(6)}
                    </p>
                    <button
                      type="button"
                      onClick={() => setReportDraft((p) => ({ ...p, pinLat: null, pinLng: null }))}
                      className="rounded-md border border-gray-300 px-2 py-0.5 text-[11px] dark:border-gray-600"
                    >
                      Clear pin
                    </button>
                  </div>
                )}
                {reportDraft.showMapPicker && (
                  <div className="mt-2">
                    <IncidentPinPicker
                      pin={
                        Number.isFinite(Number(reportDraft.pinLat)) &&
                        Number.isFinite(Number(reportDraft.pinLng))
                          ? { lat: Number(reportDraft.pinLat), lng: Number(reportDraft.pinLng) }
                          : null
                      }
                      onPick={({ lat, lng }) =>
                        setReportDraft((p) => ({ ...p, pinLat: lat, pinLng: lng }))
                      }
                    />
                    <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                      Tap map to place or move the pin.
                    </p>
                  </div>
                )}
              </div>
              <input
                value={reportDraft.suspectName}
                onChange={(e) => setReportDraft((p) => ({ ...p, suspectName: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                placeholder="Suspect name (optional)"
              />
              <div>
                <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">
                  When it happened
                </label>
                <div className="flex flex-wrap items-stretch gap-2">
                  <input
                    type="date"
                    value={reportDraft.incidentDate || ''}
                    onChange={(e) => setReportDraft((p) => ({ ...p, incidentDate: e.target.value }))}
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  />
                  <input
                    type="time"
                    value={reportDraft.incidentTime || ''}
                    onChange={(e) => setReportDraft((p) => ({ ...p, incidentTime: e.target.value }))}
                    className="w-[8.5rem] shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  />
                </div>
              </div>
              <textarea
                value={reportDraft.description}
                onChange={(e) => setReportDraft((p) => ({ ...p, description: e.target.value }))}
                className="h-32 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReportDraft(null)}
                className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void handleSaveCompiledReport()}
                className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700"
              >
                Save Incident
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}