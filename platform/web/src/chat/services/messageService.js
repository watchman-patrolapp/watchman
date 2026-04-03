// src/chat/services/messageService.js
import { supabase } from '../../supabase/client';
import { APP_CONFIG, MessageType } from '../utils/constants';
import { sanitizeInput } from '../utils/security';

/** Duplicate read row (PK message_id, user_id) — not a failure. */
function isChatReadDuplicateError(error) {
  if (!error) return false;
  if (String(error.code) === '23505') return true;
  const blob = `${error.message || ''} ${error.details || ''}`.toLowerCase();
  return blob.includes('duplicate') || blob.includes('unique constraint');
}

class MessageService {
  constructor() {
    this.channel = null;
    this.reactionChannel = null;
    this.subscribers = new Map();
    this.reactionSubscribers = new Map();
  }

  // Ensure we have a valid session before making requests
  async #ensureSession() {
    let { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (session) return session;

    // If no session, try to refresh (this may happen if the token expired)
    const { data: { session: refreshed }, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) throw refreshError;
    if (!refreshed) throw new Error('No active session');
    return refreshed;
  }

  subscribe(callback) {
    const id = crypto.randomUUID();
    this.subscribers.set(id, callback);

    if (!this.channel) {
      this.channel = supabase
        .channel('emergency-chat')
        .on('postgres_changes', 
          { event: 'INSERT', schema: 'public', table: 'chat_messages' },
          (payload) => {
            this.subscribers.forEach(cb => {
              try { cb(payload.new); } catch (e) { console.error(e); }
            });
          }
        )
        .subscribe();
    }

    return () => {
      this.subscribers.delete(id);
      if (this.subscribers.size === 0) {
        supabase.removeChannel(this.channel);
        this.channel = null;
      }
    };
  }

  subscribeReactions(callback) {
    const id = crypto.randomUUID();
    this.reactionSubscribers.set(id, callback);

    if (!this.reactionChannel) {
      this.reactionChannel = supabase
        .channel('emergency-chat-reactions')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'chat_message_reactions' },
          (payload) => {
            this.reactionSubscribers.forEach((cb) => {
              try {
                cb(payload);
              } catch (e) {
                console.error(e);
              }
            });
          }
        )
        .subscribe();
    }

    return () => {
      this.reactionSubscribers.delete(id);
      if (this.reactionSubscribers.size === 0) {
        supabase.removeChannel(this.reactionChannel);
        this.reactionChannel = null;
      }
    };
  }

  async fetchMessages(limit = APP_CONFIG.MAX_MESSAGES) {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  async fetchReactions(messageIds = []) {
    if (!messageIds.length) return [];
    const { data, error } = await supabase
      .from('chat_message_reactions')
      .select('message_id, user_id, reaction')
      .in('message_id', messageIds);

    if (error) throw error;
    return data || [];
  }

  async sendText({ text, senderId, senderName, senderAvatar, isCritical, replyToMessageId = null, replyPreviewText = null }) {
    await this.#ensureSession();

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        sender_id: senderId,
        sender_name: sanitizeInput(senderName),
        sender_avatar: senderAvatar,
        text: sanitizeInput(text),
        type: MessageType.TEXT,
        is_critical: isCritical,
        reply_to_message_id: replyToMessageId,
        reply_preview_text: replyPreviewText ? sanitizeInput(replyPreviewText).slice(0, 180) : null,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async sendImage({ fileUrl, senderId, senderName, senderAvatar, width, height, replyToMessageId = null, replyPreviewText = null }) {
    await this.#ensureSession();

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        sender_id: senderId,
        sender_name: sanitizeInput(senderName),
        sender_avatar: senderAvatar,
        type: MessageType.IMAGE,
        media_url: fileUrl,
        media_width: width,
        media_height: height,
        text: '',
        is_critical: false,
        reply_to_message_id: replyToMessageId,
        reply_preview_text: replyPreviewText ? sanitizeInput(replyPreviewText).slice(0, 180) : null,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async sendVoice({ fileUrl, duration, senderId, senderName, senderAvatar, replyToMessageId = null, replyPreviewText = null }) {
    await this.#ensureSession();

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        sender_id: senderId,
        sender_name: sanitizeInput(senderName),
        sender_avatar: senderAvatar,
        type: MessageType.VOICE,
        media_url: fileUrl,
        duration,
        text: '',
        is_critical: false,
        reply_to_message_id: replyToMessageId,
        reply_preview_text: replyPreviewText ? sanitizeInput(replyPreviewText).slice(0, 180) : null,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async sendLocation({ lat, lng, address, text, senderId, senderName, senderAvatar, isCritical = false, replyToMessageId = null, replyPreviewText = null }) {
    await this.#ensureSession();

    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      throw new Error('Invalid coordinates');
    }

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        sender_id: senderId,
        sender_name: sanitizeInput(senderName),
        sender_avatar: senderAvatar,
        type: MessageType.LOCATION,
        location_lat: latNum,
        location_lng: lngNum,
        location_address: address ? sanitizeInput(address) : null,
        text: text ? sanitizeInput(text) : '',
        is_critical: isCritical,
        reply_to_message_id: replyToMessageId,
        reply_preview_text: replyPreviewText ? sanitizeInput(replyPreviewText).slice(0, 180) : null,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /** Record that the current user viewed another member's critical message. */
  async markCriticalRead(messageId) {
    const session = await this.#ensureSession();
    if (!session?.user?.id || !messageId) return;

    // Prefer ignore-duplicates so PostgREST does not return 409 when the row already exists
    // (e.g. React Strict Mode, IntersectionObserver, or revisiting the same critical message).
    const { error } = await supabase.from('chat_message_reads').upsert(
      {
        message_id: messageId,
        user_id: session.user.id,
      },
      { onConflict: 'message_id,user_id', ignoreDuplicates: true }
    );
    if (error && !isChatReadDuplicateError(error)) {
      console.warn('markCriticalRead:', error.message || error);
    }
  }

  async addReaction({ messageId, reaction, userId }) {
    await this.#ensureSession();
    const { error } = await supabase.from('chat_message_reactions').insert({
      message_id: messageId,
      user_id: userId,
      reaction,
    });
    if (error && String(error.code) !== '23505') throw error;
  }

  async removeReaction({ messageId, reaction, userId }) {
    await this.#ensureSession();
    const { error } = await supabase
      .from('chat_message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('reaction', reaction);
    if (error) throw error;
  }
}

export const messageService = new MessageService();