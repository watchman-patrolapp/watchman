-- Restrict city hub access:
-- - Read: non-resident operational/admin roles only
-- - Write: admin-class roles only

DROP POLICY IF EXISTS city_hub_posts_select ON public.city_hub_posts;
CREATE POLICY city_hub_posts_select ON public.city_hub_posts
  FOR SELECT TO authenticated
  USING (
    (
      status = 'published'
      OR author_organization_id IN (SELECT public.current_org_ids())
    )
    AND EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND lower(trim(coalesce(cu.role::text, ''))) IN (
          'volunteer',
          'patroller',
          'investigator',
          'committee',
          'nw_admin',
          'admin',
          'technical_support',
          'security_admin',
          'city_admin'
        )
    )
  );

DROP POLICY IF EXISTS city_hub_posts_write ON public.city_hub_posts;
CREATE POLICY city_hub_posts_write ON public.city_hub_posts
  FOR ALL TO authenticated
  USING (
    author_organization_id IN (SELECT public.current_org_ids())
    AND EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND lower(trim(coalesce(cu.role::text, ''))) IN (
          'admin',
          'nw_admin',
          'city_admin',
          'security_admin'
        )
    )
  )
  WITH CHECK (
    author_organization_id IN (SELECT public.current_org_ids())
    AND EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND lower(trim(coalesce(cu.role::text, ''))) IN (
          'admin',
          'nw_admin',
          'city_admin',
          'security_admin'
        )
    )
  );
