// src/chat/hooks/useMessageQueue.js
import { useState, useEffect, useCallback } from 'react';
import { APP_CONFIG } from '../utils/constants';

const STORAGE_KEY = 'chat_message_queue';

export const useMessageQueue = (isOnline) => {
  const [queue, setQueue] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Persist queue
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  }, [queue]);

  const addToQueue = useCallback((message) => {
    setQueue(prev => [...prev, { ...message, queuedAt: Date.now() }]);
  }, []);

  const removeFromQueue = useCallback((localId) => {
    setQueue(prev => prev.filter(m => m.localId !== localId));
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
  }, []);

  // Process queue when online
  useEffect(() => {
    if (!isOnline || queue.length === 0) return;

    const processQueue = async () => {
      // Process emergency messages first
      const sorted = [...queue].sort((a, b) => {
        if (a.isEmergency && !b.isEmergency) return -1;
        if (!a.isEmergency && b.isEmergency) return 1;
        return 0;
      });

      for (const _ of sorted) {
        // TODO: Implement message sending logic here
        // On success: removeFromQueue(_.localId)
      }
    };

    const interval = setInterval(processQueue, APP_CONFIG.OFFLINE_RETRY_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isOnline, queue]);

  return { queue, addToQueue, removeFromQueue, clearQueue, queueLength: queue.length };
};