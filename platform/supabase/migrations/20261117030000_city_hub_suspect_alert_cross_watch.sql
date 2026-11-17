-- =============================================================================
-- 20261117030000_city_hub_suspect_alert_cross_watch.sql
-- City Hub suspect alerts: share across watches in the same city.
--
-- Product rule: when a watch admin shares a suspect alert to City Hub, the
-- patrollers and admins of every watch in the same city can see the post and
-- its photos. Residents cannot.
--
-- Additive and idempotent: safe to re-run. Changes NO rows. It replaces:
--
--   1. New helper public.can_view_city_hub_suspect_alert(author_org, post_city):
--      true for global app staff, or for a caller who passes
--      public.can_view_criminal_intelligence() (volunteer, patroller,
--      investigator, committee, nw_admin, admin, technical_support,
--      security_admin, city_admin; never resident) AND either belongs to the
--      author's watch or belongs to any watch in the post's city.
--      Post city = city_hub_posts.city_id, else the author watch's city_id,
--      else public.default_city_id(). Watch city = organizations.city_id,
--      else public.default_city_id().
--   2. city_hub_posts_select: the suspect_alert clause from
--      20261117020000 (author's watch only) now calls the helper. All other
--      read rules (published or own-org draft, non-resident role list,
--      hidden_at) are unchanged.
--   3. storage_city_hub_object_readable(): photos of suspect_alert posts use
--      the same helper. Other post types are unchanged.
--
-- Not changed:
--   - criminal_profiles and its child tables stay restricted to the owning
--     watch (20261117020000). Only what is in the City Hub post is shared.
--   - Write rules. city_hub_posts_insert already needs an admin-class role in
--     the author's own watch (or global staff); city_hub_posts_update and
--     city_hub_posts_delete already need the authoring nw_admin (or global
--     staff). Photo writes follow storage_city_hub_post_manageable().
--
-- Requires: 20261117020000_criminal_profiles_role_gate.sql.
-- Run the whole file at once in the Supabase SQL editor. A multi-statement
-- run is one transaction, so if the verification block at the end fails,
-- nothing in this file is kept.
-- =============================================================================

-- 0) Preconditions ------------------------------------------------------------
DO $pre$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'criminal_profiles'
      AND policyname = 'criminal_profiles_select_org'
      AND qual LIKE '%can_view_criminal_intelligence%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'city_hub_posts'
      AND policyname = 'city_hub_posts_select'
      AND qual LIKE '%suspect_alert%' AND qual LIKE '%hidden_at%'
  ) THEN
    RAISE EXCEPTION 'Run 20261117020000_criminal_profiles_role_gate.sql first: its policies (criminal_profiles_select_org with the role gate, city_hub_posts_select with the suspect_alert rule) are not in this database. Nothing was changed.';
  END IF;
  IF to_regprocedure('public.can_view_criminal_intelligence()') IS NULL
     OR to_regprocedure('public.current_org_ids()') IS NULL
     OR to_regprocedure('public.is_global_app_staff()') IS NULL
     OR to_regprocedure('public.default_city_id()') IS NULL
     OR to_regprocedure('public.can_moderate_resident_content(uuid)') IS NULL
     OR to_regprocedure('public.can_manage_city_hub_post(uuid)') IS NULL
     OR to_regprocedure('public.try_uuid(text)') IS NULL THEN
    RAISE EXCEPTION 'Missing a helper function (can_view_criminal_intelligence, current_org_ids, is_global_app_staff, default_city_id, can_moderate_resident_content, can_manage_city_hub_post or try_uuid). Nothing was changed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'city_hub_posts' AND column_name = 'city_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'city_id') THEN
    RAISE EXCEPTION 'city_hub_posts.city_id or organizations.city_id is missing. Nothing was changed.';
  END IF;
END
$pre$;

