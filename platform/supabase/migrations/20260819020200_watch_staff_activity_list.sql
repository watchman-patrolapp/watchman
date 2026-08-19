-- Part 3/3: list RPC, RLS, backfill

DROP POLICY IF EXISTS activity_logs_select_scope ON public.activity_logs;
DROP POLICY IF EXISTS activity_logs_select_org ON public.activity_logs;
CREATE POLICY activity_logs_select_scope ON public.activity_logs
  FOR SELECT TO authenticated
  USING (
    public.is_global_app_staff()
    OR public.is_platform_staff()
    OR organization_id IN (SELECT public.current_org_ids())
  );

CREATE INDEX IF NOT EXISTS activity_logs_created_idx
  ON public.activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_actor_created_idx
  ON public.activity_logs (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.list_watch_staff_activity(
  p_limit integer DEFAULT 150,
  p_role text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  action text,
  details_json jsonb,
  organization_id uuid,
  organization_name text,
  actor_user_id uuid,
  actor_name text,
  actor_email text,
  actor_role text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  role_filter text;
  lim integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.is_global_app_staff() OR public.is_platform_staff()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  role_filter := replace(lower(trim(coalesce(p_role, ''))), '-', '_');
  IF role_filter NOT IN ('nw_admin', 'committee') THEN
    role_filter := NULL;
  END IF;
  lim := GREATEST(1, LEAST(coalesce(p_limit, 150), 400));

  RETURN QUERY
  SELECT
    al.id,
    al.created_at,
    al.action,
    al.details_json,
    al.organization_id,
    o.name,
    al.user_id,
    coalesce(nullif(trim(al.details_json->>'actor_name'), ''), nullif(trim(u.full_name), ''), u.email),
    u.email,
    coalesce(
      nullif(trim(al.details_json->>'actor_role'), ''),
      replace(lower(trim(u.role::text)), '-', '_')
    )
  FROM public.activity_logs al
  LEFT JOIN public.users u ON u.id = al.user_id
  LEFT JOIN public.organizations o ON o.id = al.organization_id
  WHERE (
      public.is_watch_local_staff_role(
        coalesce(
          nullif(trim(al.details_json->>'actor_role'), ''),
          replace(lower(trim(u.role::text)), '-', '_')
        )
      )
      OR public.is_watch_local_staff_role(al.details_json->>'subject_role')
    )
    AND (
      role_filter IS NULL
      OR coalesce(
        nullif(trim(al.details_json->>'actor_role'), ''),
        replace(lower(trim(u.role::text)), '-', '_'),
        al.details_json->>'subject_role'
      ) = role_filter
    )
  ORDER BY al.created_at DESC
  LIMIT lim;
END;
$$;

REVOKE ALL ON FUNCTION public.list_watch_staff_activity(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_watch_staff_activity(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_watch_staff_activity(integer, text) TO service_role;

COMMENT ON FUNCTION public.list_watch_staff_activity(integer, text) IS
  'Main admin / technical support: activity by NW admin and committee (and role changes involving those posts).';

INSERT INTO public.activity_logs (organization_id, user_id, action, details_json, created_at)
SELECT
  u.organization_id,
  rp.verification_admin_id,
  'resident_verified',
  jsonb_build_object(
    'resident_user_id', rp.user_id,
    'resident_name', nullif(trim(ru.full_name), ''),
    'method', rp.verification_method,
    'actor_role', replace(lower(trim(u.role::text)), '-', '_'),
    'actor_name', nullif(trim(u.full_name), ''),
    'backfill', true
  ),
  rp.verification_date
FROM public.resident_profiles rp
JOIN public.users u ON u.id = rp.verification_admin_id
LEFT JOIN public.users ru ON ru.id = rp.user_id
WHERE rp.verification_date IS NOT NULL
  AND public.is_watch_local_staff_role(u.role::text)
  AND NOT EXISTS (
    SELECT 1
    FROM public.activity_logs al
    WHERE al.action = 'resident_verified'
      AND al.user_id = rp.verification_admin_id
      AND al.created_at = rp.verification_date
  );

INSERT INTO public.activity_logs (organization_id, user_id, action, details_json, created_at)
SELECT
  b.organization_id,
  b.author_id,
  'area_broadcast',
  jsonb_build_object(
    'broadcast_id', b.id,
    'headline', left(coalesce(b.headline, ''), 160),
    'body_preview', left(coalesce(b.body, ''), 200),
    'actor_role', replace(lower(trim(u.role::text)), '-', '_'),
    'actor_name', nullif(trim(u.full_name), ''),
    'backfill', true
  ),
  b.created_at
FROM public.area_broadcasts b
JOIN public.users u ON u.id = b.author_id
WHERE public.is_watch_local_staff_role(u.role::text)
  AND NOT EXISTS (
    SELECT 1
    FROM public.activity_logs al
    WHERE al.action = 'area_broadcast'
      AND al.user_id = b.author_id
      AND (al.details_json->>'broadcast_id') = b.id::text
  );

NOTIFY pgrst, 'reload schema';
