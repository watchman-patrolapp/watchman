-- Signup RPC was overwriting invite-only roles (admin, technical_support, …)
-- to resident on first login after 20260815031000, because signup_track was
-- null and auth metadata is not a public signup track.
-- Also restore platform console staff who were already demoted.

UPDATE public.users
SET
  role = CASE
    WHEN lower(trim(platform_role)) = 'platform_owner' THEN 'admin'
    ELSE 'technical_support'
  END,
  signup_track = 'invite'
WHERE lower(trim(coalesce(platform_role, 'none'))) IN (
    'platform_owner',
    'platform_ops',
    'platform_support'
  )
  AND lower(trim(role::text)) IN ('resident', 'user');

UPDATE public.users
SET signup_track = 'invite'
WHERE lower(trim(role::text)) IN (
    'admin',
    'technical_support',
    'city_admin',
    'committee',
    'investigator'
  )
  AND (
    signup_track IS NULL
    OR btrim(signup_track) = ''
    OR lower(trim(signup_track)) IN ('resident', 'user')
  );

CREATE OR REPLACE FUNCTION public.apply_my_signup_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_authenticated');
  END IF;

  SELECT lower(trim(coalesce(role::text, '')))
    INTO existing_role
  FROM public.users
  WHERE id = auth.uid();

  IF existing_role IN (
    'admin',
    'technical_support',
    'city_admin',
    'committee',
    'investigator',
    'nw_admin',
    'security_admin'
  ) THEN
    UPDATE public.users
    SET signup_track = coalesce(nullif(btrim(coalesce(signup_track, '')), ''), 'invite')
    WHERE id = auth.uid()
      AND (signup_track IS NULL OR btrim(signup_track) = '');
    RETURN jsonb_build_object(
      'applied', false,
      'reason', 'privileged_role_preserved',
      'role', existing_role
    );
  END IF;

  RETURN public.apply_signup_profile_for_user(auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_apply_signup_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_role text;
BEGIN
  existing_role := lower(trim(coalesce(NEW.role::text, '')));
  IF existing_role IN (
    'admin',
    'technical_support',
    'city_admin',
    'committee',
    'investigator',
    'nw_admin',
    'security_admin'
  ) THEN
    UPDATE public.users
    SET signup_track = coalesce(nullif(btrim(coalesce(signup_track, '')), ''), 'invite')
    WHERE id = NEW.id
      AND (signup_track IS NULL OR btrim(signup_track) = '');
    RETURN NEW;
  END IF;

  PERFORM public.apply_signup_profile_for_user(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_apply_signup_profile failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
