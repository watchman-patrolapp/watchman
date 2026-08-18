-- Two chat rooms per neighborhood:
--   patrol   = watch-only ops (residents never see these)
--   resident = household ↔ patrol (all patrollers see and can reply)
-- SOS / critical duty alerts stay on patrol.

CREATE OR REPLACE FUNCTION public.is_chat_ops_member()
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
      WHERE cu.id::text = auth.uid()::text
        AND replace(lower(trim(cu.role::text)), '-', '_') IN (
          'admin',
          'technical_support',
          'nw_admin',
          'committee',
          'patroller',
          'volunteer',
          'investigator',
          'security_admin',
          'city_admin'
        )
    );
$$;

REVOKE ALL ON FUNCTION public.is_chat_ops_member() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_chat_ops_member() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_chat_ops_member() TO service_role;

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS visibility text;

UPDATE public.chat_messages
SET visibility = 'patrol'
WHERE visibility IS NULL;

ALTER TABLE public.chat_messages
  ALTER COLUMN visibility SET DEFAULT 'patrol';

ALTER TABLE public.chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_visibility_check;

ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_visibility_check
  CHECK (visibility IN ('patrol', 'resident'));

ALTER TABLE public.chat_messages
  ALTER COLUMN visibility SET NOT NULL;

-- Keep household posts in the neighbour room; SOS / critical stay on patrol ops.
UPDATE public.chat_messages cm
SET visibility = 'resident'
FROM public.users u
WHERE cm.sender_id::text = u.id::text
  AND replace(lower(trim(u.role::text)), '-', '_') = 'resident'
  AND coalesce(cm.is_critical, false) IS NOT TRUE
  AND coalesce(cm.visibility, 'patrol') = 'patrol';

CREATE INDEX IF NOT EXISTS idx_chat_messages_org_visibility_created
  ON public.chat_messages (organization_id, visibility, created_at DESC);

ALTER TABLE public.chat_read_state
  ADD COLUMN IF NOT EXISTS resident_last_read_message_id uuid,
  ADD COLUMN IF NOT EXISTS resident_last_read_at timestamptz;

-- Replace SELECT policies so patrol rows cannot leak to residents.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_messages'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.chat_messages', r.policyname);
  END LOOP;
END $$;

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_messages_select_channel ON public.chat_messages
  FOR SELECT TO authenticated
  USING (
    (
      organization_id IN (SELECT public.current_org_ids())
      OR (organization_id IS NULL AND public.is_chat_ops_member())
    )
    AND (
      visibility = 'resident'
      OR public.is_chat_ops_member()
    )
  );

CREATE POLICY chat_messages_insert_channel ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id::text = auth.uid()::text
    AND (
      organization_id IN (SELECT public.current_org_ids())
      OR organization_id IS NULL
    )
    AND (
      visibility = 'resident'
      OR (visibility = 'patrol' AND public.is_chat_ops_member())
      OR (visibility = 'patrol' AND coalesce(is_critical, false) IS TRUE)
    )
  );

CREATE POLICY chat_messages_update_own ON public.chat_messages
  FOR UPDATE TO authenticated
  USING (sender_id::text = auth.uid()::text OR public.is_chat_ops_member())
  WITH CHECK (sender_id::text = auth.uid()::text OR public.is_chat_ops_member());

CREATE POLICY chat_messages_delete_ops ON public.chat_messages
  FOR DELETE TO authenticated
  USING (public.is_chat_ops_member());

DROP FUNCTION IF EXISTS public.chat_unread_for_me(uuid);
DROP FUNCTION IF EXISTS public.chat_unread_for_me();
DROP FUNCTION IF EXISTS public.chat_mark_read(uuid);

