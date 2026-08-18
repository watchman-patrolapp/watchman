-- Dashboard neighbourhood activity window only:
-- reports stay for 10 hours; SOS stays until cleared, then 15 minutes after resolve.
-- Newest first. Resident "Your reports" is unchanged (it does not use this RPC).

DROP FUNCTION IF EXISTS public.list_resident_neighbourhood_activity(integer);

CREATE FUNCTION public.list_resident_neighbourhood_activity(p_limit integer DEFAULT 20)
RETURNS TABLE (
  id uuid,
  incident_type text,
  description text,
  status text,
  submitted_at timestamptz,
  location_label text,
  reporter_label text,
  is_sos boolean,
  is_mine boolean,
  resolved_at timestamptz
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
    i.reporter_id = auth.uid(),
    sos.resolved_at
  FROM public.incidents i
  JOIN public.users u ON u.id = i.reporter_id
  LEFT JOIN LATERAL (
    SELECT s.resolved_at
    FROM public.sos_alerts s
    WHERE s.incident_id = i.id
    ORDER BY s.created_at DESC NULLS LAST
    LIMIT 1
  ) sos ON true
  WHERE i.organization_id IN (SELECT public.current_org_ids())
    AND replace(lower(trim(u.role::text)), '-', '_') IN ('resident', 'user')
    AND (
      CASE
        WHEN upper(coalesce(i.type, '')) = 'SOS' THEN
          sos.resolved_at IS NULL
          OR sos.resolved_at >= now() - interval '15 minutes'
        ELSE
          coalesce(i.submitted_at, i.incident_date) >= now() - interval '10 hours'
      END
    )
  ORDER BY coalesce(i.submitted_at, i.incident_date) DESC NULLS LAST
  LIMIT lim;
END;
$$;

REVOKE ALL ON FUNCTION public.list_resident_neighbourhood_activity(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_resident_neighbourhood_activity(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_resident_neighbourhood_activity(integer) TO service_role;
