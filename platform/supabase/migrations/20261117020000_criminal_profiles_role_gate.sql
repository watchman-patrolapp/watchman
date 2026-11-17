-- =============================================================================
-- 20261117020000_criminal_profiles_role_gate.sql
-- POPIA s26 hardening for persons-of-interest / intelligence records.
--
-- Additive and idempotent: safe to re-run. Changes NO rows. It only replaces
-- read/create policies and one storage helper function:
--
--   1. criminal_profiles SELECT and INSERT now also require
--      public.can_view_criminal_intelligence() (volunteer, patroller,
--      investigator, committee, nw_admin, admin, technical_support,
--      security_admin, city_admin, or global app staff). Residents are out.
--      Same-org scoping (current_org_ids()) is unchanged. UPDATE and DELETE
--      policies are unchanged (they already need creator or staff).
--      Child tables whose policies check EXISTS (criminal_profiles ...)
--      (profile_associates, profile_geography, profile_intelligence,
--      mo_pattern_history) inherit the gate automatically.
--   2. Drops known legacy permissive policies on criminal_profiles
--      ("Enable ... for authenticated users"), including the one the stray
--      supabase/criminal_profiles_delete_policy.sql used to create.
--   3. City Hub suspect_alert posts: readable only inside the author's own
--      organisation (plus global app staff). Other post types keep their
--      current city-wide rules. Keeps the hidden_at rule from
--      20261117010000_ugc_reports_posts_chat_users.sql.
--   4. storage_city_hub_object_readable(): photos of suspect_alert posts follow
--      the same same-org rule.
--
-- Requires: 20261117010000_ugc_reports_posts_chat_users.sql (hidden_at column).
-- Run the whole file at once in the Supabase SQL editor. A multi-statement
-- run is one transaction, so if the verification block at the end fails,
-- nothing in this file is kept.
-- =============================================================================

-- 0) Preconditions ------------------------------------------------------------
DO $pre$
BEGIN
  IF to_regprocedure('public.can_view_criminal_intelligence()') IS NULL THEN
    RAISE EXCEPTION 'Missing public.can_view_criminal_intelligence(). Run 20261021005000_criminal_photos_storage_lockdown.sql first.';
  END IF;
  IF to_regprocedure('public.current_org_ids()') IS NULL THEN
    RAISE EXCEPTION 'Missing public.current_org_ids().';
  END IF;
  IF to_regprocedure('public.is_global_app_staff()') IS NULL THEN
    RAISE EXCEPTION 'Missing public.is_global_app_staff().';
  END IF;
  IF to_regprocedure('public.can_moderate_resident_content(uuid)') IS NULL
     OR to_regprocedure('public.can_manage_city_hub_post(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing City Hub moderation helpers. Run the City Hub and community-report migrations first.';
  END IF;
  IF to_regprocedure('public.try_uuid(text)') IS NULL THEN
    RAISE EXCEPTION 'Missing public.try_uuid(text).';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'city_hub_posts' AND column_name = 'hidden_at'
  ) THEN
    RAISE EXCEPTION 'city_hub_posts.hidden_at is missing. Run 20261117010000_ugc_reports_posts_chat_users.sql first.';
  END IF;
END
$pre$;

-- 1) criminal_profiles: role gate on read and create ----------------------------
ALTER TABLE public.criminal_profiles ENABLE ROW LEVEL SECURITY;

-- Legacy permissive policies (dashboard or old migrations). Dropping a policy
-- changes no data.
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.criminal_profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.criminal_profiles;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON public.criminal_profiles;
DROP POLICY IF EXISTS "Enable delete for creators or elevated roles" ON public.criminal_profiles;
DROP POLICY IF EXISTS "Enable delete for creators or admins" ON public.criminal_profiles;
DROP POLICY IF EXISTS "Enable update for creators or admins" ON public.criminal_profiles;

DROP POLICY IF EXISTS criminal_profiles_select_org ON public.criminal_profiles;
CREATE POLICY criminal_profiles_select_org ON public.criminal_profiles
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT public.current_org_ids())
    AND public.can_view_criminal_intelligence()
  );

DROP POLICY IF EXISTS criminal_profiles_insert_org ON public.criminal_profiles;
CREATE POLICY criminal_profiles_insert_org ON public.criminal_profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT public.current_org_ids())
    AND public.can_view_criminal_intelligence()
  );

-- 2) City Hub: suspect_alert posts stay inside the author's organisation --------
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
      OR author_organization_id IN (SELECT public.current_org_ids())
      OR public.is_global_app_staff()
    )
  );

-- 3) City Hub photos of suspect_alert posts follow the same rule ---------------
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
        OR p.author_organization_id IN (SELECT public.current_org_ids())
        OR public.is_global_app_staff()
      )
  );
$$;

REVOKE ALL ON FUNCTION public.storage_city_hub_object_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_city_hub_object_readable(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- 4) Verification ---------------------------------------------------------------
DO $verify$
DECLARE
  problems text := '';
  r record;
  fn_def text;
BEGIN
  IF NOT (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'criminal_profiles') THEN
    problems := problems || 'criminal_profiles RLS is off; ';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'criminal_profiles'
                 AND policyname = 'criminal_profiles_select_org'
                 AND qual LIKE '%can_view_criminal_intelligence%') THEN
    problems := problems || 'criminal_profiles_select_org missing role gate; ';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'criminal_profiles'
                 AND policyname = 'criminal_profiles_insert_org'
                 AND with_check LIKE '%can_view_criminal_intelligence%') THEN
    problems := problems || 'criminal_profiles_insert_org missing role gate; ';
  END IF;

  -- Any other permissive read/create policy would OR around the gate.
  FOR r IN
    SELECT policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'criminal_profiles'
      AND permissive = 'PERMISSIVE'
      AND (
        (cmd IN ('SELECT', 'ALL') AND coalesce(qual, '') NOT LIKE '%can_view_criminal_intelligence%')
        OR (cmd = 'INSERT' AND coalesce(with_check, '') NOT LIKE '%can_view_criminal_intelligence%')
      )
  LOOP
    problems := problems || format('criminal_profiles policy %I (%s) has no role gate; ', r.policyname, r.cmd);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'criminal_profiles'
             AND qual LIKE '%auth.role()%') THEN
    problems := problems || 'criminal_profiles still has an auth.role()-only policy; ';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'city_hub_posts'
                 AND policyname = 'city_hub_posts_select'
                 AND qual LIKE '%suspect_alert%' AND qual LIKE '%hidden_at%') THEN
    problems := problems || 'city_hub_posts_select missing suspect_alert or hidden_at rule; ';
  END IF;

  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'city_hub_posts'
      AND permissive = 'PERMISSIVE' AND cmd IN ('SELECT', 'ALL')
      AND policyname <> 'city_hub_posts_select'
  LOOP
    problems := problems || format('extra city_hub_posts read policy %I may bypass the suspect_alert rule; ', r.policyname);
  END LOOP;

  fn_def := pg_get_functiondef('public.storage_city_hub_object_readable(text)'::regprocedure);
  IF fn_def IS NULL OR fn_def NOT LIKE '%suspect_alert%' THEN
    problems := problems || 'storage_city_hub_object_readable missing suspect_alert rule; ';
  END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'criminal_profiles_role_gate verification failed: %', problems;
  END IF;

  RAISE NOTICE 'criminal_profiles_role_gate: OK (read/create need an intelligence role; suspect_alert City Hub posts are same-org).';
END
$verify$;
