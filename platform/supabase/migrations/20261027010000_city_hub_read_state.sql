-- City Hub unread: persist last-seen per user on the server so the dashboard
-- badge stays cleared after sign-in / across web vs Android.
-- Unread was previously localStorage-only (nwp.cityHub.lastSeen.*); a fresh
-- session with no local key counted EVERY published post as unread.
--
-- This file does not INSERT, UPDATE, or DELETE any city_hub_posts row.
-- It does not change post status, visibility, or RLS on city_hub_posts.
-- Existing localStorage keys keep working as a cache; the server is source of truth after first visit/sync.
--
-- Read-only pre-check (run before this file; do not write):
--   SELECT count(*) AS published_posts
--   FROM public.city_hub_posts
--   WHERE status = 'published';
--   SELECT to_regclass('public.city_hub_read_state') AS city_hub_read_state;
--   SELECT proname
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND proname IN ('mark_city_hub_visited', 'get_city_hub_last_seen')
--   ORDER BY 1;
--
-- Post-check (after apply; counts must match pre-check for published_posts):
--   SELECT count(*) AS published_posts
--   FROM public.city_hub_posts
--   WHERE status = 'published';
--   SELECT to_regclass('public.city_hub_read_state') AS city_hub_read_state;
--   SELECT proname
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND proname IN ('mark_city_hub_visited', 'get_city_hub_last_seen')
--   ORDER BY 1;

CREATE TABLE IF NOT EXISTS public.city_hub_read_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_city_hub_read_state_updated
  ON public.city_hub_read_state (updated_at DESC);

ALTER TABLE public.city_hub_read_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS city_hub_read_state_select_own ON public.city_hub_read_state;
CREATE POLICY city_hub_read_state_select_own ON public.city_hub_read_state
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS city_hub_read_state_insert_own ON public.city_hub_read_state;
CREATE POLICY city_hub_read_state_insert_own ON public.city_hub_read_state
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS city_hub_read_state_update_own ON public.city_hub_read_state;
CREATE POLICY city_hub_read_state_update_own ON public.city_hub_read_state
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Mark visited: keep the later of existing and proposed timestamps.
CREATE OR REPLACE FUNCTION public.mark_city_hub_visited(p_seen_at timestamptz DEFAULT NULL)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  seen timestamptz := coalesce(p_seen_at, now());
  result timestamptz;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO public.city_hub_read_state AS crs (user_id, last_seen_at, updated_at)
  VALUES (uid, seen, now())
  ON CONFLICT (user_id) DO UPDATE
  SET
    last_seen_at = GREATEST(crs.last_seen_at, EXCLUDED.last_seen_at),
    updated_at = now()
  RETURNING crs.last_seen_at INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_city_hub_visited(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_city_hub_visited(timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_city_hub_last_seen()
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT crs.last_seen_at
  FROM public.city_hub_read_state crs
  WHERE crs.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_city_hub_last_seen() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_city_hub_last_seen() TO authenticated;
