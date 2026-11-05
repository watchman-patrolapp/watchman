-- Optional: run once in Supabase SQL Editor after chat_messages exists and
-- public.run_chat_messages_retention_purge() is deployed (migration 20260401141000).
-- Enable extension: Dashboard → Database → Extensions → pg_cron.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $$
DECLARE
  jid int;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'chat_messages_retention_6mo';
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END $$;

SELECT cron.schedule(
  'chat_messages_retention_6mo',
  '25 5 * * *',
  $$SELECT public.run_chat_messages_retention_purge();$$
);
