-- Camera spots: own-area only. Hotspot events stay city-wide (unchanged).
-- Readable by: members of the owning organization (current_org_ids),
-- security partners covering that organization, city admins,
-- global app staff and platform staff. Anonymous: nothing.
-- Additive and idempotent. Safe to re-run.

-- 1) Backfill cameras with no organization from the creator's neighbourhood membership.
UPDATE public.camera_spots c
SET organization_id = (
  SELECT om.organization_id
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.user_id = c.created_by
    AND o.type = 'nw_group'
  ORDER BY om.organization_id
  LIMIT 1
)
WHERE c.organization_id IS NULL;

-- 2) New cameras get the creator's working organization automatically.
DROP TRIGGER IF EXISTS stamp_working_organization_id ON public.camera_spots;
CREATE TRIGGER stamp_working_organization_id
  BEFORE INSERT ON public.camera_spots
  FOR EACH ROW EXECUTE FUNCTION public.stamp_working_organization_id();

-- 3) Read helper.
CREATE OR REPLACE FUNCTION public.camera_spot_readable(p_org uuid)
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
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND replace(lower(trim(u.role::text)), '-', '_') = 'city_admin'
    )
    OR (p_org IS NOT NULL AND p_org IN (SELECT public.current_org_ids()))
    OR (p_org IS NOT NULL AND p_org IN (SELECT public.security_partner_assigned_org_ids()));
$$;
REVOKE ALL ON FUNCTION public.camera_spot_readable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.camera_spot_readable(uuid) TO authenticated, service_role;

-- 4) Policies.
DROP POLICY IF EXISTS camera_spots_select_authenticated ON public.camera_spots;
DROP POLICY IF EXISTS camera_spots_select_org ON public.camera_spots;
CREATE POLICY camera_spots_select_org ON public.camera_spots
  FOR SELECT TO authenticated
  USING (public.camera_spot_readable(organization_id));

DROP POLICY IF EXISTS camera_spots_insert_staff ON public.camera_spots;
CREATE POLICY camera_spots_insert_staff ON public.camera_spots
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_hotspot_staff()
    AND created_by = auth.uid()
    AND (organization_id IS NULL OR public.camera_spot_readable(organization_id))
  );

DROP POLICY IF EXISTS camera_spots_update_staff ON public.camera_spots;
CREATE POLICY camera_spots_update_staff ON public.camera_spots
  FOR UPDATE TO authenticated
  USING (public.is_hotspot_staff() AND public.camera_spot_readable(organization_id))
  WITH CHECK (public.is_hotspot_staff() AND public.camera_spot_readable(organization_id));

DROP POLICY IF EXISTS camera_spots_delete_staff ON public.camera_spots;
CREATE POLICY camera_spots_delete_staff ON public.camera_spots
  FOR DELETE TO authenticated
  USING (public.is_hotspot_staff() AND public.camera_spot_readable(organization_id));

-- Camera checks follow their camera's visibility.
DROP POLICY IF EXISTS hotspot_camera_checks_select_authenticated ON public.hotspot_camera_checks;
DROP POLICY IF EXISTS hotspot_camera_checks_select_visible_camera ON public.hotspot_camera_checks;
CREATE POLICY hotspot_camera_checks_select_visible_camera ON public.hotspot_camera_checks
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.camera_spots c
    WHERE c.id = hotspot_camera_checks.camera_spot_id
      AND public.camera_spot_readable(c.organization_id)
  ));

REVOKE ALL ON TABLE public.camera_spots FROM anon;
REVOKE ALL ON TABLE public.hotspot_camera_checks FROM anon;

-- 5) Verification.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='camera_spots' AND policyname='camera_spots_select_org') THEN
    RAISE EXCEPTION 'camera_spots_select_org missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='camera_spots' AND policyname='camera_spots_select_authenticated') THEN
    RAISE EXCEPTION 'old city-wide camera policy still present';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='hotspot_camera_checks' AND policyname='hotspot_camera_checks_select_visible_camera') THEN
    RAISE EXCEPTION 'hotspot_camera_checks visibility policy missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='stamp_working_organization_id' AND tgrelid='public.camera_spots'::regclass) THEN
    RAISE EXCEPTION 'camera_spots org stamp trigger missing';
  END IF;
  RAISE NOTICE 'camera_spots own-area: OK (% cameras still without organization)',
    (SELECT count(*) FROM public.camera_spots WHERE organization_id IS NULL);
END $$;
