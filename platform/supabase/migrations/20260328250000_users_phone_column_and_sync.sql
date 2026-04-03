-- Contact phone on app profile; copied from auth user_metadata on signup (runs after typical handle_new_user insert).

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone text;

COMMENT ON COLUMN public.users.phone IS 'Member contact number; collected at registration.';

CREATE OR REPLACE FUNCTION public.sync_user_phone_from_auth_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p text := trim(coalesce(NEW.raw_user_meta_data->>'phone', ''));
BEGIN
  IF length(p) > 0 THEN
    UPDATE public.users
    SET phone = p
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzz_sync_user_phone_from_metadata ON auth.users;
CREATE TRIGGER zzz_sync_user_phone_from_metadata
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_phone_from_auth_metadata();
