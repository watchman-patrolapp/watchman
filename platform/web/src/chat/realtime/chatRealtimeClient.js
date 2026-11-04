import { supabase } from '../../supabase/client';
import { createChatRealtimeHub } from './chatRealtime';

export const chatRealtime = createChatRealtimeHub({
  openChannel({ topic, filter, onInsert }) {
    const binding = {
      event: 'INSERT',
      schema: 'public',
      table: 'chat_messages',
    };
    if (filter) binding.filter = filter;
    const channel = supabase
      .channel(topic)
      .on('postgres_changes', binding, (payload) => {
        if (payload?.new) onInsert(payload.new);
      })
      .subscribe();
    return {
      close() {
        supabase.removeChannel(channel);
      },
    };
  },
});

export function subscribeChatMessages(handler, options) {
  return chatRealtime.subscribe(handler, options);
}

export function getChatRealtimeChannelCount() {
  return chatRealtime.getChannelCount();
}
