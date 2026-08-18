-- Optional next-of-kin relationship for SOS: spouse, parent, neighbour, etc.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship text;

CREATE OR REPLACE FUNCTION public.normalize_emergency_contact_relationship(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE replace(replace(lower(trim(coalesce(p_value, ''))), '-', '_'), ' ', '_')
    WHEN 'spouse' THEN 'spouse'
    WHEN 'partner' THEN 'spouse'
    WHEN 'husband' THEN 'spouse'
    WHEN 'wife' THEN 'spouse'
    WHEN 'parent' THEN 'parent'
    WHEN 'mother' THEN 'parent'
    WHEN 'father' THEN 'parent'
    WHEN 'child' THEN 'child'
    WHEN 'son' THEN 'child'
    WHEN 'daughter' THEN 'child'
    WHEN 'sibling' THEN 'sibling'
    WHEN 'brother' THEN 'sibling'
    WHEN 'sister' THEN 'sibling'
    WHEN 'in_law' THEN 'in_law'
    WHEN 'inlaw' THEN 'in_law'
    WHEN 'in_laws' THEN 'in_law'
    WHEN 'inlaws' THEN 'in_law'
    WHEN 'mother_in_law' THEN 'in_law'
    WHEN 'father_in_law' THEN 'in_law'
    WHEN 'son_in_law' THEN 'in_law'
    WHEN 'daughter_in_law' THEN 'in_law'
    WHEN 'brother_in_law' THEN 'in_law'
    WHEN 'sister_in_law' THEN 'in_law'
    WHEN 'family' THEN 'family'
    WHEN 'relative' THEN 'family'
    WHEN 'relatives' THEN 'family'
    WHEN 'aunt' THEN 'family'
    WHEN 'uncle' THEN 'family'
    WHEN 'cousin' THEN 'family'
    WHEN 'grandparent' THEN 'family'
    WHEN 'grandchild' THEN 'family'
    WHEN 'neighbour' THEN 'neighbour'
    WHEN 'neighbor' THEN 'neighbour'
    WHEN 'friend' THEN 'friend'
    WHEN 'other' THEN 'other'
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.normalize_emergency_contact_relationship(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_emergency_contact_relationship(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_emergency_contact_relationship(text) TO service_role;

DROP FUNCTION IF EXISTS public.set_my_emergency_contact(uuid, text, text, boolean);

CREATE OR REPLACE FUNCTION public.set_my_emergency_contact(
  p_contact_user_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_clear boolean DEFAULT false,
  p_relationship text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  contact public.users;
  name_text text;
  phone_text text;
  rel_text text := public.normalize_emergency_contact_relationship(p_relationship);
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_clear THEN
    UPDATE public.users
    SET
      emergency_contact_user_id = NULL,
      emergency_contact_name = NULL,
      emergency_contact_phone = NULL,
      emergency_contact_relationship = NULL
    WHERE id = uid;
    RETURN jsonb_build_object('ok', true, 'cleared', true);
  END IF;

  IF p_contact_user_id IS NOT NULL THEN
    IF p_contact_user_id = uid THEN
      RAISE EXCEPTION 'you cannot list yourself as next of kin';
    END IF;
    IF NOT public.resident_in_caller_scope(p_contact_user_id) THEN
      RAISE EXCEPTION 'that person is not in your neighborhood';
    END IF;

    SELECT * INTO contact
    FROM public.users
    WHERE id = p_contact_user_id;

    IF contact.id IS NULL THEN
      RAISE EXCEPTION 'resident not found';
    END IF;

    name_text := nullif(trim(contact.full_name), '');
    phone_text := nullif(trim(contact.phone), '');

    UPDATE public.users
    SET
      emergency_contact_user_id = contact.id,
      emergency_contact_name = name_text,
      emergency_contact_phone = phone_text,
      emergency_contact_relationship = rel_text
    WHERE id = uid;

    RETURN jsonb_build_object(
      'ok', true,
      'emergency_contact_user_id', contact.id,
      'emergency_contact_name', name_text,
      'emergency_contact_phone', phone_text,
      'emergency_contact_relationship', rel_text
    );
  END IF;

  name_text := nullif(trim(p_name), '');
  phone_text := nullif(trim(p_phone), '');
  IF name_text IS NULL AND phone_text IS NULL THEN
    RAISE EXCEPTION 'enter a name and phone, or pick a neighbour';
  END IF;
  IF phone_text IS NOT NULL AND length(regexp_replace(phone_text, '\D', '', 'g')) < 10 THEN
    RAISE EXCEPTION 'enter a valid emergency contact number, or leave it blank';
  END IF;

  UPDATE public.users
  SET
    emergency_contact_user_id = NULL,
    emergency_contact_name = name_text,
    emergency_contact_phone = phone_text,
    emergency_contact_relationship = rel_text
  WHERE id = uid;

  RETURN jsonb_build_object(
    'ok', true,
    'emergency_contact_user_id', NULL,
    'emergency_contact_name', name_text,
    'emergency_contact_phone', phone_text,
    'emergency_contact_relationship', rel_text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_emergency_contact(uuid, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_emergency_contact(uuid, text, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_emergency_contact(uuid, text, text, boolean, text) TO service_role;

COMMENT ON COLUMN public.users.emergency_contact_relationship IS
  'Optional next-of-kin relationship: spouse, parent, child, sibling, in_law, family, neighbour, friend, other.';

COMMENT ON FUNCTION public.set_my_emergency_contact(uuid, text, text, boolean, text) IS
  'Save own next of kin: pick a neighbour (copies live name/phone), type a name and number, optional relationship, or clear.';

-- Copy relationship from signup metadata without rewriting apply_signup_profile_for_user.
DO $$
BEGIN
  IF to_regprocedure('public.apply_signup_profile_for_user_core(uuid)') IS NULL
     AND to_regprocedure('public.apply_signup_profile_for_user(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.apply_signup_profile_for_user(uuid)
      RENAME TO apply_signup_profile_for_user_core;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.apply_signup_profile_for_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  rel text;
BEGIN
  result := public.apply_signup_profile_for_user_core(p_user_id);

  SELECT public.normalize_emergency_contact_relationship(
    au.raw_user_meta_data->>'emergency_contact_relationship'
  )
  INTO rel
  FROM auth.users au
  WHERE au.id = p_user_id;

  IF rel IS NOT NULL THEN
    UPDATE public.users
    SET emergency_contact_relationship = CASE
      WHEN emergency_contact_relationship IS NULL
        OR btrim(emergency_contact_relationship) = '' THEN rel
      ELSE emergency_contact_relationship
    END
    WHERE id = p_user_id;
  END IF;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_signup_profile_for_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_signup_profile_for_user(uuid) TO service_role;

DO $$
BEGIN
  IF to_regprocedure('public.apply_signup_profile_for_user_core(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.apply_signup_profile_for_user_core(uuid) FROM PUBLIC;
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.apply_signup_profile_for_user_core(uuid) TO service_role';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
