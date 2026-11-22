-- 20261122010000_app_config_min_version.sql
--
-- In-app updates: server-side minimum supported Android version.
--
--   public.app_config: one row per platform ('android').
--     min_supported_version_code  installed versionCode below this must update
--                                 (0 = no forced update)
--     update_message              optional text shown on the "please update" screen
--   Readable by everyone (anon + signed-in). Writable only by global app staff
--   (admin / technical support) and the service role / SQL editor.
--
-- Additive and idempotent. Seeds ('android', 0) only if missing; never
-- overwrites an existing value.

CREATE TABLE IF NOT EXISTS public.app_config (
  platform text PRIMARY KEY,
  min_supported_version_code integer NOT NULL DEFAULT 0,
  update_message text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_config_platform_ok CHECK (platform IN ('android')),
  CONSTRAINT app_config_min_version_ok CHECK (min_supported_version_code >= 0),
  CONSTRAINT app_config_message_len CHECK (update_message IS NULL OR char_length(update_message) <= 300)
);

INSERT INTO public.app_config (platform, min_supported_version_code)
VALUES ('android', 0)
ON CONFLICT (platform) DO NOTHING;

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_config_read_all ON public.app_config;
CREATE POLICY app_config_read_all ON public.app_config
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS app_config_staff_update ON public.app_config;
CREATE POLICY app_config_staff_update ON public.app_config
  FOR UPDATE TO authenticated
  USING (public.is_global_app_staff())
  WITH CHECK (public.is_global_app_staff());

REVOKE ALL ON public.app_config FROM anon, authenticated, PUBLIC;
GRANT SELECT ON public.app_config TO anon, authenticated;
GRANT UPDATE (min_supported_version_code, update_message, updated_at) ON public.app_config TO authenticated;
GRANT ALL ON public.app_config TO service_role;

CREATE OR REPLACE FUNCTION public.app_config_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_config_touch ON public.app_config;
CREATE TRIGGER app_config_touch
  BEFORE UPDATE ON public.app_config
  FOR EACH ROW
  EXECUTE FUNCTION public.app_config_touch();

NOTIFY pgrst, 'reload schema';

-- Verification ---------------------------------------------------------------
DO $verify$
DECLARE
  problems text := '';
BEGIN
  IF to_regclass('public.app_config') IS NULL THEN
    problems := problems || 'app_config missing; ';
  ELSE
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.app_config'::regclass) THEN
      problems := problems || 'RLS off on app_config; ';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.app_config WHERE platform = 'android') THEN
      problems := problems || 'android row missing; ';
    END IF;
    IF NOT has_table_privilege('anon', 'public.app_config', 'SELECT') THEN
      problems := problems || 'anon cannot read app_config; ';
    END IF;
    IF has_table_privilege('anon', 'public.app_config', 'UPDATE')
       OR has_table_privilege('anon', 'public.app_config', 'INSERT') THEN
      problems := problems || 'anon can write app_config; ';
    END IF;
    IF has_table_privilege('authenticated', 'public.app_config', 'INSERT')
       OR has_table_privilege('authenticated', 'public.app_config', 'DELETE') THEN
      problems := problems || 'members can insert/delete app_config; ';
    END IF;
    IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_config'
        AND policyname IN ('app_config_read_all', 'app_config_staff_update')) <> 2 THEN
      problems := problems || 'app_config policies missing; ';
    END IF;
  END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'App config: verification failed: %', problems;
  END IF;
  RAISE NOTICE 'App config: OK (android min version %)',
    (SELECT min_supported_version_code FROM public.app_config WHERE platform = 'android');
END
$verify$;
