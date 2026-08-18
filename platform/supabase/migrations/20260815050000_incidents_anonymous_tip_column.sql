-- Resident activity reports store anonymous-tip flags on incidents.
-- Safe to re-run if 20260815025000 was skipped.

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS is_anonymous_tip boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS legal_acknowledged_at timestamptz;

NOTIFY pgrst, 'reload schema';
