-- Advisor harden (safe):
-- 1) Pin search_path on mutable-search_path helpers
-- 2) Strip PUBLIC/anon EXECUTE from SECURITY DEFINER RPCs
-- 3) Lock trigger / destructive / service-only funcs off authenticated
-- 4) Keep anon only for public signup options
--
-- Does NOT move extensions or change storage policies.

-- ---------------------------------------------------------------------------
-- 1) search_path
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  names text[] := ARRAY[
    'default_city_id',
    'is_watch_local_staff_role',
    'is_household_directory_role',
    'security_health_check',
    'resident_street_label',
    'is_admin_or_committee',
    'is_admin_or_committee_check',
    'normalize_emergency_contact_relationship',
    'hard_delete_user_by_email',
    'set_default_city_id',
    'is_staff_role',
    'home_distance_m'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (names)
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.sig);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2–3) EXECUTE grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  -- Not callable via PostgREST as a signed-in user (triggers / cron / service only).
  internal_names text[] := ARRAY[
    'hard_delete_user_by_email',
    'rls_auto_enable',
    'run_chat_messages_retention_purge',
    'notify_app_user',
    'handle_new_user',
    'on_auth_user_created',
    'trg_apply_signup_profile',
    'trg_guard_patroller_request',
    'trg_log_watch_staff_broadcast',
    'trg_log_watch_staff_incident',
    'trg_log_watch_staff_profile_verify',
    'trg_log_watch_staff_user_changes',
    'stamp_working_organization_id',
    'prevent_global_role_org_membership',
    'app_notifications_from_membership_event',
    'notify_chat_message_push_webhook',
    'incident_section_updates_set_author',
    'resident_security_memberships_one_primary_tg',
    'sync_user_phone_from_auth_metadata',
    'set_default_city_id',
    'apply_signup_profile_for_user',
    'apply_signup_profile_for_user_core',
    'apply_security_company_signup',
    'security_membership_log_event',
    'ensure_public_user_from_auth',
    'write_staff_activity',
    'security_health_check'
  ];
  is_internal boolean;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef IS TRUE
  LOOP
    is_internal := r.proname = ANY (internal_names);

    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);

    IF is_internal THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    ELSE
      -- App RPCs: signed-in only (gates inside the function stay as-is).
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    END IF;
  END LOOP;

  -- Trigger helpers that are not SECURITY DEFINER still should not be HTTP-callable.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef IS NOT TRUE
      AND p.proname = ANY (internal_names)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Intentional pre-login RPC
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.list_public_signup_options()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.list_public_signup_options() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.list_public_signup_options() TO anon;
    GRANT EXECUTE ON FUNCTION public.list_public_signup_options() TO authenticated;
    GRANT EXECUTE ON FUNCTION public.list_public_signup_options() TO service_role;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
