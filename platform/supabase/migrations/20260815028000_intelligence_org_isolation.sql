-- Intelligence must follow the working area. Drop leftover open-read policies
-- and keep current_org_ids() limited to one neighborhood for global staff.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS active_organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.working_organization_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT u.active_organization_id
      FROM public.users u
      WHERE u.id = auth.uid()
        AND (
          public.is_global_app_staff()
          OR public.is_platform_staff()
        )
        AND u.active_organization_id IS NOT NULL
    ),
    (
      SELECT u.organization_id
      FROM public.users u
      WHERE u.id = auth.uid()
        AND NOT public.is_global_app_staff()
        AND u.organization_id IS NOT NULL
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.current_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT public.working_organization_id()
  WHERE public.working_organization_id() IS NOT NULL
  UNION
  SELECT om.organization_id
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.status = 'active'
    AND NOT public.is_global_app_staff()
  UNION
  SELECT u.organization_id
  FROM public.users u
  WHERE u.id = auth.uid()
    AND u.organization_id IS NOT NULL
    AND NOT public.is_global_app_staff()
$$;

DO $$
DECLARE
  v_legacy_org_id uuid;
BEGIN
  SELECT id INTO v_legacy_org_id
  FROM public.organizations
  WHERE lower(name) = 'theescombe neighborhood watch'
  LIMIT 1;
  IF v_legacy_org_id IS NOT NULL THEN
    UPDATE public.criminal_profiles
    SET organization_id = v_legacy_org_id
    WHERE organization_id IS NULL;
    UPDATE public.profile_incidents
    SET organization_id = v_legacy_org_id
    WHERE organization_id IS NULL;
  END IF;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'criminal_profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.criminal_profiles', r.policyname);
  END LOOP;
END $$;

ALTER TABLE public.criminal_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY criminal_profiles_select_org ON public.criminal_profiles
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.current_org_ids()));

CREATE POLICY criminal_profiles_insert_org ON public.criminal_profiles
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.current_org_ids()));

CREATE POLICY criminal_profiles_update_org ON public.criminal_profiles
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (SELECT public.current_org_ids())
    AND (
      auth.uid()::text = created_by
      OR EXISTS (
        SELECT 1 FROM public.users cu
        WHERE cu.id = auth.uid()
          AND public.is_staff_role(cu.role::text)
      )
    )
  )
  WITH CHECK (organization_id IN (SELECT public.current_org_ids()));

CREATE POLICY criminal_profiles_delete_org ON public.criminal_profiles
  FOR DELETE TO authenticated
  USING (
    organization_id IN (SELECT public.current_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND public.is_staff_role(cu.role::text)
    )
  );
