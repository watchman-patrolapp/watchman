-- Neighbourhood resident activity feed + verification actor log for profiles.
-- Street labels omit house numbers. Exact emails/phones stay off the resident vouch list.

CREATE OR REPLACE FUNCTION public.resident_street_label(p_address text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(
    trim(both ' ,' from regexp_replace(coalesce(p_address, ''), '^[0-9]+[a-zA-Z]?([/-][0-9]+[a-zA-Z]?)?\s+', '')),
    ''
  );
$$;

REVOKE ALL ON FUNCTION public.resident_street_label(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resident_street_label(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resident_street_label(text) TO service_role;

DROP FUNCTION IF EXISTS public.list_pending_residents_for_vouch();
DROP FUNCTION IF EXISTS public.list_resident_neighbourhood_activity(integer);
DROP FUNCTION IF EXISTS public.get_resident_verification_log(uuid);
DROP FUNCTION IF EXISTS public.list_resident_verification_logs();

CREATE OR REPLACE FUNCTION public.list_pending_residents_for_vouch()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  address text,
  home_address text,
  street_label text,
  avatar_url text,
  created_at timestamptz,
  vouch_count integer,
  vouched_by_me boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    u.full_name,
    u.address,
    rp.home_address,
    public.resident_street_label(coalesce(nullif(trim(rp.home_address), ''), u.address)),
    u.avatar_url,
    u.created_at,
    coalesce(v.vouch_count, 0)::integer,
    coalesce(v.vouched_by_me, false)
  FROM public.users u
  LEFT JOIN public.resident_profiles rp ON rp.user_id = u.id
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS vouch_count,
      bool_or(vv.voucher_user_id = auth.uid()) AS vouched_by_me
    FROM public.resident_verification_vouchers vv
    WHERE vv.resident_user_id = u.id
  ) v ON true
  WHERE (
      public.is_verified_household(auth.uid())
      OR public.is_resident_staff_verifier()
    )
    AND public.resident_in_caller_scope(u.id)
    AND u.id <> auth.uid()
    AND replace(lower(trim(u.role::text)), '-', '_') IN ('resident', 'user')
    AND rp.verification_date IS NULL
  ORDER BY u.full_name NULLS LAST, u.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_pending_residents_for_vouch() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_pending_residents_for_vouch() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_residents_for_vouch() TO service_role;

CREATE OR REPLACE FUNCTION public.list_resident_neighbourhood_activity(p_limit integer DEFAULT 20)
RETURNS TABLE (
  id uuid,
  incident_type text,
  description text,
  status text,
  submitted_at timestamptz,
  location_label text,
  reporter_label text,
  is_sos boolean,
  is_mine boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lim integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  lim := GREATEST(1, LEAST(coalesce(p_limit, 20), 50));

  RETURN QUERY
  SELECT
    i.id,
    i.type,
    i.description,
    i.status,
    coalesce(i.submitted_at, i.incident_date),
    CASE
      WHEN upper(coalesce(i.type, '')) = 'SOS' THEN NULL
      WHEN coalesce(i.location, '') ~ '^-?[0-9]+(\.[0-9]+)?,\s*-?[0-9]+(\.[0-9]+)?' THEN NULL
      ELSE nullif(trim(i.location), '')
    END,
    CASE
      WHEN coalesce(i.is_anonymous_tip, false) THEN 'A neighbour'
      WHEN i.reporter_id = auth.uid() THEN 'You'
      ELSE coalesce(
        nullif(split_part(trim(coalesce(u.full_name, i.submitted_by_name, '')), ' ', 1), ''),
        'A neighbour'
      )
    END,
    upper(coalesce(i.type, '')) = 'SOS',
    i.reporter_id = auth.uid()
  FROM public.incidents i
  JOIN public.users u ON u.id = i.reporter_id
  WHERE i.organization_id IN (SELECT public.current_org_ids())
    AND replace(lower(trim(u.role::text)), '-', '_') IN ('resident', 'user')
  ORDER BY coalesce(i.submitted_at, i.incident_date) DESC NULLS LAST
  LIMIT lim;
END;
$$;

REVOKE ALL ON FUNCTION public.list_resident_neighbourhood_activity(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_resident_neighbourhood_activity(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_resident_neighbourhood_activity(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.get_resident_verification_log(p_resident_user_id uuid DEFAULT NULL)
RETURNS TABLE (
  kind text,
  actor_name text,
  actor_role text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  target := coalesce(p_resident_user_id, auth.uid());

  IF target <> auth.uid()
     AND NOT public.is_resident_staff_verifier() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT public.resident_in_caller_scope(target) AND target <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden: resident is outside your neighborhood';
  END IF;

  RETURN QUERY
  SELECT
    'staff'::text,
    coalesce(nullif(trim(su.full_name), ''), 'Staff'),
    su.role::text,
    rp.verification_date
  FROM public.resident_profiles rp
  JOIN public.users su ON su.id = rp.verification_admin_id
  WHERE rp.user_id = target
    AND rp.verification_method = 'staff'
    AND rp.verification_admin_id IS NOT NULL
    AND rp.verification_date IS NOT NULL

  UNION ALL

  SELECT
    'vouch'::text,
    coalesce(nullif(trim(vu.full_name), ''), 'Neighbour'),
    vu.role::text,
    vv.created_at
  FROM public.resident_verification_vouchers vv
  JOIN public.users vu ON vu.id = vv.voucher_user_id
  WHERE vv.resident_user_id = target

  ORDER BY 4 ASC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.get_resident_verification_log(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_resident_verification_log(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_resident_verification_log(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.list_resident_verification_logs()
RETURNS TABLE (
  resident_user_id uuid,
  kind text,
  actor_name text,
  actor_role text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_resident_staff_verifier() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    rp.user_id,
    'staff'::text,
    coalesce(nullif(trim(su.full_name), ''), 'Staff'),
    su.role::text,
    rp.verification_date
  FROM public.resident_profiles rp
  JOIN public.users su ON su.id = rp.verification_admin_id
  WHERE rp.verification_method = 'staff'
    AND rp.verification_admin_id IS NOT NULL
    AND rp.verification_date IS NOT NULL
    AND public.resident_in_caller_scope(rp.user_id)

  UNION ALL

  SELECT
    vv.resident_user_id,
    'vouch'::text,
    coalesce(nullif(trim(vu.full_name), ''), 'Neighbour'),
    vu.role::text,
    vv.created_at
  FROM public.resident_verification_vouchers vv
  JOIN public.users vu ON vu.id = vv.voucher_user_id
  WHERE public.resident_in_caller_scope(vv.resident_user_id)

  ORDER BY 5 ASC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.list_resident_verification_logs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_resident_verification_logs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_resident_verification_logs() TO service_role;

CREATE OR REPLACE FUNCTION public.mark_resident_verified(
  p_resident_user_id uuid,
  p_method text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.resident_profiles (
    user_id,
    verification_date,
    verification_admin_id,
    verification_method,
    updated_at
  )
  VALUES (
    p_resident_user_id,
    now(),
    CASE WHEN p_method = 'staff' THEN auth.uid() ELSE NULL END,
    p_method,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    verification_date = COALESCE(public.resident_profiles.verification_date, EXCLUDED.verification_date),
    verification_admin_id = COALESCE(
      public.resident_profiles.verification_admin_id,
      EXCLUDED.verification_admin_id
    ),
    verification_method = COALESCE(
      public.resident_profiles.verification_method,
      EXCLUDED.verification_method
    ),
    updated_at = now()
  WHERE public.resident_profiles.verification_date IS NULL;

  UPDATE public.users
  SET
    verified = true,
    verification_method = coalesce(p_method, verification_method),
    verified_by_user_id = CASE
      WHEN p_method = 'staff' THEN coalesce(verified_by_user_id, auth.uid())
      ELSE verified_by_user_id
    END
  WHERE id = p_resident_user_id
    AND coalesce(verified, false) = false;
END;
$$;

UPDATE public.users u
SET
  verified = true,
  verification_method = coalesce(rp.verification_method, u.verification_method)
FROM public.resident_profiles rp
WHERE rp.user_id = u.id
  AND rp.verification_date IS NOT NULL
  AND coalesce(u.verified, false) = false;
