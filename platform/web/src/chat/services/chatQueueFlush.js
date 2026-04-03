import { messageService } from './messageService';
import { storageService } from './storageService';
import { MessageType } from '../utils/constants';
import { queueMediaDelete, queueMediaGet } from '../utils/queueMediaDB';
import { captureChatError } from '../utils/chatTelemetry';

/**
 * Send one queued item (after media restored from IndexedDB if needed).
 * @returns {{ ok: boolean, error?: Error }}
 */
export async function flushChatQueueItem(raw) {
  const item = { ...raw };
  const localId = item.localId;
  const senderId = item.sender_id;
  const senderName = item.sender_name;
  const senderAvatar = item.sender_avatar;

  try {
    if (item.type === MessageType.TEXT) {
      await messageService.sendText({
        text: item.text,
        senderId,
        senderName,
        senderAvatar,
        isCritical: !!item.is_critical,
      });
      return { ok: true };
    }

    if (item.type === MessageType.LOCATION) {
      await messageService.sendLocation({
        lat: item.location_lat,
        lng: item.location_lng,
        address: item.location_address,
        text: item.text || '',
        senderId,
        senderName,
        senderAvatar,
        isCritical: !!item.is_critical,
      });
      return { ok: true };
    }

    if (item.type === MessageType.IMAGE) {
      let file = item.file;
      if (!file && item._mediaKey) {
        const buf = await queueMediaGet(item._mediaKey);
        if (!buf) throw new Error('Queued image data missing');
        const mime = item._mimeType || 'image/jpeg';
        file = new File([buf], item._fileName || 'photo.jpg', { type: mime });
      }
      if (!file) throw new Error('No image file for queued message');
      const { url } = await storageService.uploadImage(file);
      await messageService.sendImage({
        fileUrl: url,
        senderId,
        senderName,
        senderAvatar,
      });
      if (item._mediaKey) await queueMediaDelete(item._mediaKey);
      return { ok: true };
    }

    if (item.type === MessageType.VOICE) {
      let blob = item.blob;
      if (!blob && item._mediaKey) {
        const buf = await queueMediaGet(item._mediaKey);
        if (!buf) throw new Error('Queued voice data missing');
        blob = new Blob([buf], { type: item._mimeType || 'audio/webm' });
      }
      if (!blob) throw new Error('No voice blob for queued message');
      const { url } = await storageService.uploadVoice(blob, item.duration || 0);
      await messageService.sendVoice({
        fileUrl: url,
        duration: item.duration || 0,
        senderId,
        senderName,
        senderAvatar,
      });
      if (item._mediaKey) await queueMediaDelete(item._mediaKey);
      return { ok: true };
    }

    return { ok: false, error: new Error(`Unknown queue type: ${item.type}`) };
  } catch (error) {
    captureChatError(error, { operation: 'flushChatQueueItem', localId, type: item.type });
    return { ok: false, error };
  }
}
