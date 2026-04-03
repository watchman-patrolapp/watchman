import { useState, useEffect, useCallback, useRef } from 'react';
import { APP_CONFIG } from '../utils/constants';
import { flushChatQueueItem } from '../services/chatQueueFlush';
import { queueMediaPut, queueMediaDelete } from '../utils/queueMediaDB';

const STORAGE_KEY = 'chat_message_queue';

function stripForStorage(msg) {
  const { file, blob, ...rest } = msg;
  return rest;
}

export const useMessageQueue = (isOnline) => {
  const [queue, setQueue] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const flushInProgressRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.warn('[chat] queue persist failed', e);
    }
  }, [queue]);

  const addToQueue = useCallback((message) => {
    void (async () => {
      try {
        const serial = stripForStorage(message);
        if (message.file && message.localId) {
          serial._mediaKey = message.localId;
          serial._mimeType = message.file.type || 'image/jpeg';
          serial._fileName = message.file.name || 'photo.jpg';
          const ab = await message.file.arrayBuffer();
          await queueMediaPut(message.localId, ab);
        } else if (message.blob && message.localId) {
          serial._mediaKey = message.localId;
          serial._mimeType = message.blob.type || 'audio/webm';
          const ab = await message.blob.arrayBuffer();
          await queueMediaPut(message.localId, ab);
        }
        setQueue((prev) => [...prev, { ...serial, queuedAt: Date.now() }]);
      } catch (e) {
        console.error('[chat] addToQueue failed', e);
      }
    })();
  }, []);

  const removeFromQueue = useCallback((localId) => {
    setQueue((prev) => prev.filter((m) => m.localId !== localId));
    void queueMediaDelete(localId);
  }, []);

  const clearQueue = useCallback(() => {
    setQueue((prev) => {
      prev.forEach((m) => {
        if (m._mediaKey) void queueMediaDelete(m._mediaKey);
      });
      return [];
    });
  }, []);

  useEffect(() => {
    if (!isOnline || queue.length === 0) return undefined;

    let cancelled = false;

    const tick = async () => {
      if (cancelled || flushInProgressRef.current || queue.length === 0) return;
      flushInProgressRef.current = true;
      const sorted = [...queue].sort((a, b) => {
        if (a.is_emergency && !b.is_emergency) return -1;
        if (!a.is_emergency && b.is_emergency) return 1;
        return (a.queuedAt || 0) - (b.queuedAt || 0);
      });
      const item = sorted[0];
      try {
        const { ok } = await flushChatQueueItem(item);
        if (ok && !cancelled) {
          removeFromQueue(item.localId);
        }
      } finally {
        flushInProgressRef.current = false;
      }
    };

    void tick();
    const id = setInterval(tick, APP_CONFIG.OFFLINE_RETRY_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isOnline, queue, removeFromQueue]);

  return { queue, addToQueue, removeFromQueue, clearQueue, queueLength: queue.length };
};