CREATE OR REPLACE FUNCTION public.chat_unread_for_me(
  p_organization_id uuid DEFAULT NULL,
  p_visibility text DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH allowed_org AS (
    SELECT COALESCE(p_organization_id, public.working_organization_id()) AS org_id
  ),
  channel AS (
    SELECT COALESCE(
      nullif(trim(p_visibility), ''),
      CASE WHEN public.is_chat_ops_member() THEN 'patrol' ELSE 'resident' END
    ) AS visibility
  ),
  boundary AS (
    SELECT CASE
      WHEN (SELECT visibility FROM channel) = 'resident' THEN
        COALESCE(
          (SELECT m.created_at
           FROM public.chat_messages m
           JOIN public.chat_read_state crs
             ON crs.user_id = auth.uid()
            AND m.id::text = crs.resident_last_read_message_id::text),
          (SELECT crs2.resident_last_read_at FROM public.chat_read_state crs2 WHERE crs2.user_id = auth.uid()),
          CASE
            WHEN public.is_chat_ops_member() THEN NULL
            ELSE (SELECT crs3.last_read_at FROM public.chat_read_state crs3 WHERE crs3.user_id = auth.uid())
          END,
          '-infinity'::timestamptz
        )
      ELSE
        COALESCE(
          (SELECT m.created_at
           FROM public.chat_messages m
           JOIN public.chat_read_state crs
             ON crs.user_id = auth.uid()
            AND m.id::text = crs.last_read_message_id::text),
          (SELECT crs2.last_read_at FROM public.chat_read_state crs2 WHERE crs2.user_id = auth.uid()),
          '-infinity'::timestamptz
        )
    END AS t
  )
  SELECT count(*)::int
  FROM public.chat_messages cm, boundary b, allowed_org ao, channel ch
  WHERE cm.sender_id::text IS DISTINCT FROM auth.uid()::text
    AND cm.expires_at > now()
    AND cm.created_at > b.t
    AND ao.org_id IS NOT NULL
    AND cm.organization_id = ao.org_id
    AND coalesce(cm.visibility, 'patrol') = ch.visibility;
$$;

CREATE OR REPLACE FUNCTION public.chat_unread_for_me()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.chat_unread_for_me(NULL::uuid, NULL::text);
$$;

REVOKE ALL ON FUNCTION public.chat_unread_for_me(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_unread_for_me(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.chat_unread_for_me() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_unread_for_me() TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_mark_read(
  p_message_id uuid DEFAULT NULL,
  p_visibility text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  mid uuid;
  mts timestamptz;
  vis text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  vis := COALESCE(
    nullif(trim(p_visibility), ''),
    CASE WHEN public.is_chat_ops_member() THEN 'patrol' ELSE 'resident' END
  );

  IF p_message_id IS NOT NULL THEN
    SELECT id, created_at INTO mid, mts
    FROM public.chat_messages
    WHERE id = p_message_id
      AND expires_at > now()
      AND organization_id IN (SELECT public.current_org_ids());
    IF mid IS NULL THEN
      RETURN;
    END IF;
  ELSE
    SELECT id, created_at INTO mid, mts
    FROM public.chat_messages
    WHERE expires_at > now()
      AND organization_id IN (SELECT public.current_org_ids())
      AND coalesce(visibility, 'patrol') = vis
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF vis = 'resident' THEN
    INSERT INTO public.chat_read_state (
      user_id, last_read_at, updated_at,
      resident_last_read_message_id, resident_last_read_at
    )
    VALUES (uid, '-infinity'::timestamptz, now(), mid, COALESCE(mts, now()))
    ON CONFLICT (user_id) DO UPDATE SET
      resident_last_read_message_id = EXCLUDED.resident_last_read_message_id,
      resident_last_read_at = EXCLUDED.resident_last_read_at,
      updated_at = now();
  ELSE
    INSERT INTO public.chat_read_state (user_id, last_read_message_id, last_read_at, updated_at)
    VALUES (uid, mid, COALESCE(mts, now()), now())
    ON CONFLICT (user_id) DO UPDATE SET
      last_read_message_id = EXCLUDED.last_read_message_id,
      last_read_at = EXCLUDED.last_read_at,
      updated_at = now();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.chat_mark_read(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_mark_read(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
