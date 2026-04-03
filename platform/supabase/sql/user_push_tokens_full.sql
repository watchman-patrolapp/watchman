-- =============================================================================
-- user_push_tokens — full script for Supabase SQL Editor (Dashboard)
-- =============================================================================
-- Run once on your project. Re-runnable (drops policies before recreate).
--
-- After this SQL:
--   1) Deploy Edge Function: supabase functions deploy notify-chat-message --no-verify-jwt
--   2) Set secrets in Dashboard → Edge Functions → notify-chat-message → Secrets
--   3) Database → Webhooks → New → table chat_messages, INSERT → POST function URL
--   4) Firebase: enable FCM, add google-services.json to Android app
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL DEFAULT 'web',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_push_tokens_user_token UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_id ON public.user_push_tokens (user_id);

ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert own push tokens" ON public.user_push_tokens;
DROP POLICY IF EXISTS "Users update own push tokens" ON public.user_push_tokens;
DROP POLICY IF EXISTS "Users delete own push tokens" ON public.user_push_tokens;
DROP POLICY IF EXISTS "Users select own push tokens" ON public.user_push_tokens;

CREATE POLICY "Users insert own push tokens"
  ON public.user_push_tokens FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own push tokens"
  ON public.user_push_tokens FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own push tokens"
  ON public.user_push_tokens FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users select own push tokens"
  ON public.user_push_tokens FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.user_push_tokens IS 'FCM registration tokens; used by notify-chat-message Edge Function.';
