-- Staff can place an unlinked household onto a neighborhood watch (suburb).
-- Sets organization membership and home_suburb_id from the watch's primary suburb.

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

  IF target_role NOT IN ('resident', 'user') THEN
    RAISE EXCEPTION 'Only household accounts can be assigned here';
  END IF;

  INSERT INTO public.organization_members (
    organization_id,
    user_id,
    member_role,
    status
  )
  VALUES (org_id, p_resident_user_id, 'resident', 'active')
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET status = 'active',
        member_role = CASE
          WHEN public.organization_members.member_role IN ('resident', 'patroller')
            THEN public.organization_members.member_role
          ELSE 'resident'
        END;

  UPDATE public.users
  SET
    organization_id = org_id,
    active_organization_id = COALESCE(active_organization_id, org_id),
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
    'home_suburb_id', suburb_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.assign_resident_to_neighborhood(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_resident_to_neighborhood(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_resident_to_neighborhood(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.assign_resident_to_neighborhood(uuid, uuid) IS
  'Staff places a household on a neighborhood watch and its primary suburb. Does not verify the resident.';

NOTIFY pgrst, 'reload schema';
