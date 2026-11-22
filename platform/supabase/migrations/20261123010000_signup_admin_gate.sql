-- Phase N0: signup admin gate
--
-- Closes two holes found in the 2026-11-23 audit (latest definitions):
--   1. apply_signup_profile_for_user_core (20260815060000) gives a public
--      "Neighborhood Watch" or "Security company" sign-up users.role
--      nw_admin / security_admin straight away, with an ACTIVE admin
--      membership (a typed company name can even match an existing active
--      company). can_view_criminal_intelligence and
--      can_view_city_hub_suspect_alert then pass before anyone reviews them.
--   2. city_admin_communities (20260815038000) lists every organisation on
--      the platform, with admin email and phone, to any city_admin.
--
-- What this file does (additive, idempotent; safe to run twice):
--   * Sign-ups for a watch or security company become REQUESTS: the person
--     stays users.role = 'resident', their membership is 'pending' with the
--     intended role, and a new org is marked settings_json.review_state =
--     'requested'. Approval promotes them.
--   * org_access_blocked(): suspended orgs, and pending orgs still waiting
--     on a request, give no org access through current_org_ids /
--     is_org_nw_admin. Older pending orgs (before this file) keep working.
--   * approve_organization / reject_organization / list_organization_requests
--     for platform staff and global admins / support, plus
--     my_organization_requests for the requester's own status.
--   * Activating a pending org any other way (console edit, Verify company)
--     also promotes its requesters (trigger).
--   * city_admin_communities limited to the caller's own city (platform and
--     global staff still see everything).
--
-- Run after every earlier migration. Ends with NOTICE 'Signup admin gate: OK'.

-- ---------------------------------------------------------------------------
-- Pre-check: list everything missing at once; change nothing if any is missing
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE
  missing text[] := ARRAY[]::text[];
  r record;
  found text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('auth', 'users', 'id'), ('auth', 'users', 'raw_user_meta_data'),
      ('public', 'users', 'id'), ('public', 'users', 'role'), ('public', 'users', 'platform_role'),
      ('public', 'users', 'organization_id'), ('public', 'users', 'active_organization_id'),
      ('public', 'users', 'full_name'), ('public', 'users', 'email'), ('public', 'users', 'phone'),
      ('public', 'users', 'signup_track'),
      ('public', 'organizations', 'id'), ('public', 'organizations', 'name'), ('public', 'organizations', 'type'),
      ('public', 'organizations', 'status'), ('public', 'organizations', 'settings_json'),
      ('public', 'organizations', 'city_id'), ('public', 'organizations', 'created_at'),
      ('public', 'organization_members', 'organization_id'), ('public', 'organization_members', 'user_id'),
      ('public', 'organization_members', 'member_role'), ('public', 'organization_members', 'status'),
      ('public', 'organization_members', 'joined_at'),
      ('public', 'cities', 'id'), ('public', 'cities', 'name')
    ) AS t(s, tbl, col)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = r.s AND c.table_name = r.tbl AND c.column_name = r.col
    ) THEN
      missing := missing || (CASE WHEN r.s = 'public' THEN '' ELSE r.s || '.' END || r.tbl || '.' || r.col);
    END IF;
  END LOOP;

  -- Functions are matched by name; the expected arguments are reported if a
  -- function exists under that name with different ones.
  FOR r IN
    SELECT * FROM (VALUES
      ('is_global_app_staff', ''),
      ('is_platform_staff', ''),
      ('working_organization_id', ''),
      ('default_city_id', ''),
      ('current_org_ids', ''),
      ('city_admin_communities', '')
    ) AS t(fn, args)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = r.fn
        AND pg_get_function_identity_arguments(p.oid) = r.args
    ) THEN
      SELECT string_agg(format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)), ', ')
        INTO found
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = r.fn;
      missing := missing || (format('%s(%s) function', r.fn, r.args)
        || CASE WHEN found IS NULL THEN '' ELSE format(' (found %s instead)', found) END);
    END IF;
  END LOOP;

  -- Sign-up logic: either the core (after 20260818063000) or the single
  -- apply_signup_profile_for_user(uuid) that still holds the logic.
  IF to_regprocedure('public.apply_signup_profile_for_user_core(uuid)') IS NULL
     AND to_regprocedure('public.apply_signup_profile_for_user(uuid)') IS NULL THEN
    SELECT string_agg(format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)), ', ')
      INTO found
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'apply%signup%';
    missing := missing || ('apply_signup_profile_for_user(uuid) or apply_signup_profile_for_user_core(uuid) function'
      || CASE WHEN found IS NULL THEN '' ELSE format(' (found %s instead; run signup-gate-diagnostic.sql)', found) END);
  ELSIF to_regprocedure('public.apply_signup_profile_for_user_core(uuid)') IS NULL
     AND position('apply_signup_profile_for_user_core' IN
         pg_get_functiondef('public.apply_signup_profile_for_user(uuid)'::regprocedure)) > 0 THEN
    missing := missing || 'apply_signup_profile_for_user_core(uuid) function (the sign-up wrapper calls it but it is gone; run signup-gate-diagnostic.sql)'::text;
  END IF;

  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'Signup admin gate: not applied, missing %. Nothing was changed.',
      array_to_string(missing, ', ');
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- Heads-up (read-only): who is affected, printed before anything changes
-- ---------------------------------------------------------------------------
DO $heads$
DECLARE
  v text;
