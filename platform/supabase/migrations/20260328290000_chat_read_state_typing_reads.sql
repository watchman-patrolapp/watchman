-- Emergency chat: per-user read cursor, critical message read receipts, RPCs for unread count.
-- Requires existing public.chat_messages (id uuid PK, created_at, expires_at, sender_id, is_critical, ...).

-- ---------------------------------------------------------------------------
-- Read cursor (one row per user, global emergency thread)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_read_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  last_read_message_id uuid REFERENCES public.chat_messages (id) ON DELETE SET NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_read_state_updated ON public.chat_read_state (updated_at DESC);

ALTER TABLE public.chat_read_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_read_state_select_own ON public.chat_read_state
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY chat_read_state_insert_own ON public.chat_read_state
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY chat_read_state_update_own ON public.chat_read_state
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Read receipts for critical messages (viewer acknowledges)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_message_reads (
  message_id uuid NOT NULL REFERENCES public.chat_messages (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_message_reads_message ON public.chat_message_reads (message_id);

ALTER TABLE public.chat_message_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_message_reads_insert_own ON public.chat_message_reads
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY chat_message_reads_select ON public.chat_message_reads
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.chat_messages cm
      WHERE cm.id::text = chat_message_reads.message_id::text
        AND cm.sender_id::text = auth.uid()::text
    )
  );

-- ---------------------------------------------------------------------------
-- Unread count (uses read cursor; messages from others after boundary)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_unread_for_me()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH boundary AS (
    SELECT COALESCE(
      (SELECT m.created_at
       FROM public.chat_messages m
       JOIN public.chat_read_state crs ON crs.user_id = auth.uid() AND m.id::text = crs.last_read_message_id::text),
      (SELECT crs2.last_read_at FROM public.chat_read_state crs2 WHERE crs2.user_id = auth.uid()),
      '-infinity'::timestamptz
    ) AS t
  )
  SELECT count(*)::int
  FROM public.chat_messages cm, boundary b
  WHERE cm.sender_id::text IS DISTINCT FROM auth.uid()::text
    AND cm.expires_at > now()
    AND cm.created_at > b.t;
$$;

REVOKE ALL ON FUNCTION public.chat_unread_for_me() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_unread_for_me() TO authenticated;

-- ---------------------------------------------------------------------------
-- Mark read up to a message (or latest if null)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_mark_read(p_message_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  mid uuid;
  mts timestamptz;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_message_id IS NOT NULL THEN
    SELECT id, created_at INTO mid, mts
    FROM public.chat_messages
    WHERE id = p_message_id AND expires_at > now();
    IF mid IS NULL THEN
      RETURN;
    END IF;
  ELSE
    SELECT id, created_at INTO mid, mts
    FROM public.chat_messages
    WHERE expires_at > now()
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  INSERT INTO public.chat_read_state (user_id, last_read_message_id, last_read_at, updated_at)
  VALUES (uid, mid, COALESCE(mts, now()), now())
  ON CONFLICT (user_id) DO UPDATE SET
    last_read_message_id = EXCLUDED.last_read_message_id,
    last_read_at = EXCLUDED.last_read_at,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.chat_mark_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_mark_read(uuid) TO authenticated;
