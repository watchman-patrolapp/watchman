-- City Hub viewers can see the name and contact details of someone who
-- published a post, including authors from another neighbourhood.

CREATE OR REPLACE FUNCTION public.city_hub_author_profiles(p_user_ids uuid[])
RETURNS TABLE (
  id uuid,
  full_name text,
  email text,
  phone text,
  role text,
  avatar_url text,
  organization_id uuid,
  organization_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    u.id,
    u.full_name,
    u.email::text,
    u.phone,
    u.role::text,
    u.avatar_url,
    u.organization_id,
    o.name
  FROM public.users u
  LEFT JOIN public.organizations o ON o.id = u.organization_id
  WHERE u.id = ANY (COALESCE(p_user_ids, ARRAY[]::uuid[]))
    AND EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND (
          public.is_global_app_staff()
          OR public.is_platform_staff()
          OR lower(trim(coalesce(cu.role::text, ''))) IN (
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
    )
    AND EXISTS (
      SELECT 1
      FROM public.city_hub_posts p
      WHERE p.created_by_user_id = u.id
        AND (
          p.status = 'published'
          OR p.author_organization_id IN (SELECT public.current_org_ids())
        )
    );
$$;

REVOKE ALL ON FUNCTION public.city_hub_author_profiles(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.city_hub_author_profiles(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.city_hub_author_profiles(uuid[]) TO service_role;

COMMENT ON FUNCTION public.city_hub_author_profiles(uuid[]) IS
  'Contact card for City Hub post authors (name, email, phone). Only users who posted to City Hub, and only for City Hub viewers.';

-- Neighbourhood names on City Hub posts must be readable across working areas.
DROP POLICY IF EXISTS organizations_select_scoped ON public.organizations;
CREATE POLICY organizations_select_scoped ON public.organizations
  FOR SELECT TO authenticated
  USING (
    public.is_platform_staff()
    OR public.is_global_app_staff()
    OR id IN (SELECT public.current_org_ids())
    OR (type = 'security_company' AND status = 'active')
    OR id IN (
      SELECT p.author_organization_id
      FROM public.city_hub_posts p
      WHERE p.status = 'published'
    )
  );
