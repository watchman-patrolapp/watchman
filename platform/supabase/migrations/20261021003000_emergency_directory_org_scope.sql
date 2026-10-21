-- G3: neighbourhood scope for the emergency directory.
-- Depends on G2 (20261003002000) for public.is_org_nw_admin(uuid).
--
-- Safety for the live app: this file does not INSERT, UPDATE, or DELETE
-- emergency_directory_entries. The new organization_id column is nullable
-- and has no default, so every existing row stays NULL (city-wide).
-- ON DELETE CASCADE applies only if an organization is deleted later.
--
-- Read-only pre-check (run before this file; do not write):
--   SELECT id, kind, name, phone, active, sort_order, updated_at
--   FROM public.emergency_directory_entries
--   ORDER BY sort_order, name, id;
-- After apply, those same ids must still exist with organization_id IS NULL.

ALTER TABLE public.emergency_directory_entries
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id) ON DELETE CASCADE;

COMMENT ON COLUMN public.emergency_directory_entries.organization_id IS
  'NULL = city-wide civic entry (global staff only). Set = this neighbourhood only. Existing rows stay NULL.';

CREATE INDEX IF NOT EXISTS emergency_directory_org_idx
  ON public.emergency_directory_entries (organization_id);

-- ---------------------------------------------------------------------------
-- Who may create or change a row. NULL org = city-wide (global staff only).
-- A set org must be one of the caller's orgs, and the caller must be global
-- staff or the NW admin of that org. Cross-org callers fail the check.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_manage_emergency_entry(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_org_id IS NULL THEN public.is_global_app_staff() OR public.is_platform_staff()
    ELSE p_org_id IN (SELECT public.current_org_ids())
      AND (
        public.is_global_app_staff()
        OR public.is_platform_staff()
        OR public.is_org_nw_admin(p_org_id)
      )
  END;
$$;

-- Latest list body: 20260815075000. Now city-wide rows plus the caller's orgs.
-- Local rows sort first. Inactive rows stay visible only to someone who can manage them.
CREATE OR REPLACE FUNCTION public.list_emergency_directory()
RETURNS SETOF public.emergency_directory_entries
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.emergency_directory_entries e
  WHERE (
      e.organization_id IS NULL
      OR e.organization_id IN (SELECT public.current_org_ids())
    )
    AND (
      e.active
      OR public.can_manage_emergency_entry(e.organization_id)
    )
  ORDER BY (e.organization_id IS NULL), e.sort_order, e.name;
$$;

-- Latest upsert body: 20260815076000 (logo_url, banner_url).
-- Drop the old 12-arg signature so PostgREST cannot keep the unchecked overload.
-- p_scope applies to inserts only. Updates never change organization_id.
DROP FUNCTION IF EXISTS public.upsert_emergency_directory_entry(
  uuid, text, text, text, text, text, text, text, integer, boolean
);
DROP FUNCTION IF EXISTS public.upsert_emergency_directory_entry(
  uuid, text, text, text, text, text, text, text, integer, boolean, text, text
);

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
  p_banner_url text DEFAULT NULL,
  p_scope text DEFAULT 'org'
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
  v_scope text;
  v_target_org uuid;
  v_row public.emergency_directory_entries;
BEGIN
  v_kind := lower(trim(coalesce(p_kind, '')));
  IF v_kind NOT IN ('police', 'ambulance', 'fire', 'electrical', 'metro', 'medical', 'other') THEN
    v_kind := 'other';
  END IF;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Name is required';
  END IF;

  IF p_id IS NULL THEN
    v_scope := lower(trim(coalesce(p_scope, 'org')));
    IF v_scope NOT IN ('org', 'global') THEN
      v_scope := 'org';
    END IF;

    IF v_scope = 'global' THEN
      v_target_org := NULL;
    ELSE
      v_target_org := public.working_organization_id();
      IF v_target_org IS NULL THEN
        RAISE EXCEPTION 'choose a working neighbourhood';
      END IF;
    END IF;

    IF NOT public.can_manage_emergency_entry(v_target_org) THEN
      RAISE EXCEPTION 'Not allowed';
    END IF;

    INSERT INTO public.emergency_directory_entries (
      kind, name, phone, alt_phone, email, contact_person_name, notes,
      sort_order, active, logo_url, banner_url, organization_id
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
      nullif(trim(coalesce(p_banner_url, '')), ''),
      v_target_org
    )
    RETURNING id INTO v_id;
  ELSE
    SELECT *
    INTO v_row
    FROM public.emergency_directory_entries
    WHERE id = p_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Contact not found';
    END IF;

    IF NOT public.can_manage_emergency_entry(v_row.organization_id) THEN
      RAISE EXCEPTION 'Not allowed';
    END IF;

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

-- Latest body: 20260815075000. Same row check as upsert. No delete RPC exists;
-- hiding a contact is this update. organization_id is not changed.
CREATE OR REPLACE FUNCTION public.set_emergency_directory_active(p_id uuid, p_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.emergency_directory_entries;
BEGIN
  SELECT *
  INTO v_row
  FROM public.emergency_directory_entries
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contact not found';
  END IF;

  IF NOT public.can_manage_emergency_entry(v_row.organization_id) THEN
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

-- Direct table writes bypassed the RPC (emergency_directory_manage was FOR ALL
-- for any NW admin). The web app writes only through the RPCs above.
DROP POLICY IF EXISTS emergency_directory_manage ON public.emergency_directory_entries;

DROP POLICY IF EXISTS emergency_directory_select ON public.emergency_directory_entries;
CREATE POLICY emergency_directory_select ON public.emergency_directory_entries
  FOR SELECT TO authenticated
  USING (
    (
      organization_id IS NULL
      OR organization_id IN (SELECT public.current_org_ids())
    )
    AND (
      active = true
      OR public.can_manage_emergency_entry(organization_id)
    )
  );

REVOKE INSERT, UPDATE, DELETE ON TABLE public.emergency_directory_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.emergency_directory_entries TO authenticated;
GRANT ALL ON TABLE public.emergency_directory_entries TO service_role;

REVOKE ALL ON FUNCTION public.can_manage_emergency_entry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_emergency_entry(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_emergency_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_emergency_directory() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.upsert_emergency_directory_entry(uuid, text, text, text, text, text, text, text, integer, boolean, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_emergency_directory_entry(uuid, text, text, text, text, text, text, text, integer, boolean, text, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_emergency_directory_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_emergency_directory_active(uuid, boolean) TO authenticated, service_role;