BEGIN
  SELECT string_agg(format('%s (%s, %s active member%s)', o.name, o.type, n, CASE WHEN n = 1 THEN '' ELSE 's' END), '; ' ORDER BY o.name)
    INTO v
  FROM (
    SELECT o.id, o.name, o.type, count(om.user_id) AS n
    FROM public.organizations o
    JOIN public.organization_members om ON om.organization_id = o.id AND om.status = 'active'
    WHERE o.status = 'suspended'
    GROUP BY o.id, o.name, o.type
  ) o;
  RAISE NOTICE 'Heads-up 1 of 3. Suspended organisations whose members lose org access after this: %',
    coalesce(v, 'none');

  SELECT string_agg(format('%s (%s): %s', o.name, o.type, o.admins), '; ' ORDER BY o.name)
    INTO v
  FROM (
    SELECT o.id, o.name, o.type,
           string_agg(coalesce(nullif(btrim(u.full_name), ''), 'member') || ' as ' || om.member_role, ', ') AS admins
    FROM public.organizations o
    JOIN public.organization_members om
      ON om.organization_id = o.id AND om.status = 'active'
     AND om.member_role IN ('nw_admin', 'security_admin', 'committee')
    LEFT JOIN public.users u ON u.id = om.user_id
    WHERE o.status = 'pending'
      AND coalesce(o.settings_json->>'review_state', '') = ''
    GROUP BY o.id, o.name, o.type
  ) o;
  RAISE NOTICE 'Heads-up 2 of 3. Pending organisations that already have active admins (they KEEP access; approve or reject them under Organisations > Pending requests): %',
    coalesce(v, 'none');

  SELECT string_agg(DISTINCT coalesce(c.name, 'default city'), ', ')
    INTO v
  FROM public.users u
  LEFT JOIN public.organization_members om ON om.user_id = u.id AND om.status = 'active'
  LEFT JOIN public.organizations o ON o.id = coalesce(om.organization_id, u.organization_id)
  LEFT JOIN public.cities c ON c.id = coalesce(o.city_id, public.default_city_id())
  WHERE replace(lower(trim(coalesce(u.role::text, ''))), '-', '_') = 'city_admin';
  RAISE NOTICE 'Heads-up 3 of 3. City admins will now only see organisations in: %',
    coalesce(v, 'no city admins yet');
