-- G1: hide, restore, and edit-own for area broadcasts.
-- Additive only. Existing notice rows are not updated, deleted, or rewritten.
-- New columns are nullable. Hide/restore/edit go through RPCs (no UPDATE policy).
--
-- Latest definitions copied forward:
--   list_area_broadcasts + 12h/24h windows: 20260818030000_area_broadcast_home_windows.sql
--   SELECT policy area_broadcasts_select_org: 20260816002000_away_broadcasts_civic.sql
-- post_area_broadcast, the insert policy, and the realtime publication are unchanged.

ALTER TABLE public.area_broadcasts
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hidden_reason text,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

ALTER TABLE public.area_broadcasts
  DROP CONSTRAINT IF EXISTS area_broadcasts_hidden_reason_len;

ALTER TABLE public.area_broadcasts
  ADD CONSTRAINT area_broadcasts_hidden_reason_len
  CHECK (hidden_reason IS NULL OR char_length(hidden_reason) <= 300);

CREATE INDEX IF NOT EXISTS area_broadcasts_org_visible_idx
  ON public.area_broadcasts (organization_id, created_at DESC)
  WHERE hidden_at IS NULL;

-- ---------------------------------------------------------------------------
-- Who may hide or restore any notice in the caller's working neighbourhood.
-- admin / technical_support are already covered by is_global_app_staff().
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_area_broadcast_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_global_app_staff()
    OR public.is_platform_staff()
    OR EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND replace(lower(trim(cu.role::text)), '-', '_') IN ('nw_admin', 'committee')
    );
$$;

CREATE OR REPLACE FUNCTION public.hide_area_broadcast(p_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b public.area_broadcasts;
  cleaned_reason text;
  was_hidden boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO b
  FROM public.area_broadcasts
  WHERE id = p_id
  FOR UPDATE;

  IF b.id IS NULL OR b.organization_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'notice not found';
  END IF;

  IF NOT (
    b.author_id = auth.uid()
    OR public.is_area_broadcast_staff()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  cleaned_reason := nullif(trim(p_reason), '');
  IF cleaned_reason IS NOT NULL AND char_length(cleaned_reason) > 300 THEN
    RAISE EXCEPTION 'reason is too long';
  END IF;

  was_hidden := b.hidden_at IS NOT NULL;

  UPDATE public.area_broadcasts
  SET
    hidden_at = now(),
    hidden_by = auth.uid(),
    hidden_reason = cleaned_reason
  WHERE id = p_id;

  PERFORM public.write_staff_activity(
    'area_broadcast_hidden',
    jsonb_build_object(
      'broadcast_id', b.id,
      'headline', left(coalesce(b.headline, ''), 160),
      'reason', cleaned_reason
    ),
    auth.uid(),
    b.organization_id
  );

  IF NOT was_hidden AND b.author_id IS NOT NULL AND b.author_id <> auth.uid() THEN
    PERFORM public.notify_app_user(
      b.author_id,
      'moderation',
      'Your notice was hidden',
      coalesce(cleaned_reason, nullif(trim(b.headline), '')),
      '/resident'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_area_broadcast(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b public.area_broadcasts;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO b
  FROM public.area_broadcasts
  WHERE id = p_id
  FOR UPDATE;

  IF b.id IS NULL OR b.organization_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'notice not found';
  END IF;

  IF NOT public.is_area_broadcast_staff() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF b.hidden_at IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.area_broadcasts
  SET
    hidden_at = NULL,
    hidden_by = NULL,
    hidden_reason = NULL
  WHERE id = p_id;

  PERFORM public.write_staff_activity(
    'area_broadcast_restored',
    jsonb_build_object('broadcast_id', b.id),
    auth.uid(),
    b.organization_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.edit_area_broadcast(p_id uuid, p_headline text, p_body text)
RETURNS public.area_broadcasts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b public.area_broadcasts;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO b
  FROM public.area_broadcasts
  WHERE id = p_id
  FOR UPDATE;

  IF b.id IS NULL OR b.organization_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'notice not found';
  END IF;
  IF b.author_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF b.created_at < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'notices can only be edited for 15 minutes; hide and re-post instead';
  END IF;
  IF b.hidden_at IS NOT NULL THEN
    RAISE EXCEPTION 'notice is hidden';
  END IF;
  IF nullif(trim(p_headline), '') IS NULL OR char_length(trim(p_headline)) > 120 THEN
    RAISE EXCEPTION 'headline is required (max 120)';
  END IF;
  IF nullif(trim(p_body), '') IS NULL OR char_length(trim(p_body)) > 4000 THEN
    RAISE EXCEPTION 'message is required (max 4000)';
  END IF;

  UPDATE public.area_broadcasts
  SET
    headline = trim(p_headline),
    body = trim(p_body),
    edited_at = now()
  WHERE id = p_id
  RETURNING * INTO b;

  RETURN b;
END;
$$;

-- Return type gains edited_at and author_id, so the previous function must be dropped.
-- 12-hour Home pin and 24-hour activity window are unchanged.
-- author_id is required by the edit-own button; the resident home ignores it.
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
  activity_until timestamptz,
  edited_at timestamptz,
  author_id uuid
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
    b.created_at + interval '24 hours',
    b.edited_at,
    b.author_id
  FROM public.area_broadcasts b
  LEFT JOIN public.users u ON u.id = b.author_id
  WHERE b.organization_id = public.working_organization_id()
    AND b.created_at >= now() - interval '24 hours'
    AND b.hidden_at IS NULL
  ORDER BY b.created_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 8), 30));
$$;

-- Staff-only companion to the live list. The live list must stay hidden-free
-- because the resident home uses it. Author names come from this definer
-- function so the Hidden filter does not depend on users-table RLS.
CREATE OR REPLACE FUNCTION public.list_hidden_area_broadcasts(p_limit integer DEFAULT 30)
RETURNS TABLE (
  id uuid,
  headline text,
  body text,
  created_at timestamptz,
  expires_at timestamptz,
  author_name text,
  pinned_until timestamptz,
  activity_until timestamptz,
  edited_at timestamptz,
  author_id uuid,
  hidden_at timestamptz,
  hidden_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_area_broadcast_staff() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    coalesce(nullif(trim(b.headline), ''), 'Neighbourhood notice'),
    b.body,
    b.created_at,
    b.expires_at,
    coalesce(nullif(trim(u.full_name), ''), 'Neighbourhood watch'),
    b.created_at + interval '12 hours',
    b.created_at + interval '24 hours',
    b.edited_at,
    b.author_id,
    b.hidden_at,
    b.hidden_reason
  FROM public.area_broadcasts b
  LEFT JOIN public.users u ON u.id = b.author_id
  WHERE b.organization_id = public.working_organization_id()
    AND b.hidden_at IS NOT NULL
  ORDER BY b.hidden_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 30), 30));
