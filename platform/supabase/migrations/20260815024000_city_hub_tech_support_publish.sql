-- Treat technical_support same as admin for City Hub posting.

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
          'technical_support',
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
          'technical_support',
          'nw_admin',
          'city_admin',
          'security_admin'
        )
    )
  );
