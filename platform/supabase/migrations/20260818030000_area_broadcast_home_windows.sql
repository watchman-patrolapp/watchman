-- Neighbourhood notices: 12 hours pinned on Home, then 12 hours in activity, then gone.

ALTER TABLE public.area_broadcasts
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '24 hours');

CREATE OR REPLACE FUNCTION public.post_area_broadcast(p_headline text, p_body text)
RETURNS public.area_broadcasts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id uuid;
  row_out public.area_broadcasts;
  cleaned_headline text;
  cleaned_body text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.can_post_area_broadcast() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  cleaned_headline := trim(p_headline);
  cleaned_body := trim(p_body);
  IF cleaned_headline = '' THEN
    RAISE EXCEPTION 'headline is required';
  END IF;
  IF char_length(cleaned_headline) > 120 THEN
    RAISE EXCEPTION 'headline is too long';
  END IF;
  IF cleaned_body = '' THEN
    RAISE EXCEPTION 'message is required';
  END IF;
  IF char_length(cleaned_body) > 4000 THEN
    RAISE EXCEPTION 'message is too long';
  END IF;

  SELECT public.working_organization_id() INTO org_id;

  IF org_id IS NULL THEN
    SELECT o.id INTO org_id
    FROM public.organizations o
    WHERE o.id IN (SELECT public.current_org_ids())
    ORDER BY o.name
    LIMIT 1;
  END IF;

  IF org_id IS NULL THEN
    RAISE EXCEPTION 'no neighbourhood selected';
  END IF;

  INSERT INTO public.area_broadcasts (organization_id, author_id, headline, body, expires_at)
  VALUES (org_id, auth.uid(), cleaned_headline, cleaned_body, now() + interval '24 hours')
  RETURNING * INTO row_out;

  RETURN row_out;
END;
$$;

REVOKE ALL ON FUNCTION public.post_area_broadcast(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_area_broadcast(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_area_broadcast(text, text) TO service_role;

DROP FUNCTION IF EXISTS public.list_area_broadcasts(integer);
CREATE FUNCTION public.list_area_broadcasts(p_limit integer DEFAULT 8)
RETURNS TABLE (
  id uuid,
  headline text,
  body text,
  created_at timestamptz,
  expires_at timestamptz,
  author_name text,
  pinned_until timestamptz,
  activity_until timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id,
    coalesce(nullif(trim(b.headline), ''), 'Neighbourhood notice'),
    b.body,
    b.created_at,
    b.expires_at,
    coalesce(nullif(trim(u.full_name), ''), 'Neighbourhood watch'),
    b.created_at + interval '12 hours',
    b.created_at + interval '24 hours'
  FROM public.area_broadcasts b
  LEFT JOIN public.users u ON u.id = b.author_id
  WHERE b.organization_id = public.working_organization_id()
    AND b.created_at >= now() - interval '24 hours'
  ORDER BY b.created_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 8), 30));
$$;

REVOKE ALL ON FUNCTION public.list_area_broadcasts(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_area_broadcasts(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_area_broadcasts(integer) TO service_role;
