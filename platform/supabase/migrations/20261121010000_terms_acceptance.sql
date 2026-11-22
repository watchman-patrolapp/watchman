-- 20261121010000_terms_acceptance.sql
--
-- Terms acceptance gate.
--
-- Every signed-in member must accept the current Terms of Use and Privacy
-- Policy before using the app, and again whenever the version changes.
--
--   - public.users.terms_version, public.users.terms_accepted_at
--       (latest accepted version; read by the app with the profile)
--   - public.terms_acceptances: one row per acceptance (audit trail)
--   - public.accept_terms(p_version, p_source): records acceptance for
--       auth.uid() only; the time is set by the server
--
-- Additive and idempotent. Changes no existing rows: nobody is marked as
-- accepted, so every member sees the acceptance screen once.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS terms_version text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;

CREATE TABLE IF NOT EXISTS public.terms_acceptances (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  terms_version text NOT NULL,
  source text NOT NULL DEFAULT 'gate',
  accepted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT terms_acceptances_version_len CHECK (char_length(terms_version) BETWEEN 1 AND 40),
  CONSTRAINT terms_acceptances_source_ok CHECK (source IN ('gate', 'signup'))
);

CREATE INDEX IF NOT EXISTS terms_acceptances_user_idx
  ON public.terms_acceptances (user_id, accepted_at DESC);

ALTER TABLE public.terms_acceptances ENABLE ROW LEVEL SECURITY;

-- Members can read their own history. Writes go through accept_terms only.
DROP POLICY IF EXISTS terms_acceptances_select_own ON public.terms_acceptances;
CREATE POLICY terms_acceptances_select_own ON public.terms_acceptances
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.terms_acceptances FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.terms_acceptances FROM authenticated;
GRANT SELECT ON public.terms_acceptances TO authenticated;
GRANT ALL ON public.terms_acceptances TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.terms_acceptances_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.accept_terms(p_version text, p_source text DEFAULT 'gate')
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_version text := trim(coalesce(p_version, ''));
  v_source text := CASE WHEN p_source = 'signup' THEN 'signup' ELSE 'gate' END;
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_version) < 1 OR char_length(v_version) > 40 THEN
    RAISE EXCEPTION 'invalid terms version' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.terms_acceptances (user_id, terms_version, source, accepted_at)
  VALUES (v_uid, v_version, v_source, v_now);

  UPDATE public.users
     SET terms_version = v_version,
         terms_accepted_at = v_now
   WHERE id = v_uid;

  RETURN v_now;
END;
$$;

COMMENT ON FUNCTION public.accept_terms(text, text) IS
  'Records that the signed-in member accepted a Terms/Privacy version. Uses auth.uid() and server time.';

REVOKE ALL ON FUNCTION public.accept_terms(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_terms(text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- Verification ---------------------------------------------------------------
DO $verify$
DECLARE
  problems text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'terms_version') THEN
    problems := problems || 'users.terms_version missing; ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'terms_accepted_at') THEN
    problems := problems || 'users.terms_accepted_at missing; ';
  END IF;
  IF to_regclass('public.terms_acceptances') IS NULL THEN
    problems := problems || 'terms_acceptances missing; ';
  ELSE
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.terms_acceptances'::regclass) THEN
      problems := problems || 'RLS off on terms_acceptances; ';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'terms_acceptances' AND policyname = 'terms_acceptances_select_own') THEN
      problems := problems || 'terms_acceptances select policy missing; ';
    END IF;
    IF has_table_privilege('anon', 'public.terms_acceptances', 'SELECT') THEN
      problems := problems || 'anon can read terms_acceptances; ';
    END IF;
    IF has_table_privilege('authenticated', 'public.terms_acceptances', 'INSERT') THEN
      problems := problems || 'members can insert terms_acceptances directly; ';
    END IF;
  END IF;
  IF to_regprocedure('public.accept_terms(text, text)') IS NULL THEN
    problems := problems || 'accept_terms missing; ';
  ELSE
    IF has_function_privilege('anon', 'public.accept_terms(text, text)', 'EXECUTE') THEN
      problems := problems || 'anon can run accept_terms; ';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.accept_terms(text, text)', 'EXECUTE') THEN
      problems := problems || 'members cannot run accept_terms; ';
    END IF;
  END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'Terms gate: verification failed: %', problems;
  END IF;
  RAISE NOTICE 'Terms gate: OK';
END
$verify$;
