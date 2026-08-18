-- Picking a registered neighbour stores relationship = neighbour when none was chosen.
-- Backfill existing linked next-of-kin rows that were saved before relationship existed.

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
    rel_text := coalesce(rel_text, 'neighbour');

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

UPDATE public.users
SET emergency_contact_relationship = 'neighbour'
WHERE emergency_contact_user_id IS NOT NULL
  AND (emergency_contact_relationship IS NULL OR btrim(emergency_contact_relationship) = '');

NOTIFY pgrst, 'reload schema';
