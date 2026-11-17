-- =============================================================================
-- 20261117040000_city_hub_photos_role_lock.sql
-- City Hub photos and PDFs: same readers as the City Hub posts themselves.
--
-- Product rule: residents have no access to City Hub at all, photos included.
--
-- Before this file, public.storage_city_hub_object_readable() let ANY signed-in
-- user (residents too) read the files of a published general post, and it
-- ignored hidden_at. Drafts were not readable by anyone.
--
-- After this file, a file in city-hub-photos ({post_id}/...) is readable only
-- when the reader would pass the city_hub_posts_select rule for that post:
--   - signed in, with a role in: volunteer, patroller, investigator, committee,
--     nw_admin, admin, technical_support, security_admin, city_admin
--     (never resident, user, or a blank role);
--   - the post is published, or it belongs to one of the reader's own watches
--     (so an author can read the files of their own draft);
--   - the post is not hidden, unless the reader can moderate it
--     (can_moderate_resident_content) or manage it (can_manage_city_hub_post);
--   - suspect_alert posts also need can_view_city_hub_suspect_alert
--     (from 20261117030000). Hidden suspect alerts are now blocked too.
--
-- Additive and idempotent: safe to re-run. Changes NO rows and no policies.
-- Only the function body is replaced; the storage policy
-- city_hub_photos_authenticated_select already calls it.
-- Write rules (insert/update/delete via storage_city_hub_post_manageable)
-- are not changed.
--
-- Requires: 20261117020000 and 20261117030000.
-- Run the whole file at once in the Supabase SQL editor. A multi-statement
-- run is one transaction, so if the verification block at the end fails,
-- nothing in this file is kept.
--
-- NOTE: do not re-run 20261117030000 after this file. It would put back the
-- older photo rule (residents could read general photos again).
-- =============================================================================

-- 0) Preconditions ------------------------------------------------------------
DO $pre$
BEGIN
  IF to_regprocedure('public.can_view_city_hub_suspect_alert(uuid,uuid)') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'city_hub_posts'
         AND policyname = 'city_hub_posts_select'
         AND qual LIKE '%can_view_city_hub_suspect_alert%'
         AND qual LIKE '%hidden_at%'
     ) THEN
    RAISE EXCEPTION 'Run 20261117030000_city_hub_suspect_alert_cross_watch.sql first: can_view_city_hub_suspect_alert or its city_hub_posts_select rule is not in this database. Nothing was changed.';
  END IF;
  IF to_regprocedure('public.current_org_ids()') IS NULL
     OR to_regprocedure('public.can_moderate_resident_content(uuid)') IS NULL
     OR to_regprocedure('public.can_manage_city_hub_post(uuid)') IS NULL
     OR to_regprocedure('public.try_uuid(text)') IS NULL
     OR to_regprocedure('public.storage_city_hub_object_readable(text)') IS NULL THEN
    RAISE EXCEPTION 'Missing a helper function (current_org_ids, can_moderate_resident_content, can_manage_city_hub_post, try_uuid or storage_city_hub_object_readable). Nothing was changed.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'city_hub_photos_authenticated_select'
      AND qual LIKE '%storage_city_hub_object_readable%'
  ) THEN
    RAISE EXCEPTION 'Storage policy city_hub_photos_authenticated_select (calling storage_city_hub_object_readable) is missing. Nothing was changed.';
  END IF;
END
$pre$;

-- 1) City Hub file read rule ------------------------------------------------------
-- Mirrors city_hub_posts_select clause by clause. Keep the two in step.
CREATE OR REPLACE FUNCTION public.storage_city_hub_object_readable(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND lower(trim(coalesce(cu.role::text, ''))) IN (
          'volunteer',
          'patroller',
          'investigator',
          'committee',
          'nw_admin',
          'admin',
          'technical_support',
          'security_admin',
          'city_admin'
        )
    )
    AND EXISTS (
      SELECT 1
      FROM public.city_hub_posts p
      WHERE p.id = public.try_uuid((storage.foldername(p_name))[1])
        AND (
          p.status = 'published'
          OR p.author_organization_id IN (SELECT public.current_org_ids())
        )
        AND (
          p.hidden_at IS NULL
          OR public.can_moderate_resident_content(p.author_organization_id)
          OR public.can_manage_city_hub_post(p.created_by_user_id)
        )
        AND (
          p.type IS DISTINCT FROM 'suspect_alert'
          OR public.can_view_city_hub_suspect_alert(p.author_organization_id, p.city_id)
        )
    );
$$;

COMMENT ON FUNCTION public.storage_city_hub_object_readable(text) IS
  'city-hub-photos read rule. Same as city_hub_posts_select: listed non-resident roles only; published or own-watch draft; hidden only for moderators/managers; suspect_alert via can_view_city_hub_suspect_alert. Never residents or anon.';

REVOKE ALL ON FUNCTION public.storage_city_hub_object_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_city_hub_object_readable(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- 2) Verification ---------------------------------------------------------------
-- Structural checks, plus a read-only behaviour check as anon and as up to five
-- existing users whose role is not on the list (residents). The JWT settings
-- are transaction-local and restored at the end. No rows are written.
DO $verify$
DECLARE
  problems text := '';
  r record;
  p record;
  fn_def text;
  bucket_public boolean;
  checked_users int := 0;
  sample_user uuid;
  sample_post uuid;
  old_sub text := current_setting('request.jwt.claim.sub', true);
  old_claims text := current_setting('request.jwt.claims', true);
