-- Sync phone into public.users without CREATE TRIGGER on auth.users.
-- Hosted Supabase returns ERROR: 42501: must be owner of relation users for triggers on auth.users.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone text;

COMMENT ON COLUMN public.users.phone IS 'Member contact number; collected at registration.';

CREATE OR REPLACE FUNCTION public.sync_my_phone_from_auth()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p text;
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT trim(coalesce(raw_user_meta_data->>'phone', '')) INTO p
  FROM auth.users
  WHERE id = uid;
  IF length(p) > 0 THEN
    UPDATE public.users
    SET phone = p
    WHERE id = uid;
    RETURN p;
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.sync_my_phone_from_auth() IS
  'Copies phone from auth metadata into public.users for the current user; callable from the app after sign-in.';

GRANT EXECUTE ON FUNCTION public.sync_my_phone_from_auth() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_my_phone_from_auth() TO service_role;

-- One-time backfill (safe to re-run: only fills empty public.users.phone when auth has phone)
UPDATE public.users u
SET phone = sub.p
FROM (
  SELECT
    id,
    trim(coalesce(raw_user_meta_data->>'phone', '')) AS p
  FROM auth.users
) sub
WHERE u.id = sub.id
  AND length(sub.p) > 0
  AND (u.phone IS NULL OR btrim(u.phone) = '');
