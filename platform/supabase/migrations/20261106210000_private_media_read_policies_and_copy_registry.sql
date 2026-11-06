-- Private media read policies and the City Hub copy registry.
-- Additive and idempotent. Does not change storage.buckets.public and does not
-- move or delete any existing file. Apply this before the path rewrite and
-- before 20261106220000_flip_incident_community_city_hub_buckets_private.sql.
--
-- incident-photos SELECT: members of the incident's organization
--   (public.incident_in_caller_orgs / public.current_org_ids), the reporter of
--   an incident that has no organization, plus global and platform staff.
-- community-media SELECT: public.storage_path_in_caller_org (first folder is the org).
-- city-hub-photos SELECT: any signed-in user, only while the post is published.
--   anon is not granted a policy. The bucket stays public until the flip migration,
--   so existing public URLs keep working until that file is applied.

-- ---------------------------------------------------------------------------
-- Read helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.storage_incident_readable(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_global_app_staff()
    OR public.is_platform_staff()
    OR public.incident_in_caller_orgs(public.try_uuid((storage.foldername(p_name))[1]))
    OR EXISTS (
      SELECT 1
      FROM public.incidents i
      WHERE i.id = public.try_uuid((storage.foldername(p_name))[1])
        AND i.organization_id IS NULL
        AND auth.uid() IS NOT NULL
        AND (
          i.reporter_id = auth.uid()
          OR i.submitted_by::text = auth.uid()::text
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.storage_city_hub_object_readable(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.city_hub_posts p
    WHERE p.id = public.try_uuid((storage.foldername(p_name))[1])
      AND p.status = 'published'
  );
$$;

REVOKE ALL ON FUNCTION public.storage_incident_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_incident_readable(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.storage_city_hub_object_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_city_hub_object_readable(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- storage.objects SELECT. Insert/update/delete policies are left as they are.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "incident_photos_authenticated_select" ON storage.objects;
CREATE POLICY "incident_photos_authenticated_select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'incident-photos'
    AND public.storage_incident_readable(name)
  );

DROP POLICY IF EXISTS "community_media_select_org" ON storage.objects;
CREATE POLICY "community_media_select_org"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'community-media'
    AND public.storage_path_in_caller_org(name)
  );

DROP POLICY IF EXISTS "city_hub_photos_public_read" ON storage.objects;
DROP POLICY IF EXISTS "city_hub_photos_authenticated_select" ON storage.objects;
CREATE POLICY "city_hub_photos_authenticated_select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'city-hub-photos'
    AND public.storage_city_hub_object_readable(name)
  );

-- ---------------------------------------------------------------------------
-- Copy registry. Rows record which private object was copied for a post.
-- The file bytes are copied by the app (or the backfill script), not by SQL.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.city_hub_media_copies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.city_hub_posts (id) ON DELETE CASCADE,
  source_bucket text NOT NULL,
  source_path text NOT NULL,
  dest_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT city_hub_media_copies_source_bucket_chk
    CHECK (source_bucket IN ('incident-photos', 'community-media')),
  CONSTRAINT city_hub_media_copies_paths_chk
    CHECK (
      source_path <> ''
      AND dest_path <> ''
      AND position('..' IN source_path) = 0
      AND position('..' IN dest_path) = 0
      AND left(source_path, 1) <> '/'
      AND left(dest_path, 1) <> '/'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS city_hub_media_copies_source_uidx
  ON public.city_hub_media_copies (post_id, source_bucket, source_path);

CREATE INDEX IF NOT EXISTS city_hub_media_copies_post_idx
  ON public.city_hub_media_copies (post_id);

ALTER TABLE public.city_hub_media_copies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.city_hub_media_copies FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.city_hub_media_copies TO service_role;

COMMENT ON TABLE public.city_hub_media_copies IS
  'City Hub copies of incident-photos or community-media objects. Originals stay in the source bucket.';

CREATE OR REPLACE FUNCTION public.record_city_hub_media_copy(
  p_post_id uuid,
  p_source_bucket text,
  p_source_path text,
  p_dest_path text
)
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
  IF p_source_bucket NOT IN ('incident-photos', 'community-media') THEN
    RAISE EXCEPTION 'unsupported source';
  END IF;
  IF p_source_path IS NULL OR btrim(p_source_path) = ''
     OR position('..' IN p_source_path) > 0 OR left(p_source_path, 1) = '/' THEN
    RAISE EXCEPTION 'invalid source path';
  END IF;
  IF p_dest_path IS NULL
     OR left(p_dest_path, char_length(p_post_id::text) + 6) IS DISTINCT FROM (p_post_id::text || '/copy_')
     OR position('..' IN p_dest_path) > 0
     OR left(p_dest_path, 1) = '/' THEN
    RAISE EXCEPTION 'invalid copy path';
  END IF;

  SELECT * INTO post_row FROM public.city_hub_posts WHERE id = p_post_id;
  IF post_row.id IS NULL THEN
    RAISE EXCEPTION 'post not found';
  END IF;
  IF NOT public.can_manage_city_hub_post(post_row.created_by_user_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.city_hub_media_copies (post_id, source_bucket, source_path, dest_path)
  VALUES (p_post_id, p_source_bucket, p_source_path, p_dest_path)
  ON CONFLICT (post_id, source_bucket, source_path)
  DO UPDATE SET dest_path = EXCLUDED.dest_path;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_city_hub_media_copy_paths(p_post_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
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
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN COALESCE(
    ARRAY(
      SELECT c.dest_path
      FROM public.city_hub_media_copies c
      WHERE c.post_id = p_post_id
      ORDER BY c.created_at
    ),
    ARRAY[]::text[]
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_city_hub_media_copy(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_city_hub_media_copy(uuid, text, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_city_hub_media_copy_paths(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_city_hub_media_copy_paths(uuid) TO authenticated, service_role;

-- Archive and delete drop the registry rows and the post's media references.
-- The app deletes the city-hub-photos objects first. These functions do not
-- delete incident-photos or community-media objects.
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

  DELETE FROM public.city_hub_media_copies WHERE post_id = p_post_id;

  UPDATE public.city_hub_posts
  SET
    status = 'archived',
    photo_urls = '{}',
    document_attachments = '[]'::jsonb,
    updated_at = now()
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

  DELETE FROM public.city_hub_media_copies WHERE post_id = p_post_id;

  IF post_row.related_incident_id IS NOT NULL THEN
    UPDATE public.incidents
    SET city_hub_post_id = NULL, city_hub_shared_at = NULL
    WHERE id = post_row.related_incident_id
      AND city_hub_post_id = p_post_id;
  END IF;

  DELETE FROM public.city_hub_posts WHERE id = p_post_id;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_city_hub_post(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_city_hub_post(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.delete_city_hub_post(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_city_hub_post(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_policies int;
BEGIN
  SELECT count(*) INTO v_policies
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND (
      (policyname = 'incident_photos_authenticated_select' AND qual ILIKE '%storage_incident_readable%')
      OR (policyname = 'community_media_select_org' AND qual ILIKE '%storage_path_in_caller_org%')
      OR (policyname = 'city_hub_photos_authenticated_select' AND qual ILIKE '%storage_city_hub_object_readable%')
    );

  IF v_policies <> 3 THEN
    RAISE EXCEPTION 'private media policies did not land (found % of 3)', v_policies;
  END IF;

  IF to_regclass('public.city_hub_media_copies') IS NULL THEN
    RAISE EXCEPTION 'private media: city_hub_media_copies did not land';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'storage_incident_readable',
        'storage_city_hub_object_readable',
        'record_city_hub_media_copy',
        'list_city_hub_media_copy_paths'
      )
    GROUP BY 1
    HAVING count(DISTINCT p.proname) = 4
  ) THEN
    RAISE EXCEPTION 'private media helper functions did not land';
  END IF;

  IF public.storage_incident_readable('not-a-uuid/file.jpg') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'private media: storage_incident_readable accepted a bad path';
  END IF;

  IF public.storage_city_hub_object_readable('not-a-uuid/file.jpg') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'private media: storage_city_hub_object_readable accepted a bad path';
  END IF;
END
$verify$;
