import { useState, useEffect, useCallback } from 'react';
import { queueMediaPut, queueMediaDelete } from '../utils/queueMediaDB';
import { installChatQueueRunner, setChatQueueOnline } from '../utils/chatQueueRunner';
import {
  CHAT_QUEUE_CHANGED_EVENT,
  enqueueChatQueueItem,
  readChatQueue,
  removeChatQueueItem,
  writeChatQueue,
} from '../utils/chatQueueStorage';

function stripForStorage(msg) {
  const rest = { ...msg };
  delete rest.file;
  delete rest.blob;
  return rest;
}

export const useMessageQueue = (isOnline) => {
  const [queue, setQueue] = useState(() => readChatQueue());

  useEffect(() => {
    installChatQueueRunner();
    setChatQueueOnline(isOnline);
    return () => setChatQueueOnline(null);
  }, [isOnline]);

  useEffect(() => {
    const sync = () => setQueue(readChatQueue());
    window.addEventListener(CHAT_QUEUE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(CHAT_QUEUE_CHANGED_EVENT, sync);
  }, []);

  const addToQueue = useCallback((message) => {
    void (async () => {
      try {
        if (!message?.localId) {
          console.warn('[chat] addToQueue skipped: missing localId');
          return;
        }
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
        enqueueChatQueueItem(serial);
        setQueue(readChatQueue());
      } catch (e) {
        console.error('[chat] addToQueue failed', e);
      }
    })();
  }, []);

  const removeFromQueue = useCallback((localId) => {
    removeChatQueueItem(localId);
    setQueue(readChatQueue());
    void queueMediaDelete(localId);
  }, []);

  const clearQueue = useCallback(() => {
    readChatQueue().forEach((row) => {
      if (row._mediaKey) void queueMediaDelete(row._mediaKey);
    });
    writeChatQueue([]);
    setQueue([]);
  }, []);

  return { queue, addToQueue, removeFromQueue, clearQueue, queueLength: queue.length };
};
