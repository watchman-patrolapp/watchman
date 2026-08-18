-- Custom logo/cover for civic directory contacts, plus a public storage bucket.

ALTER TABLE public.emergency_directory_entries
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS banner_url text;

COMMENT ON COLUMN public.emergency_directory_entries.logo_url IS
  'Optional uploaded square logo. When empty, the card uses the system kind icon.';
COMMENT ON COLUMN public.emergency_directory_entries.banner_url IS
  'Optional uploaded cover photo. Display at Facebook cover ratio 820x312.';

DROP FUNCTION IF EXISTS public.upsert_emergency_directory_entry(uuid, text, text, text, text, text, text, text, integer, boolean);

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
  p_active boolean,
  p_logo_url text DEFAULT NULL,
  p_banner_url text DEFAULT NULL
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
      kind, name, phone, alt_phone, email, contact_person_name, notes,
      sort_order, active, logo_url, banner_url
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
      coalesce(p_active, true),
      nullif(trim(coalesce(p_logo_url, '')), ''),
      nullif(trim(coalesce(p_banner_url, '')), '')
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
      logo_url = nullif(trim(coalesce(p_logo_url, '')), ''),
      banner_url = nullif(trim(coalesce(p_banner_url, '')), ''),
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

REVOKE ALL ON FUNCTION public.upsert_emergency_directory_entry(uuid, text, text, text, text, text, text, text, integer, boolean, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_emergency_directory_entry(uuid, text, text, text, text, text, text, text, integer, boolean, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_emergency_directory_entry(uuid, text, text, text, text, text, text, text, integer, boolean, text, text) TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'emergency-directory',
  'emergency-directory',
  true,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "emergency_directory_public_read" ON storage.objects;
DROP POLICY IF EXISTS "emergency_directory_authenticated_write" ON storage.objects;
DROP POLICY IF EXISTS "emergency_directory_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "emergency_directory_authenticated_delete" ON storage.objects;

CREATE POLICY "emergency_directory_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'emergency-directory');

CREATE POLICY "emergency_directory_authenticated_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'emergency-directory');

CREATE POLICY "emergency_directory_authenticated_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'emergency-directory')
  WITH CHECK (bucket_id = 'emergency-directory');

CREATE POLICY "emergency_directory_authenticated_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'emergency-directory');
