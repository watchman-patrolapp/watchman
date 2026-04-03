-- Normalize any remaining "Zone A" style labels to Theescombe (broader match than 20260328230000).
-- Catches extra whitespace or odd casing; safe to re-run (idempotent for already-Theescombe rows).

UPDATE public.patrol_logs
SET zone = 'Theescombe'
WHERE zone IS NOT NULL
  AND trim(zone) <> ''
  AND zone ~* '^[[:space:]]*zone[[:space:]]+a[[:space:]]*$';

UPDATE public.patrol_slots
SET zone = 'Theescombe'
WHERE zone IS NOT NULL
  AND trim(zone) <> ''
  AND zone ~* '^[[:space:]]*zone[[:space:]]+a[[:space:]]*$';

UPDATE public.active_patrols
SET zone = 'Theescombe'
WHERE zone IS NOT NULL
  AND trim(zone) <> ''
  AND zone ~* '^[[:space:]]*zone[[:space:]]+a[[:space:]]*$';
