-- Idempotent chat sends: offline/retry reuse the same client_message_id
-- so a second insert does not create a duplicate row.

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS client_message_id text;

COMMENT ON COLUMN public.chat_messages.client_message_id IS
  'Client-generated idempotency key (optimistic localId). Unique per sender when set.';

CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_sender_client_message_id_uidx
  ON public.chat_messages (sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
