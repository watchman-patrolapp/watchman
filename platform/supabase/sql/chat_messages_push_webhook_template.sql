-- =============================================================================
-- Template: DB trigger → notify-chat-message Edge Function (pg_net)
-- =============================================================================
-- 1. Set the SAME secret in Edge secrets: CHAT_NOTIFY_WEBHOOK_SECRET
-- 2. Replace __PROJECT_REF__ (e.g. pfjcxewlsqmfajrogvdo)
-- 3. Replace __CHAT_NOTIFY_WEBHOOK_SECRET__ (same value as step 1)
-- 4. Run in SQL Editor or: npx supabase db query --linked -f this-file.sql
--
-- If you already use Dashboard → Database Webhooks on chat_messages, remove that
-- webhook first or you will send duplicate pushes.
-- =============================================================================

DROP TRIGGER IF EXISTS chat_messages_notify_push ON public.chat_messages;
DROP FUNCTION IF EXISTS public.notify_chat_message_push_webhook();

CREATE OR REPLACE FUNCTION public.notify_chat_message_push_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  payload jsonb;
BEGIN
  payload := jsonb_build_object(
    'type', 'INSERT',
    'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA,
    'record', row_to_json(NEW)::jsonb,
    'old_record', NULL
  );
  PERFORM net.http_post(
    url := 'https://__PROJECT_REF__.supabase.co/functions/v1/notify-chat-message',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-chat-notify-secret', '__CHAT_NOTIFY_WEBHOOK_SECRET__'
    ),
    body := payload
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER chat_messages_notify_push
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_chat_message_push_webhook();