END;
$$;

-- Visible notices: same reach as 20260816002000 (working org, or global / platform staff).
-- Hidden notices: staff and the author only. No UPDATE or DELETE policy.
DROP POLICY IF EXISTS area_broadcasts_select_org ON public.area_broadcasts;
CREATE POLICY area_broadcasts_select_org ON public.area_broadcasts
  FOR SELECT TO authenticated
  USING (
    (
      organization_id IN (SELECT public.current_org_ids())
      OR public.is_global_app_staff()
      OR public.is_platform_staff()
    )
    AND (
      hidden_at IS NULL
      OR public.is_area_broadcast_staff()
      OR author_id = auth.uid()
    )
  );

-- Residents cannot SELECT a row once it is hidden, so Realtime will not deliver
-- that UPDATE to open Home screens. This trigger broadcasts the id and timestamps
-- only (no headline or body) on the channel subscribeAreaBroadcasts already joins.
CREATE OR REPLACE FUNCTION public.trg_area_broadcast_visibility_signal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM realtime.send(
      jsonb_build_object(
        'id', NEW.id,
        'organization_id', NEW.organization_id,
        'hidden_at', NEW.hidden_at,
        'edited_at', NEW.edited_at
      ),
      'UPDATE',
      'area-broadcasts-' || NEW.organization_id::text,
      false
    );
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'area broadcast visibility signal skipped: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS area_broadcasts_visibility_signal ON public.area_broadcasts;
CREATE TRIGGER area_broadcasts_visibility_signal
  AFTER UPDATE ON public.area_broadcasts
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_area_broadcast_visibility_signal();

REVOKE ALL ON FUNCTION public.is_area_broadcast_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_area_broadcast_staff() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.hide_area_broadcast(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hide_area_broadcast(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.restore_area_broadcast(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_area_broadcast(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.edit_area_broadcast(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_area_broadcast(uuid, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_area_broadcasts(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_area_broadcasts(integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_hidden_area_broadcasts(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_hidden_area_broadcasts(integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.trg_area_broadcast_visibility_signal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_area_broadcast_visibility_signal() TO service_role;

-- Direct client writes cannot bypass the RPCs. SELECT stays so live lists and
-- Realtime inserts keep working. service_role already has ALL from 20260816002000.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.area_broadcasts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.area_broadcasts TO authenticated;
GRANT ALL ON TABLE public.area_broadcasts TO service_role;
