-- Rename legacy beta zone label to Theescombe (matches app DEFAULT_PATROL_ZONE).

UPDATE public.patrol_logs SET zone = 'Theescombe' WHERE lower(trim(zone)) = 'zone a';
UPDATE public.patrol_slots SET zone = 'Theescombe' WHERE lower(trim(zone)) = 'zone a';
UPDATE public.active_patrols SET zone = 'Theescombe' WHERE lower(trim(zone)) = 'zone a';
