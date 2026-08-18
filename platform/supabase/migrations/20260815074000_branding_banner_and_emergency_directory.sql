-- Company cover photo (Facebook-style) + directory contact fields.
-- Civic emergency numbers + registered security companies for residents and intelligence.

ALTER TABLE public.security_company_branding
  ADD COLUMN IF NOT EXISTS banner_url text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_person_name text;

COMMENT ON COLUMN public.security_company_branding.banner_url IS
  'Cover photo URL. Display at Facebook cover ratio 820x312.';

DROP POLICY IF EXISTS branding_select_authenticated ON public.security_company_branding;
CREATE POLICY branding_select_authenticated ON public.security_company_branding
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS branding_write_partner ON public.security_company_branding;
CREATE POLICY branding_write_partner ON public.security_company_branding
  FOR ALL TO authenticated
  USING (
    public.is_global_app_staff()
    OR public.is_platform_staff()
    OR security_company_id IN (SELECT public.my_security_company_ids())
  )
  WITH CHECK (
    public.is_global_app_staff()
    OR public.is_platform_staff()
    OR security_company_id IN (SELECT public.my_security_company_ids())
  );

CREATE TABLE IF NOT EXISTS public.emergency_directory_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN (
    'police',
    'ambulance',
    'fire',
    'electrical',
    'metro',
    'other'
  )),
  name text NOT NULL,
  phone text,
  alt_phone text,
  email text,
  contact_person_name text,
  notes text,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.emergency_directory_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS emergency_directory_select ON public.emergency_directory_entries;
CREATE POLICY emergency_directory_select ON public.emergency_directory_entries
  FOR SELECT TO authenticated
  USING (active = true OR public.is_global_app_staff() OR public.is_platform_staff());

DROP POLICY IF EXISTS emergency_directory_manage ON public.emergency_directory_entries;
CREATE POLICY emergency_directory_manage ON public.emergency_directory_entries
  FOR ALL TO authenticated
  USING (public.is_global_app_staff() OR public.is_platform_staff())
  WITH CHECK (public.is_global_app_staff() OR public.is_platform_staff());

INSERT INTO public.emergency_directory_entries (kind, name, phone, alt_phone, notes, sort_order)
SELECT v.kind, v.name, v.phone, v.alt_phone, v.notes, v.sort_order
FROM (
  VALUES
    ('police', 'SAPS emergency', '10111', NULL, 'South African Police Service — life-threatening crime.', 10),
    ('ambulance', 'Ambulance / medical', '10177', '112', 'Emergency medical services. 112 also works from a mobile.', 20),
    ('fire', 'NMBM Fire & Emergency', '041 585 1555', '10111', 'Nelson Mandela Bay fire and rescue.', 30),
    ('electrical', 'NMBM electricity faults', '041 506 1700', NULL, 'Nelson Mandela Bay Municipality electrical department.', 40),
    ('metro', 'NMBM contact centre', '041 506 5555', NULL, 'Municipality switchboard for other city services.', 50)
) AS v(kind, name, phone, alt_phone, notes, sort_order)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.emergency_directory_entries e
  WHERE e.kind = v.kind AND e.name = v.name
);

CREATE OR REPLACE FUNCTION public.list_emergency_directory()
RETURNS SETOF public.emergency_directory_entries
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.emergency_directory_entries
  WHERE active = true
  ORDER BY sort_order, name;
$$;

REVOKE ALL ON FUNCTION public.list_emergency_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_emergency_directory() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_emergency_directory() TO service_role;

CREATE OR REPLACE FUNCTION public.list_directory_security_companies()
RETURNS TABLE (
  id uuid,
  name text,
  logo_url text,
  banner_url text,
  contact_phone text,
  contact_email text,
  contact_person_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id,
    o.name,
    b.logo_url,
    b.banner_url,
    b.contact_phone,
    b.contact_email,
    b.contact_person_name
  FROM public.organizations o
  LEFT JOIN public.security_company_branding b ON b.security_company_id = o.id
  WHERE o.type = 'security_company'
    AND o.status <> 'suspended'
  ORDER BY lower(trim(o.name));
$$;

REVOKE ALL ON FUNCTION public.list_directory_security_companies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_directory_security_companies() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_directory_security_companies() TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_security_branding()
RETURNS TABLE (
  security_company_id uuid,
  company_name text,
  logo_url text,
  banner_url text,
  contact_phone text,
  contact_email text,
  contact_person_name text,
  primary_color_token text,
  secondary_color_token text,
  card_style text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id,
    o.name,
    b.logo_url,
    b.banner_url,
    b.contact_phone,
    b.contact_email,
    b.contact_person_name,
    b.primary_color_token,
    b.secondary_color_token,
    b.card_style
  FROM public.organizations o
  LEFT JOIN public.security_company_branding b ON b.security_company_id = o.id
  WHERE o.id IN (SELECT public.my_security_company_ids())
  ORDER BY o.name
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_security_branding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_security_branding() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_security_branding() TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_security_company_branding(
  p_logo_url text,
  p_banner_url text,
  p_contact_phone text,
  p_contact_email text,
  p_contact_person_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
BEGIN
  IF NOT public.security_partner_can_view() THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  SELECT id INTO v_company
  FROM public.organizations
  WHERE id IN (SELECT public.my_security_company_ids())
  LIMIT 1;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No security company on this account';
  END IF;

  INSERT INTO public.security_company_branding (
    security_company_id,
    logo_url,
    banner_url,
    contact_phone,
    contact_email,
    contact_person_name
  )
  VALUES (
    v_company,
    nullif(trim(p_logo_url), ''),
    nullif(trim(p_banner_url), ''),
    nullif(trim(p_contact_phone), ''),
    nullif(trim(p_contact_email), ''),
    nullif(trim(p_contact_person_name), '')
  )
  ON CONFLICT (security_company_id) DO UPDATE
  SET
    logo_url = COALESCE(EXCLUDED.logo_url, public.security_company_branding.logo_url),
    banner_url = COALESCE(EXCLUDED.banner_url, public.security_company_branding.banner_url),
    contact_phone = EXCLUDED.contact_phone,
    contact_email = EXCLUDED.contact_email,
    contact_person_name = EXCLUDED.contact_person_name,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_security_company_branding(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_security_company_branding(text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_security_company_branding(text, text, text, text, text) TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'security-branding',
  'security-branding',
  true,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "security_branding_public_read" ON storage.objects;
DROP POLICY IF EXISTS "security_branding_authenticated_write" ON storage.objects;
DROP POLICY IF EXISTS "security_branding_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "security_branding_authenticated_delete" ON storage.objects;

CREATE POLICY "security_branding_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'security-branding');

CREATE POLICY "security_branding_authenticated_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'security-branding');

CREATE POLICY "security_branding_authenticated_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'security-branding')
  WITH CHECK (bucket_id = 'security-branding');

CREATE POLICY "security_branding_authenticated_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'security-branding');
