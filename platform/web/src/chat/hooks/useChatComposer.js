import { useCallback } from 'react';
import { messageService } from '../services/messageService';
import { storageService } from '../services/storageService';
import { detectCriticalMessage, generateSecureId, RateLimiter } from '../utils/security';
import { objectUrlManager } from '../utils/objectUrlManager';
import { MessageType, MessageStatus, EmergencyLevel } from '../utils/constants';
import { playMessageSent } from '../../utils/sound';
import { devLog } from '../../utils/devLog';
import toast from '../../utils/notify';
import { captureChatError } from '../utils/chatTelemetry';
import { getChatGeolocationPosition } from '../utils/getChatGeolocation';
import { parseChatLocationPosition } from '../utils/chatLocation';
import { summarizeMessageForReply } from '../utils/chatMessageMerge';

export const chatInputRateLimiter = new RateLimiter(30, 60000);

export function useChatComposer({
  user,
  isOnline,
  addToQueue,
  scrollToBottom,
  replyToMessage,
  setReplyToMessage,
  setMessages,
  setIsEmergencyMode,
  isMountedRef,
  chatChannelRef,
}) {
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
      visibility: chatChannelRef.current,
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
            visibility: chatChannelRef.current,
            replyToMessageId: replyToMessage?.id || null,
            replyPreviewText,
            clientMessageId: localId,
          });
        } else {
          sent = await messageService.sendText({
            text: messageContent.text,
            senderId: user.id,
            senderName: user.fullName || user.email,
            senderAvatar: user.avatarUrl,
            isCritical: templateData.isCritical,
            visibility: chatChannelRef.current,
            replyToMessageId: replyToMessage?.id || null,
            replyPreviewText,
            clientMessageId: localId,
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
  }, [user, isOnline, addToQueue, scrollToBottom, replyToMessage, setReplyToMessage, setMessages, setIsEmergencyMode, isMountedRef, chatChannelRef]);

  const handleSendText = useCallback(async (text, options = {}) => {
    if (!chatInputRateLimiter.canProceed()) {
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
      visibility: chatChannelRef.current,
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
        visibility: chatChannelRef.current,
        replyToMessageId,
        replyPreviewText,
        clientMessageId: localId,
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
  }, [user, isOnline, addToQueue, scrollToBottom, replyToMessage, setReplyToMessage, setMessages, isMountedRef, chatChannelRef]);

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
      visibility: chatChannelRef.current,
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
        visibility: chatChannelRef.current,
        replyToMessageId: replyToMessage?.id || null,
        replyPreviewText:
          replyToMessage?.reply_preview_text || summarizeMessageForReply(replyToMessage) || null,
        clientMessageId: localId,
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
  }, [user, addToQueue, scrollToBottom, replyToMessage, setReplyToMessage, setMessages, isMountedRef, chatChannelRef]);

  const handleSendVoice = useCallback(async (blob, duration, previewUrl) => {
    const localId = generateSecureId();

    const objectUrl = previewUrl || objectUrlManager.create(blob, localId);

    const optimisticMessage = {
      localId,
      text: '',
      type: MessageType.VOICE,
      media_url: objectUrl,
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
      visibility: chatChannelRef.current,
    };

    if (isMountedRef.current) {
      setMessages(prev => [...prev, optimisticMessage]);
      scrollToBottom();
    }

    try {
      const { url: storageUrl } = await storageService.uploadVoice(blob, duration);
      devLog('Voice uploaded to:', storageUrl);

      const sent = await messageService.sendVoice({
        fileUrl: storageUrl,
        duration,
        senderId: user.id,
        senderName: user.fullName || user.email,
        senderAvatar: user.avatarUrl,
        visibility: chatChannelRef.current,
        replyToMessageId: replyToMessage?.id || null,
        replyPreviewText:
          replyToMessage?.reply_preview_text || summarizeMessageForReply(replyToMessage) || null,
        clientMessageId: localId,
      });

      devLog('Message saved to DB:', sent);

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
            media_url: storageUrl,
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
  }, [user, addToQueue, scrollToBottom, replyToMessage, setReplyToMessage, setMessages, isMountedRef, chatChannelRef]);

  const handleSendLocation = useCallback(async (position) => {
    if (!user?.id) {
      toast.error('You must be signed in to send location');
      return;
    }

    const parsed = parseChatLocationPosition(position);
    if (!parsed.ok) {
      if (parsed.reason === 'coordinates') {
        console.error('Invalid coordinates:', {
          latitude: parsed.latitude,
          longitude: parsed.longitude,
          lat: parsed.lat,
          lng: parsed.lng,
        });
        toast.error('Invalid location coordinates');
      } else {
        console.error('Invalid position format received:', position);
        toast.error('Invalid location data received');
      }
      return;
    }

    const { lat, lng } = parsed;

    if (!isMountedRef.current) return;

    try {
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
          devLog('Geocoding failed (non-critical):', e);
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
        visibility: chatChannelRef.current,
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
          visibility: chatChannelRef.current,
          replyToMessageId: replyToMessage?.id || null,
          replyPreviewText:
            replyToMessage?.reply_preview_text || summarizeMessageForReply(replyToMessage) || null,
          clientMessageId: localId,
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
  }, [user, isOnline, addToQueue, scrollToBottom, replyToMessage, setReplyToMessage, setMessages, isMountedRef, chatChannelRef]);

  const getLocation = useCallback(() => {
    return getChatGeolocationPosition({ quick: true }).then((pos) => ({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
    }));
  }, []);

  return {
    handleQuickSend,
    handleSendText,
    handleSendImage,
    handleSendVoice,
    handleSendLocation,
    getLocation,
  };
}
