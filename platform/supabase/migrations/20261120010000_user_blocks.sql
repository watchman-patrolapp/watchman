-- 20261120010000_user_blocks.sql
--
-- User blocking (Google Play user-generated content policy).
--
-- A member can block another member. The app then hides the blocked
-- person's chat messages and general City Hub posts for the blocker.
-- Emergency / critical chat messages and suspect alerts stay visible.
-- The blocked person is never told and cannot see who blocked them.
--
--   - public.user_blocks(blocker_id, blocked_id, created_at)
--   - RLS: a member reads, adds and removes only their own blocks
--   - public.list_my_blocked_users(): the caller's blocks with names
--
-- Additive and idempotent. Changes no existing rows.

CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_not_self CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON public.user_blocks (blocked_id);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_blocks_select_own ON public.user_blocks;
CREATE POLICY user_blocks_select_own ON public.user_blocks
  FOR SELECT TO authenticated
  USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS user_blocks_insert_own ON public.user_blocks;
CREATE POLICY user_blocks_insert_own ON public.user_blocks
  FOR INSERT TO authenticated
  WITH CHECK (blocker_id = auth.uid() AND blocked_id <> auth.uid());

DROP POLICY IF EXISTS user_blocks_delete_own ON public.user_blocks;
CREATE POLICY user_blocks_delete_own ON public.user_blocks
  FOR DELETE TO authenticated
  USING (blocker_id = auth.uid());

REVOKE ALL ON public.user_blocks FROM anon, PUBLIC;
GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;
GRANT ALL ON public.user_blocks TO service_role;

-- The caller's own blocks, with the blocked member's display name.
CREATE OR REPLACE FUNCTION public.list_my_blocked_users()
RETURNS TABLE (blocked_id uuid, full_name text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.blocked_id,
         coalesce(nullif(trim(u.full_name), ''), 'Member') AS full_name,
         b.created_at
  FROM public.user_blocks b
  LEFT JOIN public.users u ON u.id = b.blocked_id
  WHERE b.blocker_id = auth.uid()
  ORDER BY b.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_my_blocked_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_blocked_users() TO authenticated, service_role;

-- Verification ---------------------------------------------------------------
DO $verify$
DECLARE
  problems text := '';
BEGIN
  IF to_regclass('public.user_blocks') IS NULL THEN
    problems := problems || 'user_blocks missing; ';
  ELSE
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_blocks'::regclass) THEN
      problems := problems || 'RLS off on user_blocks; ';
    END IF;
    IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_blocks'
        AND policyname IN ('user_blocks_select_own', 'user_blocks_insert_own', 'user_blocks_delete_own')) <> 3 THEN
      problems := problems || 'user_blocks policies missing; ';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_blocks'
               AND policyname NOT IN ('user_blocks_select_own', 'user_blocks_insert_own', 'user_blocks_delete_own')) THEN
      problems := problems || 'unexpected policy on user_blocks; ';
    END IF;
    IF has_table_privilege('anon', 'public.user_blocks', 'SELECT') THEN
      problems := problems || 'anon can read user_blocks; ';
    END IF;
  END IF;
  IF to_regprocedure('public.list_my_blocked_users()') IS NULL THEN
    problems := problems || 'list_my_blocked_users missing; ';
  ELSIF has_function_privilege('anon', 'public.list_my_blocked_users()', 'EXECUTE') THEN
    problems := problems || 'anon can run list_my_blocked_users; ';
  END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'User blocks: verification failed: %', problems;
  END IF;
  RAISE NOTICE 'User blocks: OK (table, own-row policies, list_my_blocked_users).';
END
$verify$;
