// src/chat/services/messageService.js
import { supabase } from '../../supabase/client';
import { APP_CONFIG, MessageType } from '../utils/constants';
import { sanitizeInput } from '../utils/security';

class MessageService {
  constructor() {
    this.channel = null;
    this.subscribers = new Map();
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

  async sendText({ text, senderId, senderName, senderAvatar, isCritical }) {
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
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async sendImage({ fileUrl, senderId, senderName, senderAvatar, width, height }) {
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
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async sendVoice({ fileUrl, duration, senderId, senderName, senderAvatar }) {
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
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async sendLocation({ lat, lng, address, text, senderId, senderName, senderAvatar, isCritical = false }) {
    await this.#ensureSession();

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        sender_id: senderId,
        sender_name: sanitizeInput(senderName),
        sender_avatar: senderAvatar,
        type: MessageType.LOCATION,
        location_lat: lat,
        location_lng: lng,
        location_address: address ? sanitizeInput(address) : null,
        text: text ? sanitizeInput(text) : '',
        is_critical: isCritical,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

export const messageService = new MessageService();