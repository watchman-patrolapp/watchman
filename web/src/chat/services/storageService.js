// src/chat/services/storageService.js
import { supabase } from '../../supabase/client';
import { validateFile } from '../utils/security';

class StorageService {
  async uploadImage(file) {
    const validation = validateFile(file);
    if (!validation.valid) throw new Error(validation.error);

    const fileName = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.jpg`;
    
    const { error: uploadError } = await supabase.storage
      .from('chat-media')
      .upload(`images/${fileName}`, file, {
        contentType: 'image/jpeg',
        cacheControl: '3600',
      });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('chat-media')
      .getPublicUrl(`images/${fileName}`);

    return { url: publicUrl, path: `images/${fileName}` };
  }

  async uploadVoice(blob, duration) {
    // Determine file extension and MIME type based on blob type
    let extension = 'webm';
    let contentType = 'audio/webm';
    
    if (blob.type === 'audio/mp4' || blob.type.includes('mp4')) {
      extension = 'mp4';
      contentType = 'audio/mp4';
    } else if (blob.type.includes('webm')) {
      extension = 'webm';
      contentType = 'audio/webm';
    } else if (blob.type.includes('ogg')) {
      extension = 'ogg';
      contentType = 'audio/ogg';
    } else if (blob.type.includes('wav')) {
      extension = 'wav';
      contentType = 'audio/wav';
    }
    
    const fileName = `voice-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${extension}`;
    
    const { error: uploadError } = await supabase.storage
      .from('chat-media')
      .upload(`voice/${fileName}`, blob, {
        contentType: contentType,
      });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('chat-media')
      .getPublicUrl(`voice/${fileName}`);

    return { url: publicUrl, duration };
  }
}

export const storageService = new StorageService();