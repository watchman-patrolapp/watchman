-- Fix: chat_messages.sender_id (and/or id) may be text while auth.uid() is uuid.
-- Run this if you hit: operator does not exist: text = uuid

DROP POLICY IF EXISTS chat_message_reads_select ON public.chat_message_reads;

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
