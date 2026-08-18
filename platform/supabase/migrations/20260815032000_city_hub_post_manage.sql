-- City Hub post edit/remove:
-- - Main admin and technical support: any post
-- - NW admin: only posts they authored or shared (created_by_user_id)
-- Archive hides a post and allows the incident to be shared again.

DROP INDEX IF EXISTS public.city_hub_posts_related_incident_id_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS city_hub_posts_related_incident_published_uidx
  ON public.city_hub_posts (related_incident_id)
  WHERE related_incident_id IS NOT NULL AND status = 'published';

DROP POLICY IF EXISTS city_hub_posts_write ON public.city_hub_posts;
DROP POLICY IF EXISTS city_hub_posts_insert ON public.city_hub_posts;
DROP POLICY IF EXISTS city_hub_posts_update ON public.city_hub_posts;
DROP POLICY IF EXISTS city_hub_posts_delete ON public.city_hub_posts;

CREATE POLICY city_hub_posts_insert ON public.city_hub_posts
  FOR INSERT TO authenticated
  WITH CHECK (
    author_organization_id IS NOT NULL
    AND EXISTS (
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
  );

CREATE POLICY city_hub_posts_update ON public.city_hub_posts
  FOR UPDATE TO authenticated
  USING (
    public.is_global_app_staff()
    OR (
      created_by_user_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.users cu
        WHERE cu.id = auth.uid()
          AND lower(trim(coalesce(cu.role::text, ''))) = 'nw_admin'
      )
    )
  )
  WITH CHECK (
    author_organization_id IS NOT NULL
    AND (
      public.is_global_app_staff()
      OR (
        created_by_user_id = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.users cu
          WHERE cu.id = auth.uid()
            AND lower(trim(coalesce(cu.role::text, ''))) = 'nw_admin'
        )
      )
    )
  );

CREATE POLICY city_hub_posts_delete ON public.city_hub_posts
  FOR DELETE TO authenticated
  USING (
    public.is_global_app_staff()
    OR (
      created_by_user_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.users cu
        WHERE cu.id = auth.uid()
          AND lower(trim(coalesce(cu.role::text, ''))) = 'nw_admin'
      )
    )
  );

CREATE OR REPLACE FUNCTION public.can_manage_city_hub_post(p_created_by uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_global_app_staff()
    OR (
      p_created_by = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.users cu
        WHERE cu.id = auth.uid()
          AND lower(trim(coalesce(cu.role::text, ''))) = 'nw_admin'
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.update_city_hub_post(
  p_post_id uuid,
  p_type text,
  p_title text,
  p_content text
)
RETURNS public.city_hub_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  post_row public.city_hub_posts;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO post_row FROM public.city_hub_posts WHERE id = p_post_id;
  IF post_row.id IS NULL THEN
    RAISE EXCEPTION 'post not found';
  END IF;
  IF NOT public.can_manage_city_hub_post(post_row.created_by_user_id) THEN
    RAISE EXCEPTION 'forbidden: you can only edit posts you authored or shared';
  END IF;

  UPDATE public.city_hub_posts
  SET
    type = p_type,
    title = p_title,
    content = p_content,
    updated_at = now()
  WHERE id = p_post_id
  RETURNING * INTO post_row;

  RETURN post_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_city_hub_post(p_post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  post_row public.city_hub_posts;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO post_row FROM public.city_hub_posts WHERE id = p_post_id;
  IF post_row.id IS NULL THEN
    RAISE EXCEPTION 'post not found';
  END IF;
  IF NOT public.can_manage_city_hub_post(post_row.created_by_user_id) THEN
    RAISE EXCEPTION 'forbidden: you can only remove posts you authored or shared';
  END IF;

  UPDATE public.city_hub_posts
  SET status = 'archived', updated_at = now()
  WHERE id = p_post_id;

  IF post_row.related_incident_id IS NOT NULL THEN
    UPDATE public.incidents
    SET city_hub_post_id = NULL, city_hub_shared_at = NULL
    WHERE id = post_row.related_incident_id
      AND city_hub_post_id = p_post_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_city_hub_post(p_post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  post_row public.city_hub_posts;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO post_row FROM public.city_hub_posts WHERE id = p_post_id;
  IF post_row.id IS NULL THEN
    RAISE EXCEPTION 'post not found';
  END IF;
  IF NOT public.can_manage_city_hub_post(post_row.created_by_user_id) THEN
    RAISE EXCEPTION 'forbidden: you can only remove posts you authored or shared';
  END IF;

  IF post_row.related_incident_id IS NOT NULL THEN
    UPDATE public.incidents
    SET city_hub_post_id = NULL, city_hub_shared_at = NULL
    WHERE id = post_row.related_incident_id
      AND city_hub_post_id = p_post_id;
  END IF;

  DELETE FROM public.city_hub_posts WHERE id = p_post_id;
END;
$$;

REVOKE ALL ON FUNCTION public.can_manage_city_hub_post(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_city_hub_post(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.update_city_hub_post(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_city_hub_post(uuid, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.archive_city_hub_post(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_city_hub_post(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_city_hub_post(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_city_hub_post(uuid) TO authenticated;

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
      AND status = 'published'
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
