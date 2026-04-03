-- Add lightweight reply threading fields for emergency chat.
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id uuid REFERENCES public.chat_messages (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reply_preview_text text;

CREATE INDEX IF NOT EXISTS idx_chat_messages_reply_to_message_id
  ON public.chat_messages (reply_to_message_id);
