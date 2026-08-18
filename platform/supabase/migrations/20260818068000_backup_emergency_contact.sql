-- Optional backup next of kin (slot 2). Primary stays on the existing columns.
-- Signup still captures only the primary contact.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS emergency_contact_2_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS emergency_contact_2_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_2_phone text,
  ADD COLUMN IF NOT EXISTS emergency_contact_2_relationship text;

DROP FUNCTION IF EXISTS public.set_my_emergency_contact(uuid, text, text, boolean);
DROP FUNCTION IF EXISTS public.set_my_emergency_contact(uuid, text, text, boolean, text);

CREATE OR REPLACE FUNCTION public.set_my_emergency_contact(
  p_contact_user_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_clear boolean DEFAULT false,
  p_relationship text DEFAULT NULL,
  p_slot integer DEFAULT 1
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
  slot_n integer := coalesce(p_slot, 1);
  other_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF slot_n NOT IN (1, 2) THEN
    RAISE EXCEPTION 'invalid emergency contact slot';
  END IF;

  IF p_clear THEN
    IF slot_n = 2 THEN
      UPDATE public.users
      SET
        emergency_contact_2_user_id = NULL,
        emergency_contact_2_name = NULL,
        emergency_contact_2_phone = NULL,
        emergency_contact_2_relationship = NULL
      WHERE id = uid;
    ELSE
      UPDATE public.users
      SET
        emergency_contact_user_id = NULL,
        emergency_contact_name = NULL,
        emergency_contact_phone = NULL,
        emergency_contact_relationship = NULL
      WHERE id = uid;
    END IF;
    RETURN jsonb_build_object('ok', true, 'cleared', true, 'slot', slot_n);
  END IF;

  SELECT
    CASE WHEN slot_n = 1 THEN emergency_contact_2_user_id ELSE emergency_contact_user_id END
  INTO other_id
  FROM public.users
  WHERE id = uid;

  IF p_contact_user_id IS NOT NULL THEN
    IF p_contact_user_id = uid THEN
      RAISE EXCEPTION 'you cannot list yourself as next of kin';
    END IF;
    IF other_id IS NOT NULL AND p_contact_user_id = other_id THEN
      RAISE EXCEPTION 'that person is already listed as your other emergency contact';
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

    IF slot_n = 2 THEN
      UPDATE public.users
      SET
        emergency_contact_2_user_id = contact.id,
        emergency_contact_2_name = name_text,
        emergency_contact_2_phone = phone_text,
        emergency_contact_2_relationship = rel_text
      WHERE id = uid;
    ELSE
      UPDATE public.users
      SET
        emergency_contact_user_id = contact.id,
        emergency_contact_name = name_text,
        emergency_contact_phone = phone_text,
        emergency_contact_relationship = rel_text
      WHERE id = uid;
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'slot', slot_n,
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

  IF slot_n = 2 THEN
    UPDATE public.users
    SET
      emergency_contact_2_user_id = NULL,
      emergency_contact_2_name = name_text,
      emergency_contact_2_phone = phone_text,
      emergency_contact_2_relationship = rel_text
    WHERE id = uid;
  ELSE
    UPDATE public.users
    SET
      emergency_contact_user_id = NULL,
      emergency_contact_name = name_text,
      emergency_contact_phone = phone_text,
      emergency_contact_relationship = rel_text
    WHERE id = uid;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'slot', slot_n,
    'emergency_contact_user_id', NULL,
    'emergency_contact_name', name_text,
    'emergency_contact_phone', phone_text,
    'emergency_contact_relationship', rel_text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_emergency_contact(uuid, text, text, boolean, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_emergency_contact(uuid, text, text, boolean, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_emergency_contact(uuid, text, text, boolean, text, integer) TO service_role;

DROP FUNCTION IF EXISTS public.list_neighborhood_next_of_kin();

CREATE OR REPLACE FUNCTION public.list_neighborhood_next_of_kin()
RETURNS TABLE (
  user_id uuid,
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_user_id uuid,
  emergency_contact_relationship text,
  emergency_contact_2_name text,
  emergency_contact_2_phone text,
  emergency_contact_2_user_id uuid,
  emergency_contact_2_relationship text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    u.emergency_contact_name,
    u.emergency_contact_phone,
    u.emergency_contact_user_id,
    u.emergency_contact_relationship,
    u.emergency_contact_2_name,
    u.emergency_contact_2_phone,
    u.emergency_contact_2_user_id,
    u.emergency_contact_2_relationship
  FROM public.users u
  WHERE (
    public.is_platform_staff()
    OR public.is_global_app_staff()
    OR u.organization_id IN (SELECT public.current_org_ids())
    OR u.id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.list_neighborhood_next_of_kin() IS
  'Primary and backup next-of-kin for residents visible to the caller.';

REVOKE ALL ON FUNCTION public.list_neighborhood_next_of_kin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_neighborhood_next_of_kin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_neighborhood_next_of_kin() TO service_role;

NOTIFY pgrst, 'reload schema';

