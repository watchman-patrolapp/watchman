-- Allow cable / infrastructure theft pins on the Hotspots map
-- (confirmed and attempted), in addition to break-ins.

DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'hotspot_events'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%kind%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.hotspot_events DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE public.hotspot_events
  ADD CONSTRAINT hotspot_events_kind_check
  CHECK (
    kind IN (
      'break_in',
      'attempted_break_in',
      'cable_theft',
      'attempted_cable_theft'
    )
  );

COMMENT ON TABLE public.hotspot_events IS
  'Hotspot pins: confirmed/attempted break-ins and cable/infrastructure theft. Separate from full incident reports.';
