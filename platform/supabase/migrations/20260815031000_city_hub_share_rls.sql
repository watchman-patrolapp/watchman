-- Global admin / technical support are not organization members, so the
-- previous City Hub write policy (author_organization_id IN current_org_ids())
-- blocked their inserts even when they had a working area selected.

DROP POLICY IF EXISTS city_hub_posts_write ON public.city_hub_posts;
CREATE POLICY city_hub_posts_write ON public.city_hub_posts
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND (
          public.is_global_app_staff()
          OR lower(trim(coalesce(cu.role::text, ''))) IN (
            'admin',
            'technical_support',
            'nw_admin',
            'city_admin',
            'security_admin'
          )
        )
    )
    AND (
      public.is_global_app_staff()
      OR author_organization_id IN (SELECT public.current_org_ids())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND (
          public.is_global_app_staff()
          OR lower(trim(coalesce(cu.role::text, ''))) IN (
            'admin',
            'technical_support',
            'nw_admin',
            'city_admin',
            'security_admin'
          )
        )
    )
    AND (
      public.is_global_app_staff()
      OR author_organization_id IN (SELECT public.current_org_ids())
    )
    AND author_organization_id IS NOT NULL
  );

CREATE OR REPLACE FUNCTION public.publish_incident_to_city_hub(
  p_incident_id uuid,
  p_type text,
  p_title text,
  p_content text,
  p_related_profile_id uuid DEFAULT NULL
)
RETURNS public.city_hub_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  incident_row public.incidents;
  author_org uuid;
  post_row public.city_hub_posts;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users cu
    WHERE cu.id = uid
      AND (
        public.is_global_app_staff()
        OR lower(trim(coalesce(cu.role::text, ''))) IN (
          'admin',
          'technical_support',
          'nw_admin',
          'city_admin',
          'security_admin'
        )
      )
  ) THEN
    RAISE EXCEPTION 'forbidden: city hub publish role required';
  END IF;

  SELECT * INTO incident_row
  FROM public.incidents
  WHERE id = p_incident_id;

  IF incident_row.id IS NULL THEN
    RAISE EXCEPTION 'incident not found';
  END IF;

  IF incident_row.status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'only approved incidents can be shared';
  END IF;

  author_org := COALESCE(incident_row.organization_id, public.working_organization_id());
  IF author_org IS NULL THEN
    RAISE EXCEPTION 'incident has no organization to attribute this post to';
  END IF;

  IF NOT public.is_global_app_staff() THEN
    IF author_org NOT IN (SELECT public.current_org_ids()) THEN
      RAISE EXCEPTION 'forbidden: incident is outside your organization';
    END IF;
  ELSIF public.working_organization_id() IS NOT NULL
    AND incident_row.organization_id IS NOT NULL
    AND incident_row.organization_id IS DISTINCT FROM public.working_organization_id() THEN
    RAISE EXCEPTION 'switch to this neighborhood before sharing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.city_hub_posts
    WHERE related_incident_id = p_incident_id
  ) THEN
    RAISE EXCEPTION 'CITY_HUB_ALREADY_SHARED';
  END IF;

  INSERT INTO public.city_hub_posts (
    author_organization_id,
    type,
    title,
    content,
    visibility,
    status,
    created_by_user_id,
    related_incident_id,
    related_suspect_profile_id
  ) VALUES (
    author_org,
    p_type,
    p_title,
    p_content,
    'city_wide',
    'published',
    uid,
    p_incident_id,
    p_related_profile_id
  )
  RETURNING * INTO post_row;

  UPDATE public.incidents
  SET
    city_hub_post_id = post_row.id,
    city_hub_shared_at = now()
  WHERE id = p_incident_id;

  RETURN post_row;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_incident_to_city_hub(uuid, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_incident_to_city_hub(uuid, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_incident_to_city_hub(uuid, text, text, text, uuid) TO service_role;
