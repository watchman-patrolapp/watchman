-- Emoji reactions for emergency chat messages.
-- Allows lightweight acknowledgements like thumbs-up/check/eyes.

CREATE TABLE IF NOT EXISTS public.chat_message_reactions (
  message_id uuid NOT NULL REFERENCES public.chat_messages (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  reaction text NOT NULL CHECK (char_length(reaction) <= 16),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, reaction)
);

CREATE INDEX IF NOT EXISTS idx_chat_message_reactions_message
  ON public.chat_message_reactions (message_id);

ALTER TABLE public.chat_message_reactions ENABLE ROW LEVEL SECURITY;

-- Idempotent policy recreation for re-runnable migrations.
DROP POLICY IF EXISTS chat_message_reactions_select ON public.chat_message_reactions;
DROP POLICY IF EXISTS chat_message_reactions_insert_own ON public.chat_message_reactions;
DROP POLICY IF EXISTS chat_message_reactions_delete_own ON public.chat_message_reactions;

-- Users can see reactions on visible chat messages.
CREATE POLICY chat_message_reactions_select ON public.chat_message_reactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.chat_messages cm
      WHERE cm.id = chat_message_reactions.message_id
        AND cm.expires_at > now()
    )
  );

-- Users can add and remove their own reactions only.
CREATE POLICY chat_message_reactions_insert_own ON public.chat_message_reactions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY chat_message_reactions_delete_own ON public.chat_message_reactions
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
