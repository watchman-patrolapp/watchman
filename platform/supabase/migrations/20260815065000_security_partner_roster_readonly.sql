-- Security partners may view neighborhood rosters, not book or cancel slots.

DROP FUNCTION IF EXISTS public.security_partner_signup_patrol_slot(uuid, date, text, text);
