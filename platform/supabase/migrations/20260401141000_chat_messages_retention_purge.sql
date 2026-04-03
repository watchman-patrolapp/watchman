-- Emergency chat: hard-delete helper for messages older than 180 days (privacy policy: admin chat logs 6 months).
-- Schedule daily execution via pg_cron — run supabase/sql/schedule_chat_retention_cron.sql in the SQL Editor
-- after enabling the pg_cron extension (Database → Extensions), or use Supabase scheduled Edge Function / external cron.

CREATE OR REPLACE FUNCTION public.run_chat_messages_retention_purge()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count int;
BEGIN
  DELETE FROM public.chat_messages
  WHERE created_at < now() - interval '180 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.run_chat_messages_retention_purge() FROM PUBLIC;

CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at_retention
  ON public.chat_messages (created_at);

COMMENT ON FUNCTION public.run_chat_messages_retention_purge() IS
  'Deletes chat_messages with created_at older than 180 days. Schedule with pg_cron or external runner.';
