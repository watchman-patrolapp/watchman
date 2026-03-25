// src/chat/components/ChatContainer.jsx
import React, { useState, useCallback, useEffect, useRef } from 'react';
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
import { QuickTemplates } from './QuickTemplates';
import { playChatNotification, playMessageSent } from '../../utils/sound';
import toast from 'react-hot-toast';

const rateLimiter = new RateLimiter(30, 60000);

export default function ChatContainer() {
  const { user } = useAuth();
  const { isOnline } = useNetworkStatus();
  const { addToQueue, queueLength } = useMessageQueue(isOnline);
  
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showTemplates, setShowTemplates] = useState(false);
  const [isEmergencyMode, setIsEmergencyMode] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  // Mounted ref to guard async callbacks
  const isMountedRef = useRef(true);

  const { containerRef, endRef, scrollToBottom } = useScrollToBottom([messages.length]);

  // Cleanup mounted ref on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
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

  // 🔥 UPDATED: Subscribe to realtime with SMART optimistic update merging
  useEffect(() => {
    if (!user) return;
    
    const unsubscribe = messageService.subscribe((newMessage) => {
      // Play sound for incoming messages (if not from self)
      if (soundEnabled && newMessage.sender_id !== user.id) {
        playChatNotification();
      }
      
      // Show browser notification
      if (notificationsEnabled && newMessage.sender_id !== user.id && !document.hasFocus()) {
        new Notification('New Emergency Message', {
          body: `${newMessage.sender_name}: ${newMessage.text?.substring(0, 100) || 'Shared a message'}`,
          icon: '/favicon.ico',
        });
      }
      
      if (isMountedRef.current) {
        setMessages(prev => {
          // 🔑 Check if we already have this message (optimistic update)
          const existingIndex = prev.findIndex(m => 
            m.id === newMessage.id || 
            (m.localId && m.sender_id === newMessage.sender_id && m.type === newMessage.type && Math.abs(new Date(m.localTimestamp) - new Date(newMessage.created_at)) < 5000)
          );
          
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
          });
        } else {
          sent = await messageService.sendText({
            text: messageContent.text,
            senderId: user.id,
            senderName: user.fullName || user.email,
            senderAvatar: user.avatarUrl,
            isCritical: templateData.isCritical,
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
        }

      } catch (error) {
        console.error('Send failed:', error);
        if (isMountedRef.current) {
          setMessages(prev => prev.map(m => 
            m.localId === localId ? { ...m, status: MessageStatus.FAILED } : m
          ));
          addToQueue(optimisticMessage);
          toast.error('Send failed - queued for retry');
        }
      }
    })();

  }, [user, isOnline, addToQueue, scrollToBottom]);

  // Regular text send
  const handleSendText = useCallback(async (text) => {
    if (!rateLimiter.canProceed()) {
      toast.error('Please slow down');
      return;
    }

    const isCritical = detectCriticalMessage(text);
    const localId = generateSecureId();
    
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
      });

      if (isMountedRef.current) {
        setMessages(prev => prev.map(m => 
          m.localId === localId ? { ...sent, status: MessageStatus.SENT } : m
        ));
        playMessageSent();
      }
    } catch {
      if (isMountedRef.current) {
        setMessages(prev => prev.map(m => 
          m.localId === localId ? { ...m, status: MessageStatus.FAILED } : m
        ));
        addToQueue(optimisticMessage);
      }
    }
  }, [user, isOnline, addToQueue, scrollToBottom]);

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
      });

      objectUrlManager.revoke(localId);
      
      if (isMountedRef.current) {
        setMessages(prev => prev.map(m => 
          m.localId === localId ? { ...sent, status: MessageStatus.SENT, media_url: url } : m
        ));
        playMessageSent();
      }
    } catch {
      if (isMountedRef.current) {
        setMessages(prev => prev.map(m => 
          m.localId === localId ? { ...m, status: MessageStatus.FAILED } : m
        ));
        addToQueue({ ...optimisticMessage, file });
      }
    }
  }, [user, addToQueue, scrollToBottom]);

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
      }
    } catch {
      console.error('Voice send failed');
      if (isMountedRef.current) {
        setMessages(prev => prev.map(m => 
          m.localId === localId ? { ...m, status: MessageStatus.FAILED } : m
        ));
        addToQueue({ ...optimisticMessage, blob });
      }
    }
  }, [user, addToQueue, scrollToBottom]);

  // ============================================================
  // Location send with defensive destructuring + mounted guard
  // ============================================================
  const handleSendLocation = useCallback(async (position) => {
    // Defensive: support both raw GeolocationPosition and flattened format
    let latitude, longitude;
    
    if (position?.coords) {
      ({ latitude, longitude } = position.coords);
    } else if (position?.latitude && position?.longitude) {
      ({ latitude, longitude } = position);
    } else {
      console.error('❌ Invalid position format received:', position);
      toast.error('Invalid location data received');
      return;
    }

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      console.error('❌ Invalid coordinates:', { latitude, longitude });
      toast.error('Invalid location coordinates');
      return;
    }

    if (!isMountedRef.current) return;

    try {
      // Geocoding (optional)
      let address = null;
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
          { headers: { 'User-Agent': 'NeighbourhoodWatch/1.0' } }
        );
        if (response.ok && isMountedRef.current) {
          const data = await response.json();
          address = data.display_name?.split(',').slice(0, 3).join(',');
        }
      } catch (e) {
        console.log('Geocoding failed (non-critical):', e);
      }

      if (!isMountedRef.current) return;

      const localId = generateSecureId();
      const optimisticMessage = {
        localId,
        text: '',
        type: MessageType.LOCATION,
        location_lat: latitude,
        location_lng: longitude,
        location_address: address,
        sender_id: user.id,
        sender_name: user.fullName || user.email,
        sender_avatar: user.avatarUrl,
        status: MessageStatus.SENDING,
        localTimestamp: new Date().toISOString(),
      };

      setMessages(prev => [...prev, optimisticMessage]);
      scrollToBottom();

      if (!isOnline) {
        addToQueue(optimisticMessage);
        return;
      }

      try {
        const sent = await messageService.sendLocation({
          lat: latitude,
          lng: longitude,
          address,
          senderId: user.id,
          senderName: user.fullName || user.email,
          senderAvatar: user.avatarUrl,
        });

        if (isMountedRef.current) {
          setMessages(prev => prev.map(m => 
            m.localId === localId ? { ...sent, status: MessageStatus.SENT } : m
          ));
          playMessageSent();
        }
      } catch {
        if (isMountedRef.current) {
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
  }, [user, isOnline, addToQueue, scrollToBottom]);

  // Get location for quick templates
  const getLocation = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        }),
        reject,
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
      </div>
    );
  }

  // ============================================================================
  // 🔑 MOBILE-OPTIMIZED CONTAINER (Replaces lines ~350+)
  // ============================================================================
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 py-2 sm:py-6 px-2 sm:px-4 lg:px-8">
      <div className="max-w-4xl mx-auto h-[calc(100vh-1rem)] sm:h-[calc(100vh-3rem)] flex flex-col">
        <ChatHeader
          isOnline={isOnline}
          messageCount={messages.length}
          isEmergencyMode={isEmergencyMode}
          soundEnabled={soundEnabled}
          onToggleSound={toggleSound}
          notificationsEnabled={notificationsEnabled}
          onToggleNotifications={toggleNotifications}
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
            typingUsers={[]}  // Add typingUsers prop
          />

          {showTemplates && (
            <QuickTemplates 
              onSelect={handleQuickSend}
              onClose={() => setShowTemplates(false)}
              isOnline={isOnline}
              getLocation={getLocation}
            />
          )}

          <MessageInput
            onSendText={handleSendText}
            onSendImage={handleSendImage}
            onSendVoice={handleSendVoice}  // ✅ Now accepts (blob, duration, previewUrl)
            onSendLocation={handleSendLocation}
            isOnline={isOnline}
            disabled={!rateLimiter.canProceed()}
            showTemplates={showTemplates}
            onToggleTemplates={() => setShowTemplates(prev => !prev)}
          />
        </div>
      </div>
    </div>
  );
}