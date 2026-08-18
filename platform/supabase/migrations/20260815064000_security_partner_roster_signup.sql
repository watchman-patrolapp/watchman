-- Partner roster: return volunteer ids for the Theescombe-style grid,
-- and let security staff sign up on a covered neighborhood's slots.

DROP FUNCTION IF EXISTS public.security_partner_scheduled_patrols(uuid);
DROP FUNCTION IF EXISTS public.security_partner_scheduled_patrols(uuid, date, date);

CREATE OR REPLACE FUNCTION public.security_partner_scheduled_patrols(
  p_suburb_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  slot_date date,
  start_time text,
  end_time text,
  zone text,
  volunteer_name text,
  volunteer_uid uuid,
  volunteer_phone text,
  organization_id uuid,
  organization_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH assigned AS (
    SELECT *
    FROM public.security_partner_coverage_areas()
    WHERE p_suburb_id IS NULL
       OR suburb_id = p_suburb_id
       OR organization_id = p_suburb_id
  )
  SELECT
    ps.id,
    ps.date,
    ps.start_time::text,
    ps.end_time::text,
    ps.zone,
    ps.volunteer_name,
    ps.volunteer_uid,
    u.phone,
    coalesce(ps.organization_id, a.organization_id),
    coalesce(o.name, a.organization_name)
  FROM public.patrol_slots ps
  LEFT JOIN public.organizations o ON o.id = ps.organization_id
  LEFT JOIN public.users u ON u.id = ps.volunteer_uid
  LEFT JOIN LATERAL (
    SELECT organization_id, organization_name
    FROM assigned
    WHERE organization_id = ps.organization_id
       OR lower(trim(coalesce(ps.zone, ''))) = lower(trim(organization_name))
       OR lower(trim(coalesce(ps.zone, ''))) = lower(trim(suburb_name))
    LIMIT 1
  ) a ON true
  WHERE public.security_partner_can_view()
    AND ps.date >= coalesce(p_from, current_date)
    AND ps.date <= coalesce(p_to, current_date + 21)
    AND (
      ps.organization_id IN (SELECT organization_id FROM assigned WHERE organization_id IS NOT NULL)
      OR lower(trim(coalesce(ps.zone, ''))) IN (
        SELECT lower(trim(organization_name)) FROM assigned WHERE organization_name IS NOT NULL
      )
      OR lower(trim(coalesce(ps.zone, ''))) IN (
        SELECT lower(trim(suburb_name)) FROM assigned WHERE suburb_name IS NOT NULL
      )
    )
  ORDER BY ps.date, ps.start_time;
$$;

REVOKE ALL ON FUNCTION public.security_partner_scheduled_patrols(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_partner_scheduled_patrols(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.security_partner_scheduled_patrols(uuid, date, date) TO service_role;

CREATE OR REPLACE FUNCTION public.security_partner_signup_patrol_slot(
  p_organization_id uuid,
  p_date date,
  p_start_time text,
  p_end_time text
)
RETURNS TABLE (
  id uuid,
  slot_date date,
  start_time text,
  end_time text,
  zone text,
  volunteer_name text,
  volunteer_uid uuid,
  volunteer_phone text,
  organization_id uuid,
  organization_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  org_name text;
  person_name text;
  person_phone text;
  new_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.security_partner_can_view() THEN
    RAISE EXCEPTION 'only security partners can book from this roster';
  END IF;

  SELECT a.organization_name
    INTO org_name
  FROM public.security_partner_coverage_areas() a
  WHERE a.organization_id = p_organization_id
  LIMIT 1;

  IF org_name IS NULL THEN
    RAISE EXCEPTION 'that neighborhood is not in your coverage';
  END IF;

  SELECT
    coalesce(nullif(trim(u.full_name), ''), u.email, 'Patroller'),
    u.phone
    INTO person_name, person_phone
  FROM public.users u
  WHERE u.id = uid;

  INSERT INTO public.patrol_slots (
    date,
    start_time,
    end_time,
    zone,
    volunteer_uid,
    volunteer_name,
    organization_id,
    created_at
  )
  VALUES (
    p_date,
    p_start_time::time,
    p_end_time::time,
    org_name,
    uid,
    person_name,
    p_organization_id,
    now()
  )
  RETURNING patrol_slots.id INTO new_id;

  RETURN QUERY
  SELECT
    new_id,
    p_date,
    p_start_time,
    p_end_time,
    org_name,
    person_name,
    uid,
    person_phone,
    p_organization_id,
    org_name;
END;
$$;

REVOKE ALL ON FUNCTION public.security_partner_signup_patrol_slot(uuid, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_partner_signup_patrol_slot(uuid, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.security_partner_signup_patrol_slot(uuid, date, text, text) TO service_role;
