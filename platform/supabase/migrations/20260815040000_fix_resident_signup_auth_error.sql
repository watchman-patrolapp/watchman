-- Fix "Database error saving new user" on public resident signup.
-- Causes:
-- 1) handle_new_user copying metadata.role into public.users.role when
--    'resident' is not a valid enum/check value
-- 2) metadata.phone colliding with auth.users.phone (invalid format)
-- 3) auth.users AFTER INSERT triggers raising without an exception handler

DO $$
DECLARE
  role_type_name text;
  role_is_enum boolean := false;
  label text;
BEGIN
  SELECT t.typname, (t.typtype = 'e')
    INTO role_type_name, role_is_enum
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_type t ON t.oid = a.atttypid
  WHERE n.nspname = 'public'
    AND c.relname = 'users'
    AND a.attname = 'role'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF role_is_enum AND role_type_name IS NOT NULL THEN
    FOREACH label IN ARRAY ARRAY[
      'user',
      'volunteer',
      'patroller',
      'resident',
      'committee',
      'investigator',
      'admin',
      'technical_support',
      'nw_admin',
      'security_admin',
      'city_admin'
    ]
    LOOP
      BEGIN
        EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', role_type_name, label);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END LOOP;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ensure_public_user_from_auth(
  p_id uuid,
  p_email text,
  p_full_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  try_role text;
  inserted boolean := false;
BEGIN
  IF p_id IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = p_id) THEN
    RETURN;
  END IF;

  FOREACH try_role IN ARRAY ARRAY['user', 'volunteer', 'patroller', 'resident']
  LOOP
    BEGIN
      INSERT INTO public.users (id, email, full_name, role)
      VALUES (p_id, p_email, p_full_name, try_role);
      inserted := true;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      inserted := true;
      EXIT;
    WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  IF NOT inserted THEN
    BEGIN
      INSERT INTO public.users (id, email, full_name)
      VALUES (p_id, p_email, p_full_name);
    EXCEPTION WHEN unique_violation THEN
      NULL;
    WHEN OTHERS THEN
      BEGIN
        INSERT INTO public.users (id)
        VALUES (p_id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'ensure_public_user_from_auth failed: %', SQLERRM;
      END;
    END;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_public_user_from_auth(
    NEW.id,
    NEW.email,
    nullif(trim(coalesce(NEW.raw_user_meta_data->>'full_name', '')), '')
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.on_auth_user_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_public_user_from_auth(
    NEW.id,
    NEW.email,
    nullif(trim(coalesce(NEW.raw_user_meta_data->>'full_name', '')), '')
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'on_auth_user_created failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_user_phone_from_auth_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p text := trim(coalesce(
    NEW.raw_user_meta_data->>'contact_phone',
    NEW.raw_user_meta_data->>'phone',
    ''
  ));
BEGIN
  IF length(p) > 0 THEN
    UPDATE public.users
    SET phone = p
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sync_user_phone_from_auth_metadata failed: %', SQLERRM;
  RETURN NEW;
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

  BEGIN
    UPDATE auth.users
    SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
      || CASE
           WHEN coalesce(raw_user_meta_data, '{}'::jsonb) ? 'contact_phone'
             THEN jsonb_build_object('phone', raw_user_meta_data->>'contact_phone')
           ELSE '{}'::jsonb
         END
    WHERE id = NEW.id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM public.apply_signup_profile_for_user(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_apply_signup_profile failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
