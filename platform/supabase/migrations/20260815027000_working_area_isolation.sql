-- Lock neighborhood data to one working area.
-- Global admin / tech support pick a working org; local users stay in their home org.
-- City Hub published posts remain the only cross-area feed.

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

REVOKE ALL ON FUNCTION public.working_organization_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.working_organization_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.working_organization_id() TO service_role;

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

CREATE OR REPLACE FUNCTION public.set_active_organization(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_global_app_staff() AND NOT public.is_platform_staff() THEN
    RAISE EXCEPTION 'only global operators can switch working area';
  END IF;

  IF p_organization_id IS NULL THEN
    UPDATE public.users
    SET active_organization_id = NULL
    WHERE id = auth.uid();
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_organization_id
      AND o.status <> 'suspended'
  ) THEN
    RAISE EXCEPTION 'organization not found';
  END IF;

  UPDATE public.users
  SET active_organization_id = p_organization_id
  WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.set_active_organization(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_active_organization(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_active_organization(uuid) TO service_role;

DROP POLICY IF EXISTS organizations_select_scoped ON public.organizations;
CREATE POLICY organizations_select_scoped ON public.organizations
  FOR SELECT TO authenticated
  USING (
    public.is_platform_staff()
    OR public.is_global_app_staff()
    OR id IN (SELECT public.current_org_ids())
    OR (type = 'security_company' AND status = 'active')
  );

-- Existing live rows without an org belong to the original Theescombe tenant.
DO $$
DECLARE
  v_legacy_org_id uuid;
BEGIN
  SELECT id INTO v_legacy_org_id
  FROM public.organizations
  WHERE lower(name) = 'theescombe neighborhood watch'
  LIMIT 1;

  IF v_legacy_org_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.incidents SET organization_id = v_legacy_org_id WHERE organization_id IS NULL;
  UPDATE public.criminal_profiles SET organization_id = v_legacy_org_id WHERE organization_id IS NULL;
  UPDATE public.profile_incidents SET organization_id = v_legacy_org_id WHERE organization_id IS NULL;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patrol_logs' AND column_name='organization_id') THEN
    UPDATE public.patrol_logs SET organization_id = v_legacy_org_id WHERE organization_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patrol_slots' AND column_name='organization_id') THEN
    UPDATE public.patrol_slots SET organization_id = v_legacy_org_id WHERE organization_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='active_patrols' AND column_name='organization_id') THEN
    UPDATE public.active_patrols SET organization_id = v_legacy_org_id WHERE organization_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='chat_messages' AND column_name='organization_id') THEN
    UPDATE public.chat_messages SET organization_id = v_legacy_org_id WHERE organization_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='feedback' AND column_name='organization_id') THEN
    UPDATE public.feedback SET organization_id = v_legacy_org_id WHERE organization_id IS NULL;
  END IF;
END $$;

ALTER TABLE public.hotspot_events
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL;
ALTER TABLE public.camera_spots
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL;

DO $$
DECLARE
  v_legacy_org_id uuid;
BEGIN
  SELECT id INTO v_legacy_org_id
  FROM public.organizations
  WHERE lower(name) = 'theescombe neighborhood watch'
  LIMIT 1;
  IF v_legacy_org_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.hotspot_events SET organization_id = v_legacy_org_id WHERE organization_id IS NULL;
  UPDATE public.camera_spots SET organization_id = v_legacy_org_id WHERE organization_id IS NULL;
END $$;

CREATE OR REPLACE FUNCTION public.stamp_working_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := public.working_organization_id();
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'incidents',
    'criminal_profiles',
    'profile_incidents',
    'patrol_logs',
    'patrol_slots',
    'active_patrols',
    'chat_messages',
    'feedback',
    'hotspot_events',
    'camera_spots'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'organization_id'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS stamp_working_organization_id ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER stamp_working_organization_id BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.stamp_working_organization_id()',
        t
      );
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS hotspot_events_select_authenticated ON public.hotspot_events;
CREATE POLICY hotspot_events_select_org ON public.hotspot_events
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS hotspot_events_insert_staff ON public.hotspot_events;
CREATE POLICY hotspot_events_insert_staff ON public.hotspot_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_hotspot_staff()
    AND created_by = auth.uid()
    AND organization_id IN (SELECT public.current_org_ids())
  );

DROP POLICY IF EXISTS hotspot_events_update_staff ON public.hotspot_events;
CREATE POLICY hotspot_events_update_staff ON public.hotspot_events
  FOR UPDATE TO authenticated
  USING (public.is_hotspot_staff() AND organization_id IN (SELECT public.current_org_ids()))
  WITH CHECK (public.is_hotspot_staff() AND organization_id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS hotspot_events_delete_staff ON public.hotspot_events;
CREATE POLICY hotspot_events_delete_staff ON public.hotspot_events
  FOR DELETE TO authenticated
  USING (public.is_hotspot_staff() AND organization_id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS camera_spots_select_authenticated ON public.camera_spots;
CREATE POLICY camera_spots_select_org ON public.camera_spots
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS camera_spots_insert_staff ON public.camera_spots;
CREATE POLICY camera_spots_insert_staff ON public.camera_spots
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_hotspot_staff()
    AND created_by = auth.uid()
    AND organization_id IN (SELECT public.current_org_ids())
  );

DROP POLICY IF EXISTS camera_spots_update_staff ON public.camera_spots;
CREATE POLICY camera_spots_update_staff ON public.camera_spots
  FOR UPDATE TO authenticated
  USING (public.is_hotspot_staff() AND organization_id IN (SELECT public.current_org_ids()))
  WITH CHECK (public.is_hotspot_staff() AND organization_id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS camera_spots_delete_staff ON public.camera_spots;
CREATE POLICY camera_spots_delete_staff ON public.camera_spots
  FOR DELETE TO authenticated
  USING (public.is_hotspot_staff() AND organization_id IN (SELECT public.current_org_ids()));

ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'incidents'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.incidents', r.policyname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS incidents_select_org ON public.incidents;
CREATE POLICY incidents_select_org ON public.incidents
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS incidents_insert_org ON public.incidents;
CREATE POLICY incidents_insert_org ON public.incidents
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS incidents_update_org ON public.incidents;
CREATE POLICY incidents_update_org ON public.incidents
  FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.current_org_ids()))
  WITH CHECK (organization_id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS incidents_delete_org ON public.incidents;
CREATE POLICY incidents_delete_org ON public.incidents
  FOR DELETE TO authenticated
  USING (organization_id IN (SELECT public.current_org_ids()));
