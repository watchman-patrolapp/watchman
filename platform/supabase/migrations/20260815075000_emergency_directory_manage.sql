-- Local directory management: admin, technical support, and NW admin
-- can add/edit civic and community emergency contacts (e.g. a local doctor).

CREATE OR REPLACE FUNCTION public.can_manage_emergency_directory()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_global_app_staff()
    OR public.is_platform_staff()
    OR EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND lower(trim(coalesce(cu.role::text, ''))) IN (
          'admin',
          'technical_support',
          'nw_admin'
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_manage_emergency_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_emergency_directory() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_emergency_directory() TO service_role;

ALTER TABLE public.emergency_directory_entries
  DROP CONSTRAINT IF EXISTS emergency_directory_entries_kind_check;

ALTER TABLE public.emergency_directory_entries
  ADD CONSTRAINT emergency_directory_entries_kind_check
  CHECK (kind IN (
    'police',
    'ambulance',
    'fire',
    'electrical',
    'metro',
    'medical',
    'other'
  ));

DROP POLICY IF EXISTS emergency_directory_select ON public.emergency_directory_entries;
CREATE POLICY emergency_directory_select ON public.emergency_directory_entries
  FOR SELECT TO authenticated
  USING (active = true OR public.can_manage_emergency_directory());

DROP POLICY IF EXISTS emergency_directory_manage ON public.emergency_directory_entries;
CREATE POLICY emergency_directory_manage ON public.emergency_directory_entries
  FOR ALL TO authenticated
  USING (public.can_manage_emergency_directory())
  WITH CHECK (public.can_manage_emergency_directory());

CREATE OR REPLACE FUNCTION public.list_emergency_directory()
RETURNS SETOF public.emergency_directory_entries
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.emergency_directory_entries
  WHERE active = true OR public.can_manage_emergency_directory()
  ORDER BY sort_order, name;
$$;

CREATE OR REPLACE FUNCTION public.upsert_emergency_directory_entry(
  p_id uuid,
  p_kind text,
  p_name text,
  p_phone text,
  p_alt_phone text,
  p_email text,
  p_contact_person_name text,
  p_notes text,
  p_sort_order integer,
  p_active boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_kind text;
  v_name text;
BEGIN
  IF NOT public.can_manage_emergency_directory() THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  v_kind := lower(trim(coalesce(p_kind, '')));
  IF v_kind NOT IN ('police', 'ambulance', 'fire', 'electrical', 'metro', 'medical', 'other') THEN
    v_kind := 'other';
  END IF;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Name is required';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.emergency_directory_entries (
      kind, name, phone, alt_phone, email, contact_person_name, notes, sort_order, active
    )
    VALUES (
      v_kind,
      v_name,
      nullif(trim(coalesce(p_phone, '')), ''),
      nullif(trim(coalesce(p_alt_phone, '')), ''),
      nullif(trim(coalesce(p_email, '')), ''),
      nullif(trim(coalesce(p_contact_person_name, '')), ''),
      nullif(trim(coalesce(p_notes, '')), ''),
      coalesce(p_sort_order, 100),
      coalesce(p_active, true)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.emergency_directory_entries
    SET
      kind = v_kind,
      name = v_name,
      phone = nullif(trim(coalesce(p_phone, '')), ''),
      alt_phone = nullif(trim(coalesce(p_alt_phone, '')), ''),
      email = nullif(trim(coalesce(p_email, '')), ''),
      contact_person_name = nullif(trim(coalesce(p_contact_person_name, '')), ''),
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      sort_order = coalesce(p_sort_order, 100),
      active = coalesce(p_active, true),
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Contact not found';
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_emergency_directory_entry(uuid, text, text, text, text, text, text, text, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_emergency_directory_entry(uuid, text, text, text, text, text, text, text, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_emergency_directory_entry(uuid, text, text, text, text, text, text, text, integer, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.set_emergency_directory_active(p_id uuid, p_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_emergency_directory() THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  UPDATE public.emergency_directory_entries
  SET active = coalesce(p_active, true), updated_at = now()
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contact not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_emergency_directory_active(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_emergency_directory_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_emergency_directory_active(uuid, boolean) TO service_role;
