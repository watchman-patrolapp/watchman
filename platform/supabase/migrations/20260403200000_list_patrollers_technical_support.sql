-- Include technical_support in criminal profile sighting "seen by" directory (matches app PATROLLER_DIRECTORY_ROLES).

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
    'admin',
    'technical_support'
  )
  ORDER BY lower(trim(coalesce(u.full_name, u.email, ''))), u.id;
$$;

COMMENT ON FUNCTION public.list_patrollers_for_sightings() IS
  'Alphabetical directory for sighting attribution: patrollers, investigators, committee, admin, technical_support.';