-- 1) Helper: who may see a suspect_alert post ---------------------------------
CREATE OR REPLACE FUNCTION public.can_view_city_hub_suspect_alert(
  p_author_org uuid,
  p_post_city uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_global_app_staff()
    OR (
      auth.uid() IS NOT NULL
      AND public.can_view_criminal_intelligence()
      AND (
        p_author_org IN (SELECT public.current_org_ids())
        OR EXISTS (
          SELECT 1
          FROM public.organizations vo
          WHERE vo.id IN (SELECT public.current_org_ids())
            AND coalesce(vo.city_id, public.default_city_id()) = coalesce(
              p_post_city,
              (SELECT ao.city_id FROM public.organizations ao WHERE ao.id = p_author_org),
              public.default_city_id()
            )
        )
      )
    );
$$;

COMMENT ON FUNCTION public.can_view_city_hub_suspect_alert(uuid, uuid) IS
  'City Hub suspect_alert visibility: global staff, or patroller-and-above (can_view_criminal_intelligence) in the author watch or any watch in the same city. Never residents or anon.';

REVOKE ALL ON FUNCTION public.can_view_city_hub_suspect_alert(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_city_hub_suspect_alert(uuid, uuid) TO authenticated, service_role;

-- 2) city_hub_posts read policy -------------------------------------------------
DROP POLICY IF EXISTS city_hub_posts_select ON public.city_hub_posts;
CREATE POLICY city_hub_posts_select ON public.city_hub_posts
  FOR SELECT TO authenticated
  USING (
    (
      status = 'published'
      OR author_organization_id IN (SELECT public.current_org_ids())
    )
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
    AND (
      hidden_at IS NULL
      OR public.can_moderate_resident_content(author_organization_id)
      OR public.can_manage_city_hub_post(created_by_user_id)
    )
    AND (
      type IS DISTINCT FROM 'suspect_alert'
      OR public.can_view_city_hub_suspect_alert(author_organization_id, city_id)
    )
  );

-- 3) City Hub photos ------------------------------------------------------------
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
      AND (
        p.type IS DISTINCT FROM 'suspect_alert'
        OR public.can_view_city_hub_suspect_alert(p.author_organization_id, p.city_id)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.storage_city_hub_object_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_city_hub_object_readable(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- 4) Verification ---------------------------------------------------------------
-- Structural checks, plus a read-only behaviour check that evaluates the helpers
-- as anon (no user) and as one existing resident, if there is one. The JWT
-- settings are transaction-local and cleared at the end. No rows are written.
DO $verify$
DECLARE
  problems text := '';
  r record;
  fn_def text;
  resident_id uuid;
  old_sub text := current_setting('request.jwt.claim.sub', true);
  old_claims text := current_setting('request.jwt.claims', true);
BEGIN
  IF NOT (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'city_hub_posts') THEN
    problems := problems || 'city_hub_posts RLS is off; ';
  END IF;

  -- The only read policy must be ours, for authenticated only, with the
  -- role list and the suspect_alert helper.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'city_hub_posts'
                 AND policyname = 'city_hub_posts_select'
                 AND roles = ARRAY['authenticated']::name[]
                 AND qual LIKE '%can_view_city_hub_suspect_alert%'
                 AND qual LIKE '%hidden_at%'
                 AND qual LIKE '%patroller%'
                 AND qual NOT LIKE '%''resident''%') THEN
    problems := problems || 'city_hub_posts_select is not the expected authenticated, role-gated policy; ';
  END IF;

  FOR r IN
    SELECT policyname, cmd, roles
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'city_hub_posts'
      AND permissive = 'PERMISSIVE' AND cmd IN ('SELECT', 'ALL')
      AND policyname <> 'city_hub_posts_select'
  LOOP
    problems := problems || format('extra city_hub_posts read policy %I (%s, roles %s) could let residents or anon read suspect alerts; ',
                                   r.policyname, r.cmd, r.roles);
  END LOOP;

  fn_def := pg_get_functiondef('public.can_view_city_hub_suspect_alert(uuid,uuid)'::regprocedure);
  IF fn_def NOT LIKE '%can_view_criminal_intelligence()%' OR fn_def NOT LIKE '%auth.uid() IS NOT NULL%' THEN
    problems := problems || 'can_view_city_hub_suspect_alert lost its role or sign-in check; ';
  END IF;

  fn_def := pg_get_functiondef('public.storage_city_hub_object_readable(text)'::regprocedure);
  IF fn_def NOT LIKE '%suspect_alert%' OR fn_def NOT LIKE '%can_view_city_hub_suspect_alert%' THEN
    problems := problems || 'storage_city_hub_object_readable missing the suspect_alert helper; ';
  END IF;

  IF has_function_privilege('anon', 'public.can_view_city_hub_suspect_alert(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.storage_city_hub_object_readable(text)', 'EXECUTE') THEN
    problems := problems || 'anon can execute a City Hub visibility helper; ';
  END IF;

  -- Every read policy on the city-hub-photos bucket must go through the helper
  -- and must not be granted to anon or public.
  FOR r IN
    SELECT policyname, roles, coalesce(qual, '') AS q
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND permissive = 'PERMISSIVE' AND cmd IN ('SELECT', 'ALL')
      AND coalesce(qual, '') LIKE '%city-hub-photos%'
  LOOP
    IF r.q NOT LIKE '%storage_city_hub_object_readable%'
       OR 'anon' = ANY (r.roles) OR 'public' = ANY (r.roles) THEN
      problems := problems || format('storage policy %I can read city-hub-photos without the suspect_alert rule; ', r.policyname);
    END IF;
  END LOOP;

  -- Write rules are not changed here. Warn (do not fail) if they look wider
  -- than "author's own watch or global staff".
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'city_hub_posts'
                 AND policyname = 'city_hub_posts_insert' AND with_check LIKE '%current_org_ids%') THEN
    RAISE WARNING 'city_hub_posts_insert is missing or not limited to the author''s own watch. Review the City Hub write policies.';
  END IF;
  FOR r IN
    SELECT policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'city_hub_posts'
      AND permissive = 'PERMISSIVE' AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
      AND policyname NOT IN ('city_hub_posts_insert', 'city_hub_posts_update', 'city_hub_posts_delete')
  LOOP
    RAISE WARNING 'Unexpected city_hub_posts write policy % (%). Review it.', r.policyname, r.cmd;
  END LOOP;

  -- Behaviour: anon (no user) gets nothing.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  IF public.can_view_city_hub_suspect_alert(NULL, NULL) THEN
    problems := problems || 'anon passes can_view_city_hub_suspect_alert; ';
  END IF;

  -- Behaviour: one real resident gets no suspect alert and no suspect photo.
  SELECT u.id INTO resident_id
  FROM public.users u
  WHERE lower(trim(coalesce(u.role::text, ''))) IN ('resident', 'user')
  LIMIT 1;
  IF resident_id IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', resident_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', resident_id, 'role', 'authenticated')::text, true);
    IF public.can_view_criminal_intelligence() THEN
      problems := problems || 'a resident passes can_view_criminal_intelligence; ';
    END IF;
    FOR r IN
      SELECT p.id, p.author_organization_id, p.city_id
      FROM public.city_hub_posts p
      WHERE p.type = 'suspect_alert'
    LOOP
      IF public.can_view_city_hub_suspect_alert(r.author_organization_id, r.city_id)
         OR public.storage_city_hub_object_readable(r.id::text || '/check.jpg') THEN
        problems := problems || format('resident can see suspect_alert post %s; ', r.id);
        EXIT;
      END IF;
    END LOOP;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', coalesce(old_sub, ''), true);
  PERFORM set_config('request.jwt.claims', coalesce(old_claims, ''), true);

  IF problems <> '' THEN
    RAISE EXCEPTION 'city_hub_suspect_alert_cross_watch verification failed: %', problems;
  END IF;

  RAISE NOTICE 'city_hub_suspect_alert_cross_watch: OK (suspect alerts: patroller-and-above in any watch in the same city; residents and anon blocked; criminal_profiles unchanged).';
END
$verify$;
