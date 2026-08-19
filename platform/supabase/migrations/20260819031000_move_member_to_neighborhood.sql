-- Move a household or watch member to another neighborhood watch.
-- Leaves previous NW group membership; updates home suburb to the destination.

CREATE OR REPLACE FUNCTION public.assign_resident_to_neighborhood(
  p_resident_user_id uuid,
  p_organization_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id uuid;
  suburb_id uuid;
  org_name text;
  target_role text;
  member_role_out text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT (
    public.is_resident_staff_verifier()
    OR public.is_global_app_staff()
    OR public.is_platform_staff()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_resident_user_id IS NULL THEN
    RAISE EXCEPTION 'Resident is required';
  END IF;

  org_id := COALESCE(p_organization_id, public.working_organization_id());
  IF org_id IS NULL THEN
    RAISE EXCEPTION 'Select a neighborhood first';
  END IF;

  SELECT o.id, o.primary_suburb_id, o.name
    INTO org_id, suburb_id, org_name
  FROM public.organizations o
  WHERE o.id = org_id
    AND o.type = 'nw_group'
    AND o.status IS DISTINCT FROM 'suspended';

  IF org_id IS NULL THEN
    RAISE EXCEPTION 'Neighborhood not found';
  END IF;

  IF NOT public.is_global_app_staff() AND NOT public.is_platform_staff() THEN
    IF org_id NOT IN (SELECT public.current_org_ids()) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;

  SELECT replace(lower(trim(u.role::text)), '-', '_')
    INTO target_role
  FROM public.users u
  WHERE u.id = p_resident_user_id;

  IF target_role IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF target_role IN ('admin', 'technical_support') THEN
    RAISE EXCEPTION 'Global accounts cannot be assigned here';
  END IF;

  member_role_out := CASE target_role
    WHEN 'nw_admin' THEN 'nw_admin'
    WHEN 'committee' THEN 'committee'
    WHEN 'security_admin' THEN 'security_admin'
    WHEN 'city_admin' THEN 'city_admin'
    WHEN 'patroller' THEN 'patroller'
    WHEN 'volunteer' THEN 'patroller'
    WHEN 'investigator' THEN 'patroller'
    ELSE 'resident'
  END;

  DELETE FROM public.organization_members om
  USING public.organizations o
  WHERE om.user_id = p_resident_user_id
    AND om.organization_id = o.id
    AND o.type = 'nw_group'
    AND om.organization_id IS DISTINCT FROM org_id;

  INSERT INTO public.organization_members (
    organization_id,
    user_id,
    member_role,
    status
  )
  VALUES (org_id, p_resident_user_id, member_role_out, 'active')
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET status = 'active',
        member_role = EXCLUDED.member_role;

  UPDATE public.users
  SET
    organization_id = org_id,
    active_organization_id = org_id,
    home_suburb_id = COALESCE(suburb_id, home_suburb_id)
  WHERE id = p_resident_user_id;

  INSERT INTO public.resident_profiles (user_id, updated_at)
  VALUES (p_resident_user_id, now())
  ON CONFLICT (user_id) DO UPDATE
    SET updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'organization_id', org_id,
    'organization_name', org_name,
    'home_suburb_id', suburb_id,
    'member_role', member_role_out
  );
END;
$$;

COMMENT ON FUNCTION public.assign_resident_to_neighborhood(uuid, uuid) IS
  'Staff assigns or moves a household/watch member to a neighborhood watch. Leaves previous NW groups.';

NOTIFY pgrst, 'reload schema';
