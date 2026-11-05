-- Run once in Supabase Dashboard → SQL Editor (fixes: sightings_log column + list_patrollers_for_sightings RPC).
-- After running, wait a few seconds or restart the project if PostgREST still reports schema cache errors.

ALTER TABLE public.criminal_profiles
  ADD COLUMN IF NOT EXISTS sightings_log jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.criminal_profiles.sightings_log IS
  'Array of sighting entries. Legacy last_seen_* columns mirror the latest entry for compatibility.';

CREATE OR REPLACE FUNCTION public.list_patrollers_for_sightings()
RETURNS TABLE (
  id uuid,
  full_name text,
  email text,
  avatar_url text,
  role text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT u.id, u.full_name, u.email, u.avatar_url, u.role::text
  FROM public.users u
  WHERE lower(trim(coalesce(u.role::text, ''))) IN (
    'patroller',
    'investigator',
    'committee',
    'admin'
  )
  ORDER BY lower(trim(coalesce(u.full_name, u.email, ''))), u.id;
$$;

REVOKE ALL ON FUNCTION public.list_patrollers_for_sightings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_patrollers_for_sightings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_patrollers_for_sightings() TO service_role;

COMMENT ON FUNCTION public.list_patrollers_for_sightings() IS
  'Alphabetical directory of patrollers, investigators, committee, and admins for criminal profile sighting attribution.';