BEGIN
  fn_def := pg_get_functiondef('public.storage_city_hub_object_readable(text)'::regprocedure);
  IF fn_def NOT LIKE '%auth.uid() IS NOT NULL%'
     OR fn_def NOT LIKE '%''patroller''%'
     OR fn_def NOT LIKE '%hidden_at%'
     OR fn_def NOT LIKE '%current_org_ids%'
     OR fn_def NOT LIKE '%can_view_city_hub_suspect_alert%'
     OR fn_def LIKE '%''resident''%'
     OR fn_def LIKE '%''user''%' THEN
    problems := problems || 'storage_city_hub_object_readable is not the role-locked version; ';
  END IF;

  IF has_function_privilege('anon', 'public.storage_city_hub_object_readable(text)', 'EXECUTE') THEN
    problems := problems || 'anon can execute storage_city_hub_object_readable; ';
  END IF;

  -- A public bucket serves files by URL without any policy check.
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    EXECUTE 'SELECT public FROM storage.buckets WHERE id = ''city-hub-photos''' INTO bucket_public;
    IF coalesce(bucket_public, false) THEN
      problems := problems || 'bucket city-hub-photos is public; ';
    END IF;
  END IF;

  -- Every read policy on the bucket must go through the helper, never for anon/public.
  FOR r IN
    SELECT policyname, roles, coalesce(qual, '') AS q
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND permissive = 'PERMISSIVE' AND cmd IN ('SELECT', 'ALL')
      AND coalesce(qual, '') LIKE '%city-hub-photos%'
  LOOP
    IF r.q NOT LIKE '%storage_city_hub_object_readable%'
       OR 'anon' = ANY (r.roles) OR 'public' = ANY (r.roles) THEN
      problems := problems || format('storage policy %I can read city-hub-photos without the role-locked rule; ', r.policyname);
    END IF;
  END LOOP;

  -- Read policies with no bucket filter would also cover city-hub-photos. Warn only.
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND permissive = 'PERMISSIVE' AND cmd IN ('SELECT', 'ALL')
      AND coalesce(qual, '') NOT LIKE '%bucket_id%'
  LOOP
    RAISE WARNING 'storage policy % has no bucket filter and may also expose city-hub-photos. Review it.', r.policyname;
  END LOOP;

  -- Behaviour: anon (no user) reads no City Hub file.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  FOR p IN SELECT id FROM public.city_hub_posts ORDER BY created_at DESC NULLS LAST LIMIT 500 LOOP
    IF public.storage_city_hub_object_readable(p.id::text || '/check.jpg') THEN
      problems := problems || format('anon can read files of City Hub post %s; ', p.id);
      EXIT;
    END IF;
  END LOOP;

  -- Behaviour: up to five residents (any role not on the list) read no City Hub file.
  FOR r IN
    SELECT u.id
    FROM public.users u
    WHERE lower(trim(coalesce(u.role::text, ''))) NOT IN (
      'volunteer', 'patroller', 'investigator', 'committee', 'nw_admin',
      'admin', 'technical_support', 'security_admin', 'city_admin')
    LIMIT 5
  LOOP
    checked_users := checked_users + 1;
    PERFORM set_config('request.jwt.claim.sub', r.id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
    FOR p IN SELECT id FROM public.city_hub_posts ORDER BY created_at DESC NULLS LAST LIMIT 500 LOOP
      IF public.storage_city_hub_object_readable(p.id::text || '/check.jpg') THEN
        problems := problems || format('resident %s can read files of City Hub post %s; ', r.id, p.id);
        EXIT;
      END IF;
    END LOOP;
  END LOOP;

  -- Sanity (warning only): a patroller can still read a visible published general
  -- post from one of their own watches, if such data exists.
  SELECT u.id INTO sample_user
  FROM public.users u
  WHERE lower(trim(coalesce(u.role::text, ''))) = 'patroller'
  LIMIT 1;
  IF sample_user IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', sample_user::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', sample_user, 'role', 'authenticated')::text, true);
    SELECT cp.id INTO sample_post
    FROM public.city_hub_posts cp
    WHERE cp.author_organization_id IN (SELECT public.current_org_ids())
      AND cp.status = 'published' AND cp.hidden_at IS NULL
      AND cp.type IS DISTINCT FROM 'suspect_alert'
    LIMIT 1;
    IF sample_post IS NOT NULL
       AND NOT public.storage_city_hub_object_readable(sample_post::text || '/check.jpg') THEN
      RAISE WARNING 'A patroller (%) cannot read files of published post % in their own watch. Check that patrollers still see City Hub photos.', sample_user, sample_post;
    END IF;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', coalesce(old_sub, ''), true);
  PERFORM set_config('request.jwt.claims', coalesce(old_claims, ''), true);

  IF problems <> '' THEN
    RAISE EXCEPTION 'city_hub_photos_role_lock verification failed: %', problems;
  END IF;

  RAISE NOTICE 'city_hub_photos_role_lock: OK (City Hub files follow city_hub_posts_select; anon and % resident account(s) checked, none can read).', checked_users;
END
$verify$;
