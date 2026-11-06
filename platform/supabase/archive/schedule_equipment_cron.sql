-- Optional: run once in the Supabase SQL editor after
-- public.run_equipment_housekeeping() exists
-- (migration 20261106180200_equipment_custody_cron.sql).
-- Enable the extension first: Dashboard -> Database -> Extensions -> pg_cron.
-- The migration also schedules this job when pg_cron is already installed.
-- It does not fail the migration when the extension is absent.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $$
DECLARE
  jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'equipment_housekeeping_15m';
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END $$;

SELECT cron.schedule(
  'equipment_housekeeping_15m',
  '*/15 * * * *',
  $$SELECT public.run_equipment_housekeeping();$$
);
