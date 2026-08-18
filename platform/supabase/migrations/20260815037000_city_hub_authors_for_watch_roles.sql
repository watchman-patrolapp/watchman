-- City Hub author cards must work for neighborhood admins and patrollers,
-- not only global admin / technical support (who can SELECT public.users).

CREATE OR REPLACE FUNCTION public.can_view_city_hub()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    public.is_global_app_staff()
    OR public.is_platform_staff()
    OR EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND replace(lower(trim(coalesce(cu.role::text, ''))), '-', '_') IN (
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
    );
$$;

REVOKE ALL ON FUNCTION public.can_view_city_hub() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_city_hub() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_city_hub() TO service_role;

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
  WHERE public.can_view_city_hub()
    AND u.id = ANY (COALESCE(p_user_ids, ARRAY[]::uuid[]))
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
  'Contact card for City Hub post authors. Available to all City Hub viewers, including nw_admin and patroller.';