END
$heads$;

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by clients)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.org_access_blocked(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_org_id
      AND (
        o.status = 'suspended'
        OR (o.status = 'pending' AND coalesce(o.settings_json->>'review_state', '') = 'requested')
      )
  );
$$;
COMMENT ON FUNCTION public.org_access_blocked(uuid) IS
  'Signup admin gate: true for suspended orgs and for pending orgs still waiting on a sign-up request. Older pending orgs are not blocked.';
REVOKE ALL ON FUNCTION public.org_access_blocked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_access_blocked(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.signup_admin_role_key(p_role text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT replace(lower(trim(coalesce(p_role, ''))), '-', '_');
$$;
REVOKE ALL ON FUNCTION public.signup_admin_role_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.signup_admin_role_key(text) TO service_role;

-- Promote pending admin requesters of one org (optionally one person).
-- Only lifts users.role from resident / empty; never demotes or changes staff.
CREATE OR REPLACE FUNCTION public.promote_org_requesters(p_org_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT om.user_id, om.member_role
    FROM public.organization_members om
    WHERE om.organization_id = p_org_id
      AND om.status = 'pending'
      AND om.member_role IN ('nw_admin', 'security_admin')
      AND (p_user_id IS NULL OR om.user_id = p_user_id)
  LOOP
    UPDATE public.organization_members
    SET status = 'active'
    WHERE organization_id = p_org_id AND user_id = r.user_id;

    UPDATE public.users
    SET
      role = CASE
        WHEN public.signup_admin_role_key(role::text) IN ('', 'resident', 'user') THEN r.member_role
        ELSE role
      END,
      organization_id = coalesce(organization_id, p_org_id),
      active_organization_id = coalesce(active_organization_id, p_org_id)
    WHERE id = r.user_id;

    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.promote_org_requesters(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_org_requesters(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Org access: skip blocked orgs (staff working-area choice is unchanged)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT w.id
  FROM (SELECT public.working_organization_id() AS id) w
  WHERE w.id IS NOT NULL
    AND (
      public.is_global_app_staff()
      OR public.is_platform_staff()
      OR NOT public.org_access_blocked(w.id)
    )
  UNION
  SELECT om.organization_id
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.status = 'active'
    AND NOT public.is_global_app_staff()
    AND NOT public.org_access_blocked(om.organization_id)
  UNION
  SELECT u.organization_id
  FROM public.users u
  WHERE u.id = auth.uid()
    AND u.organization_id IS NOT NULL
    AND NOT public.is_global_app_staff()
    AND NOT public.org_access_blocked(u.organization_id)
$$;
REVOKE ALL ON FUNCTION public.current_org_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_org_ids() TO authenticated, service_role;
COMMENT ON FUNCTION public.current_org_ids() IS
  'Orgs the signed-in user works in. Skips suspended orgs and pending sign-up requests (signup admin gate), except for platform / global staff.';

CREATE OR REPLACE FUNCTION public.is_org_nw_admin(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_org_id IS NOT NULL
    AND NOT public.org_access_blocked(p_org_id)
    AND EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND replace(lower(trim(cu.role::text)), '-', '_') = 'nw_admin'
        AND (
          cu.organization_id = p_org_id
          OR EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.user_id = cu.id AND om.organization_id = p_org_id
              AND om.status = 'active' AND om.member_role = 'nw_admin'
          )
        )
    );
$$;
REVOKE ALL ON FUNCTION public.is_org_nw_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_nw_admin(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Sign-up: watch and security company become requests
--
-- 20260818063000 renamed the original apply_signup_profile_for_user(uuid) to
-- apply_signup_profile_for_user_core(uuid) and put a thin wrapper in front.
-- Where that never ran, the single function still holds the logic: do the
-- same rename here (same body, same grants), then (re)create the wrapper.
-- The sign-up trigger and apply_my_signup_profile() call the wrapper by name.
-- ---------------------------------------------------------------------------
DO $prep$
BEGIN
  IF to_regprocedure('public.apply_signup_profile_for_user_core(uuid)') IS NULL
     AND to_regprocedure('public.apply_signup_profile_for_user(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.apply_signup_profile_for_user(uuid)
      RENAME TO apply_signup_profile_for_user_core;
    RAISE NOTICE 'Signup admin gate: moved the sign-up logic to apply_signup_profile_for_user_core(uuid) (as 20260818063000 does).';
  END IF;
END
$prep$;

REVOKE ALL ON FUNCTION public.apply_signup_profile_for_user_core(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_signup_profile_for_user_core(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_signup_profile_for_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  v_track text;
  v_role text;
  v_org uuid;
BEGIN
  result := public.apply_signup_profile_for_user_core(p_user_id);

  -- Next-of-kin relationship (20260818063000), only where that feature exists.
  IF to_regprocedure('public.normalize_emergency_contact_relationship(text)') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'users'
         AND column_name = 'emergency_contact_relationship'
     ) THEN
    EXECUTE $q$
      UPDATE public.users u
      SET emergency_contact_relationship = CASE
        WHEN u.emergency_contact_relationship IS NULL
          OR btrim(u.emergency_contact_relationship) = '' THEN x.rel
        ELSE u.emergency_contact_relationship
      END
      FROM (
        SELECT public.normalize_emergency_contact_relationship(
          au.raw_user_meta_data->>'emergency_contact_relationship'
        ) AS rel
        FROM auth.users au
        WHERE au.id = $1
      ) x
      WHERE u.id = $1 AND x.rel IS NOT NULL
    $q$ USING p_user_id;
  END IF;

  -- Signup admin gate
  v_track := coalesce(result->>'signup_track', '');
  IF coalesce(result->>'applied', '') = 'true'
     AND v_track IN ('neighborhood_watch', 'security_company') THEN
    v_role := CASE WHEN v_track = 'security_company' THEN 'security_admin' ELSE 'nw_admin' END;
    BEGIN
      v_org := nullif(result->>'organization_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_org := NULL;
    END;

    IF v_org IS NOT NULL THEN
      UPDATE public.organization_members
      SET status = 'pending'
      WHERE organization_id = v_org
        AND user_id = p_user_id
        AND member_role = v_role
        AND status = 'active';

      -- A brand-new org (nobody else active in it) waits for review.
      UPDATE public.organizations o
      SET settings_json = coalesce(o.settings_json, '{}'::jsonb) || jsonb_build_object(
        'review_state', 'requested',
        'requested_by', p_user_id,
        'requested_at', now(),
        'requested_role', v_role
      )
      WHERE o.id = v_org
        AND o.status = 'pending'
        AND coalesce(o.settings_json->>'review_state', '') = ''
        AND NOT EXISTS (
          SELECT 1 FROM public.organization_members om
          WHERE om.organization_id = o.id
            AND om.status = 'active'
            AND om.user_id <> p_user_id
        );
    END IF;

    UPDATE public.users
    SET
      role = 'resident',
      organization_id = CASE WHEN organization_id = v_org THEN NULL ELSE organization_id END,
      active_organization_id = CASE WHEN active_organization_id = v_org THEN NULL ELSE active_organization_id END
    WHERE id = p_user_id
      AND public.signup_admin_role_key(role::text) = v_role;

    result := result || jsonb_build_object(
      'role', 'resident',
      'admin_request', CASE WHEN v_org IS NULL THEN 'none' ELSE 'pending' END,
      'requested_role', v_role
    );
  END IF;

  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_signup_profile_for_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_signup_profile_for_user(uuid) TO service_role;
COMMENT ON FUNCTION public.apply_signup_profile_for_user(uuid) IS
  'Applies sign-up details. Watch and security-company sign-ups become admin requests (resident until approved).';

-- ---------------------------------------------------------------------------
-- Activating a pending org any way (console edit, Verify company, RPC)
-- records the review and promotes its requesters.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_org_review_on_activate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'active'
     AND coalesce(NEW.settings_json->>'review_state', '') IN ('requested', '') THEN
    NEW.settings_json := coalesce(NEW.settings_json, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'review_state', 'approved',
      'reviewed_at', now(),
      'reviewed_by', auth.uid()
    ));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_org_review_on_activate() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_org_promote_on_activate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'active' THEN
    PERFORM public.promote_org_requesters(NEW.id, NULL);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_org_promote_on_activate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS organizations_review_on_activate ON public.organizations;
CREATE TRIGGER organizations_review_on_activate
  BEFORE UPDATE OF status ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_org_review_on_activate();

DROP TRIGGER IF EXISTS organizations_promote_on_activate ON public.organizations;
CREATE TRIGGER organizations_promote_on_activate
  AFTER UPDATE OF status ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_org_promote_on_activate();

-- ---------------------------------------------------------------------------
-- Review RPCs: platform staff, global admins and technical support
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_review_organization_requests()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND (public.is_platform_staff() OR public.is_global_app_staff());
$$;
REVOKE ALL ON FUNCTION public.can_review_organization_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_review_organization_requests() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_organization_requests()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.can_review_organization_requests() THEN
    RAISE EXCEPTION 'Only platform staff, admins and technical support can review requests.'
      USING ERRCODE = '42501';
  END IF;

  WITH req AS (
    SELECT o.*, 'new'::text AS kind
    FROM public.organizations o
    WHERE o.status = 'pending'
    UNION ALL
    SELECT o.*, 'join'::text AS kind
    FROM public.organizations o
    WHERE o.status = 'active'
      AND EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id = o.id
          AND om.status = 'pending'
          AND om.member_role IN ('nw_admin', 'security_admin')
      )
  )
  SELECT coalesce(jsonb_agg(item ORDER BY created_at DESC), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT
      r.created_at,
      jsonb_build_object(
        'kind', r.kind,
        'organization_id', r.id,
        'name', r.name,
        'type', r.type,
        'status', r.status,
        'review_state', nullif(r.settings_json->>'review_state', ''),
        'created_at', r.created_at,
        'requested_at', coalesce(nullif(r.settings_json->>'requested_at', ''), r.created_at::text),
        'city', (SELECT c.name FROM public.cities c WHERE c.id = r.city_id),
        'watch_area', nullif(r.settings_json->>'watch_area', ''),
        'coverage_area', coalesce(nullif(r.settings_json->>'coverage_area', ''), nullif(r.settings_json->>'latest_signup_coverage_area', '')),
        'registration', coalesce(nullif(r.settings_json->>'psira_or_registration', ''), nullif(r.settings_json->>'psira_reg', '')),
        'people', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
                   'user_id', u.id,
                   'name', coalesce(nullif(btrim(u.full_name), ''), u.email::text, 'Member'),
                   'email', u.email::text,
                   'phone', u.phone,
                   'member_role', om.member_role,
                   'membership_status', om.status,
                   'since', om.joined_at
                 ) ORDER BY om.joined_at)
          FROM public.organization_members om
          JOIN public.users u ON u.id = om.user_id
          WHERE om.organization_id = r.id
            AND om.member_role IN ('nw_admin', 'security_admin', 'committee')
            AND (om.status = 'pending' OR (r.kind = 'new' AND om.status = 'active'))
        ), '[]'::jsonb)
      ) AS item
    FROM req r
    LIMIT 300
  ) x;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.list_organization_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_organization_requests() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_organization(
  p_org_id uuid,
  p_user_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org record;
  waiting integer;
  promoted integer := 0;
  note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
BEGIN
  IF NOT public.can_review_organization_requests() THEN
    RAISE EXCEPTION 'Only platform staff, admins and technical support can approve requests.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO org FROM public.organizations WHERE id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That organisation no longer exists. Refresh the list.' USING ERRCODE = 'P0002';
  END IF;
  IF org.status = 'suspended' THEN
    RAISE EXCEPTION 'This organisation is suspended. Reactivate it under Organisations first.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO waiting
  FROM public.organization_members om
  WHERE om.organization_id = p_org_id
    AND om.status = 'pending'
    AND om.member_role IN ('nw_admin', 'security_admin')
    AND (p_user_id IS NULL OR om.user_id = p_user_id);

  IF org.status = 'pending' THEN
    UPDATE public.organizations
    SET status = 'active',
        settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'review_state', 'approved',
          'reviewed_at', now(),
          'reviewed_by', auth.uid(),
          'review_note', note
        ))
    WHERE id = p_org_id;
    promoted := waiting;  -- the activate trigger promotes every requester
  ELSE
    IF waiting = 0 THEN
      RAISE EXCEPTION 'There is nothing waiting for approval here. Refresh the list.' USING ERRCODE = '22023';
    END IF;
    promoted := public.promote_org_requesters(p_org_id, p_user_id);
  END IF;

  RETURN jsonb_build_object('organization_id', p_org_id, 'status', 'active', 'promoted', promoted);
END;
$$;
REVOKE ALL ON FUNCTION public.approve_organization(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_organization(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reject_organization(
  p_org_id uuid,
  p_user_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org record;
  r record;
  n integer := 0;
  note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
BEGIN
  IF NOT public.can_review_organization_requests() THEN
    RAISE EXCEPTION 'Only platform staff, admins and technical support can reject requests.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO org FROM public.organizations WHERE id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That organisation no longer exists. Refresh the list.' USING ERRCODE = 'P0002';
  END IF;

  IF p_user_id IS NOT NULL OR org.status = 'active' THEN
    -- One person's admin request into an existing organisation.
    UPDATE public.organization_members
    SET status = 'suspended'
    WHERE organization_id = p_org_id
      AND status = 'pending'
      AND member_role IN ('nw_admin', 'security_admin')
      AND (p_user_id IS NULL OR user_id = p_user_id);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN
      RAISE EXCEPTION 'There is nothing waiting for approval here. Refresh the list.' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('organization_id', p_org_id, 'status', org.status, 'rejected', n);
  END IF;

  IF org.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending requests can be rejected.' USING ERRCODE = '22023';
  END IF;

  -- Whole organisation request: suspend it and free the name for a real group.
  UPDATE public.organizations
  SET status = 'suspended',
      name = left(name, 150) || ' (not approved ' || substr(id::text, 1, 8) || ')',
      settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'review_state', 'rejected',
        'reviewed_at', now(),
        'reviewed_by', auth.uid(),
        'review_note', note,
        'original_name', org.name
      ))
  WHERE id = p_org_id;

  FOR r IN
    SELECT om.user_id, om.member_role
    FROM public.organization_members om
    WHERE om.organization_id = p_org_id
      AND om.status IN ('pending', 'active')
  LOOP
    UPDATE public.organization_members
    SET status = 'suspended'
    WHERE organization_id = p_org_id AND user_id = r.user_id;

    UPDATE public.users u
    SET
      role = CASE
        WHEN r.member_role IN ('nw_admin', 'security_admin')
         AND public.signup_admin_role_key(u.role::text) = r.member_role
         AND NOT EXISTS (
           SELECT 1 FROM public.organization_members om2
           WHERE om2.user_id = u.id
             AND om2.organization_id <> p_org_id
             AND om2.status = 'active'
             AND om2.member_role = r.member_role
             AND NOT public.org_access_blocked(om2.organization_id)
         )
        THEN 'resident'
        ELSE u.role
      END,
      organization_id = CASE WHEN u.organization_id = p_org_id THEN NULL ELSE u.organization_id END,
      active_organization_id = CASE WHEN u.active_organization_id = p_org_id THEN NULL ELSE u.active_organization_id END
    WHERE u.id = r.user_id;
    n := n + 1;
  END LOOP;

  RETURN jsonb_build_object('organization_id', p_org_id, 'status', 'suspended', 'rejected', n);
END;
$$;
REVOKE ALL ON FUNCTION public.reject_organization(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_organization(uuid, uuid, text) TO authenticated, service_role;

-- The requester's own status (for the "being reviewed" banner).
CREATE OR REPLACE FUNCTION public.my_organization_requests()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'organization_id', o.id,
           'name', coalesce(nullif(o.settings_json->>'original_name', ''), o.name),
           'type', o.type,
           'requested_role', om.member_role,
           'state', CASE
             WHEN om.status = 'pending' THEN 'pending'
             ELSE 'not_approved'
           END,
           'requested_at', om.joined_at
         ) ORDER BY om.joined_at DESC), '[]'::jsonb)
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.user_id = auth.uid()
    AND om.member_role IN ('nw_admin', 'security_admin')
    AND (
      om.status = 'pending'
      OR (om.status = 'suspended' AND coalesce(o.settings_json->>'review_state', '') = 'rejected')
    );
