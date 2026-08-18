-- Optional next-of-kin: pick a registered neighbour or type a name and phone.
-- Patrollers need this on Verify residents for SOS / next-of-kin lookup.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS emergency_contact_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_emergency_contact_user_idx
  ON public.users (emergency_contact_user_id)
  WHERE emergency_contact_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.list_emergency_contact_candidates()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  street_label text,
  phone text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    u.full_name,
    public.resident_street_label(coalesce(nullif(trim(rp.home_address), ''), u.address)),
    coalesce(nullif(trim(u.phone), ''), '')
  FROM public.users u
  LEFT JOIN public.resident_profiles rp ON rp.user_id = u.id
  WHERE auth.uid() IS NOT NULL
    AND u.id <> auth.uid()
    AND public.resident_in_caller_scope(u.id)
    AND public.is_household_directory_role(u.role::text)
  ORDER BY u.full_name NULLS LAST, u.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_emergency_contact_candidates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_emergency_contact_candidates() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_emergency_contact_candidates() TO service_role;

CREATE OR REPLACE FUNCTION public.set_my_emergency_contact(
  p_contact_user_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_clear boolean DEFAULT false
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
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_clear THEN
    UPDATE public.users
    SET
      emergency_contact_user_id = NULL,
      emergency_contact_name = NULL,
      emergency_contact_phone = NULL
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
      emergency_contact_phone = phone_text
    WHERE id = uid;

    RETURN jsonb_build_object(
      'ok', true,
      'emergency_contact_user_id', contact.id,
      'emergency_contact_name', name_text,
      'emergency_contact_phone', phone_text
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
    emergency_contact_phone = phone_text
  WHERE id = uid;

  RETURN jsonb_build_object(
    'ok', true,
    'emergency_contact_user_id', NULL,
    'emergency_contact_name', name_text,
    'emergency_contact_phone', phone_text
  );
END;
$$;

COMMENT ON COLUMN public.users.emergency_contact_user_id IS
  'Optional next of kin who is a registered neighbour. Name and phone are copied onto emergency_contact_* for patrol lookup.';

COMMENT ON FUNCTION public.list_emergency_contact_candidates() IS
  'Same-neighborhood household directory for picking next of kin. UI should show name and street only.';

COMMENT ON FUNCTION public.set_my_emergency_contact(uuid, text, text, boolean) IS
  'Save own next of kin: pick a neighbour (copies live name/phone), type a name and number, or clear.';

REVOKE ALL ON FUNCTION public.set_my_emergency_contact(uuid, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_emergency_contact(uuid, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_emergency_contact(uuid, text, text, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';