$$;
REVOKE ALL ON FUNCTION public.my_organization_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_organization_requests() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- City admin: only organisations in the caller's own city
-- (same columns and ordering as 20260815038000)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.city_admin_communities()
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  organization_type text,
  status text,
  member_count bigint,
  admin_name text,
  admin_email text,
  admin_phone text,
  admin_role text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH viewer AS (
    SELECT
      public.is_global_app_staff() OR public.is_platform_staff() AS sees_all,
      EXISTS (
        SELECT 1 FROM public.users cu
        WHERE cu.id = auth.uid()
          AND replace(lower(trim(cu.role::text)), '-', '_') = 'city_admin'
      ) AS is_city_admin
  ),
  my_cities AS (
    SELECT DISTINCT coalesce(mo.city_id, public.default_city_id()) AS city_id
    FROM public.organizations mo
    WHERE mo.id IN (SELECT public.current_org_ids())
  ),
  allowed_cities AS (
    SELECT city_id FROM my_cities WHERE city_id IS NOT NULL
    UNION
    SELECT public.default_city_id()
    WHERE NOT EXISTS (SELECT 1 FROM my_cities WHERE city_id IS NOT NULL)
  )
  SELECT
    o.id,
    o.name,
    o.type,
    o.status,
    (
      SELECT count(*)
      FROM public.organization_members om
      WHERE om.organization_id = o.id
        AND om.status = 'active'
    ),
    u.full_name,
    u.email::text,
    u.phone,
    u.role::text
  FROM public.organizations o
  CROSS JOIN viewer v
  LEFT JOIN LATERAL (
    SELECT cu.full_name, cu.email, cu.phone, cu.role
    FROM public.organization_members om
    JOIN public.users cu ON cu.id = om.user_id
    WHERE om.organization_id = o.id
      AND om.status = 'active'
      AND lower(trim(om.member_role)) IN ('nw_admin', 'admin', 'committee', 'city_admin')
    ORDER BY
      CASE lower(trim(om.member_role))
        WHEN 'nw_admin' THEN 0
        WHEN 'admin' THEN 1
        WHEN 'city_admin' THEN 2
        ELSE 3
      END,
      cu.full_name
    LIMIT 1
  ) u ON true
  WHERE o.type IN ('nw_group', 'security_company', 'city_admin')
    AND (
      v.sees_all
      OR (
        v.is_city_admin
        AND coalesce(o.city_id, public.default_city_id()) IN (SELECT city_id FROM allowed_cities)
      )
    )
  ORDER BY o.type, lower(o.name);
$$;
REVOKE ALL ON FUNCTION public.city_admin_communities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.city_admin_communities() TO authenticated, service_role;
COMMENT ON FUNCTION public.city_admin_communities() IS
  'City admin briefing: organisations in the caller''s own city only. Platform and global staff see every city.';

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  fn text;
  problems text[] := ARRAY[]::text[];
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.org_access_blocked(uuid)',
    'public.signup_admin_role_key(text)',
    'public.promote_org_requesters(uuid,uuid)',
    'public.can_review_organization_requests()',
    'public.list_organization_requests()',
    'public.approve_organization(uuid,uuid,text)',
    'public.reject_organization(uuid,uuid,text)',
    'public.my_organization_requests()',
    'public.trg_org_review_on_activate()',
    'public.trg_org_promote_on_activate()',
    'public.apply_signup_profile_for_user_core(uuid)',
    'public.apply_signup_profile_for_user(uuid)'
  ] LOOP
    IF to_regprocedure(fn) IS NULL THEN
      problems := problems || (fn || ' missing');
    END IF;
  END LOOP;

  IF cardinality(problems) = 0 THEN
    -- internal helpers are not client-callable
    FOREACH fn IN ARRAY ARRAY[
      'public.org_access_blocked(uuid)', 'public.signup_admin_role_key(text)',
      'public.promote_org_requesters(uuid,uuid)', 'public.apply_signup_profile_for_user(uuid)',
      'public.apply_signup_profile_for_user_core(uuid)'
    ] LOOP
      IF has_function_privilege('authenticated', fn, 'EXECUTE') OR has_function_privilege('anon', fn, 'EXECUTE') THEN
        problems := problems || (fn || ' is callable by clients');
      END IF;
    END LOOP;
    -- review RPCs: signed-in only (gated inside), never anon
    FOREACH fn IN ARRAY ARRAY[
      'public.list_organization_requests()', 'public.approve_organization(uuid,uuid,text)',
      'public.reject_organization(uuid,uuid,text)', 'public.my_organization_requests()',
      'public.city_admin_communities()', 'public.current_org_ids()'
    ] LOOP
      IF has_function_privilege('anon', fn, 'EXECUTE') THEN
        problems := problems || (fn || ' is callable by anon');
      END IF;
      IF NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN
        problems := problems || (fn || ' not granted to authenticated');
      END IF;
    END LOOP;

    IF position('org_access_blocked' IN pg_get_functiondef('public.current_org_ids()'::regprocedure)) = 0 THEN
      problems := problems || 'current_org_ids does not skip blocked orgs'::text;
    END IF;
    IF position('org_access_blocked' IN pg_get_functiondef('public.is_org_nw_admin(uuid)'::regprocedure)) = 0 THEN
      problems := problems || 'is_org_nw_admin does not skip blocked orgs'::text;
    END IF;
    IF position('admin_request' IN pg_get_functiondef('public.apply_signup_profile_for_user(uuid)'::regprocedure)) = 0 THEN
      problems := problems || 'sign-up gate missing from apply_signup_profile_for_user'::text;
    END IF;
    IF position('allowed_cities' IN pg_get_functiondef('public.city_admin_communities()'::regprocedure)) = 0 THEN
      problems := problems || 'city_admin_communities is not city-scoped'::text;
    END IF;
    IF position('can_review_organization_requests' IN pg_get_functiondef('public.approve_organization(uuid,uuid,text)'::regprocedure)) = 0 THEN
      problems := problems || 'approve_organization is not gated'::text;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'organizations_review_on_activate' AND tgrelid = 'public.organizations'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'organizations_promote_on_activate' AND tgrelid = 'public.organizations'::regclass) THEN
    problems := problems || 'activation triggers missing'::text;
  END IF;

  IF public.signup_admin_role_key(' NW-Admin ') <> 'nw_admin' THEN
    problems := problems || 'signup_admin_role_key sanity'::text;
  END IF;

  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION 'Signup admin gate: verification failed: %', array_to_string(problems, '; ');
  END IF;

  RAISE NOTICE 'Signup admin gate: OK';
END
$verify$;
