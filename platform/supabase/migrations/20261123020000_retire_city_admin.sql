-- Retire the city_admin role (R1-R4).
--
-- Live count on 23 Nov 2026: 0 users with role city_admin, no city_admin
-- memberships or organisations, 0 City Hub posts by city_admin organisations.
-- Nothing needs moving. This file:
--   * stops new city_admin assignments: admin_set_user_role no longer accepts
--     it, and a trigger refuses it on users.role, organization_members.member_role
--     and organizations.type (for everyone, including global staff);
--   * re-creates every function and policy that granted city_admin anything,
--     from its latest migration, with city_admin removed and nothing else changed;
--   * moves the "community admin contacts" list to platform and global staff only
--     (new list_community_admin_contacts(); city_admin_communities() stays as a
--     thin alias so older app builds keep working).
-- CHECK constraints still list city_admin; they are tightened later (R5).
-- Additive and safe to run more than once. Nothing changes unless the pre-check passes.

-- ---------------------------------------------------------------------------
-- Pre-check: list everything missing at once.
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE
  missing text[] := ARRAY[]::text[];
  r record;
  found text;
  fn text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public', 'users', 'role'), ('public', 'users', 'platform_role'), ('public', 'users', 'organization_id'),
      ('public', 'organization_members', 'member_role'), ('public', 'organizations', 'type'),
      ('public', 'city_hub_posts', 'author_organization_id')
    ) AS t(s, tbl, col)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = r.s AND c.table_name = r.tbl AND c.column_name = r.col
    ) THEN
      missing := missing || format('%s.%s column', r.tbl, r.col);
    END IF;
  END LOOP;

  -- Functions this file replaces: exact signature (CREATE OR REPLACE needs it).
  FOR r IN
    SELECT * FROM (VALUES
      ('public.admin_set_user_role(uuid,text)'),
      ('public.apply_my_signup_profile()'),
      ('public.assign_resident_to_neighborhood(uuid,uuid)'),
      ('public.camera_spot_readable(uuid)'),
      ('public.can_moderate_incidents()'),
      ('public.can_moderate_resident_content(uuid)'),
      ('public.can_view_city_hub()'),
      ('public.can_view_criminal_intelligence()'),
      ('public.is_chat_ops_member()'),
      ('public.is_hotspot_staff()'),
      ('public.is_sos_responder()'),
      ('public.is_staff_role(text)'),
      ('public.list_watch_staff_activity(integer,text,boolean)'),
      ('public.publish_incident_to_city_hub(uuid,text,text,text,uuid)'),
      ('public.report_community_content(text,uuid,text,text)'),
      ('public.storage_city_hub_object_readable(text)'),
      ('public.trg_apply_signup_profile()'),
      ('public.trg_users_privilege_guard()'),
      ('public.city_admin_communities()')
    ) AS t(sig)
  LOOP
    IF to_regprocedure(r.sig) IS NULL THEN
      SELECT string_agg(format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)), ', ')
        INTO found
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = split_part(replace(r.sig, 'public.', ''), '(', 1);
      missing := missing || (replace(r.sig, 'public.', '') || ' function'
        || CASE WHEN found IS NULL THEN '' ELSE format(' (found %s instead)', found) END);
    END IF;
  END LOOP;

  -- Helpers the new bodies call: matched by name.
  FOREACH fn IN ARRAY ARRAY['is_global_app_staff', 'is_platform_staff', 'normalized_app_role', 'current_org_ids', 'working_organization_id', 'has_org_capability', 'security_partner_assigned_org_ids', 'can_manage_city_hub_post', 'can_view_city_hub_suspect_alert', 'try_uuid', 'default_city_id', 'is_area_broadcast_staff', 'is_org_nw_admin', 'users_guard_self_in_org', 'apply_signup_profile_for_user'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    ) THEN
      missing := missing || (fn || '() function');
    END IF;
  END LOOP;
  IF to_regprocedure('storage.foldername(text)') IS NULL THEN
    missing := missing || 'storage.foldername(text) function'::text;
  END IF;

  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'Retire city admin: not applied, missing %. Nothing was changed.',
      array_to_string(missing, ', ');
  END IF;
END
$pre$;

-- Heads-up: functions whose live body did not mention city_admin before this run
-- (already retired on a re-run, or edited outside migrations). They are still
-- replaced with the latest migration version.
DO $heads$
DECLARE
  drift text;
BEGIN
  SELECT string_agg(s, ', ') INTO drift
  FROM unnest(ARRAY['public.admin_set_user_role(uuid,text)', 'public.apply_my_signup_profile()', 'public.assign_resident_to_neighborhood(uuid,uuid)', 'public.camera_spot_readable(uuid)', 'public.can_moderate_incidents()', 'public.can_moderate_resident_content(uuid)', 'public.can_view_city_hub()', 'public.can_view_criminal_intelligence()', 'public.is_chat_ops_member()', 'public.is_hotspot_staff()', 'public.is_sos_responder()', 'public.is_staff_role(text)', 'public.list_watch_staff_activity(integer,text,boolean)', 'public.publish_incident_to_city_hub(uuid,text,text,text,uuid)', 'public.report_community_content(text,uuid,text,text)', 'public.storage_city_hub_object_readable(text)', 'public.trg_apply_signup_profile()', 'public.trg_users_privilege_guard()']) AS s
  WHERE to_regprocedure(s) IS NOT NULL
    AND position('city_admin' IN pg_get_functiondef(to_regprocedure(s))) = 0;
  RAISE NOTICE 'Heads-up: functions without city_admin before this run (re-run or edited outside migrations): %',
    coalesce(drift, 'none');
END
$heads$;

-- ---------------------------------------------------------------------------
-- R1: stop new assignments
-- ---------------------------------------------------------------------------
-- The only function body allowed to name the retired role; it exists to refuse it.
CREATE OR REPLACE FUNCTION public.refuse_retired_city_admin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_new text;
  v_old text;
BEGIN
  IF TG_TABLE_NAME = 'users' THEN
    v_new := NEW.role::text;
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN OLD.role::text END;
  ELSIF TG_TABLE_NAME = 'organization_members' THEN
    v_new := NEW.member_role;
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN OLD.member_role END;
  ELSE
    v_new := NEW.type;
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN OLD.type END;
  END IF;
  v_new := replace(lower(trim(coalesce(v_new, ''))), '-', '_');
  v_old := replace(lower(trim(coalesce(v_old, ''))), '-', '_');
  IF v_new = 'city_admin' AND v_old IS DISTINCT FROM 'city_admin' THEN
    RAISE EXCEPTION 'The city admin role has been retired. Choose another role.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.refuse_retired_city_admin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS users_refuse_retired_city_admin ON public.users;
CREATE TRIGGER users_refuse_retired_city_admin
  BEFORE INSERT OR UPDATE OF role ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.refuse_retired_city_admin();

DROP TRIGGER IF EXISTS organization_members_refuse_retired_city_admin ON public.organization_members;
CREATE TRIGGER organization_members_refuse_retired_city_admin
  BEFORE INSERT OR UPDATE OF member_role ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.refuse_retired_city_admin();

DROP TRIGGER IF EXISTS organizations_refuse_retired_city_admin ON public.organizations;
CREATE TRIGGER organizations_refuse_retired_city_admin
  BEFORE INSERT OR UPDATE OF type ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.refuse_retired_city_admin();

-- ---------------------------------------------------------------------------
-- R3: functions and policies without city_admin (latest definitions)
-- ---------------------------------------------------------------------------
-- admin_set_user_role: latest definition from 20261031040000_admin_set_user_role.sql, city_admin removed.
CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_user_id uuid, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  is_global boolean;
  new_role text := replace(lower(trim(coalesce(p_role, ''))), '-', '_');
  old_role text;
  saved_role text;
  target_org uuid;
  in_scope boolean;
  n int;
  member_role_out text;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user is required';
  END IF;
  IF new_role NOT IN ('resident', 'volunteer', 'patroller', 'investigator',
                      'nw_admin', 'committee', 'security_admin',
                      'admin', 'technical_support') THEN
    RAISE EXCEPTION 'unknown role: %', p_role;
  END IF;

  is_global := public.is_global_app_staff() OR public.is_platform_staff();

  IF NOT is_global AND NOT public.is_area_broadcast_staff() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_user_id = caller THEN
    RAISE EXCEPTION 'you cannot change your own role here';
  END IF;

  SELECT replace(lower(trim(u.role::text)), '-', '_'), u.organization_id
    INTO old_role, target_org
  FROM public.users u
  WHERE u.id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not found';
  END IF;

  -- Local staff: the target must be in one of the caller's neighbourhoods.
  -- Another neighbourhood must look the same as a missing user.
  IF NOT is_global THEN
    IF target_org IS NOT NULL THEN
      in_scope := target_org IN (SELECT public.current_org_ids());
    ELSE
      in_scope := EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.user_id = p_user_id AND om.status = 'active'
          AND om.organization_id IN (SELECT public.current_org_ids())
      );
    END IF;
    IF NOT coalesce(in_scope, false) THEN
      RAISE EXCEPTION 'not found';
    END IF;
  END IF;

  IF new_role IN ('admin', 'technical_support') THEN
    RAISE EXCEPTION 'main admin and technical support are global and cannot be assigned here';
  END IF;
  IF old_role IN ('admin', 'technical_support') AND NOT is_global THEN
    RAISE EXCEPTION 'only platform staff can make that change';
  END IF;
  IF new_role IN ('security_admin') AND NOT is_global THEN
    RAISE EXCEPTION 'only platform staff can make that change';
  END IF;
  IF new_role = 'nw_admin' AND NOT is_global
     AND NOT public.is_org_nw_admin(target_org) THEN
    RAISE EXCEPTION 'only an NW admin can appoint another NW admin';
  END IF;

  IF old_role IS NOT DISTINCT FROM new_role THEN
    RETURN jsonb_build_object('id', p_user_id, 'role', new_role,
      'previous_role', old_role, 'organization_id', target_org, 'changed', false);
  END IF;

  EXECUTE 'UPDATE public.users SET role = $1 WHERE id = $2' USING new_role, p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RAISE EXCEPTION 'role not saved (0 rows updated)';
  END IF;

  SELECT replace(lower(trim(u.role::text)), '-', '_') INTO saved_role
  FROM public.users u WHERE u.id = p_user_id;
  IF saved_role IS DISTINCT FROM new_role THEN
    RAISE EXCEPTION 'role not saved (a trigger kept %)', saved_role;
  END IF;

  -- Same mapping as assign_resident_to_neighborhood.
  member_role_out := CASE new_role
    WHEN 'nw_admin' THEN 'nw_admin'
    WHEN 'committee' THEN 'committee'
    WHEN 'security_admin' THEN 'security_admin'
    WHEN 'patroller' THEN 'patroller'
    WHEN 'volunteer' THEN 'patroller'
    WHEN 'investigator' THEN 'patroller'
    ELSE 'resident'
  END;

  UPDATE public.organization_members om
  SET member_role = member_role_out
  FROM public.organizations o
  WHERE om.user_id = p_user_id
    AND om.organization_id = o.id
    AND o.type = 'nw_group'
    AND om.member_role IS DISTINCT FROM member_role_out;

  RETURN jsonb_build_object('id', p_user_id, 'role', new_role,
    'previous_role', old_role, 'organization_id', target_org,
    'member_role', member_role_out, 'changed', true);
END;
$$;

-- apply_my_signup_profile: latest definition from 20260815033000_preserve_privileged_roles_on_signup.sql, city_admin removed.
CREATE OR REPLACE FUNCTION public.apply_my_signup_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_authenticated');
  END IF;

  SELECT lower(trim(coalesce(role::text, '')))
    INTO existing_role
  FROM public.users
  WHERE id = auth.uid();

  IF existing_role IN (
    'admin',
    'technical_support',
    'committee',
    'investigator',
    'nw_admin',
    'security_admin'
  ) THEN
    UPDATE public.users
    SET signup_track = coalesce(nullif(btrim(coalesce(signup_track, '')), ''), 'invite')
    WHERE id = auth.uid()
      AND (signup_track IS NULL OR btrim(signup_track) = '');
    RETURN jsonb_build_object(
      'applied', false,
      'reason', 'privileged_role_preserved',
      'role', existing_role
    );
  END IF;

  RETURN public.apply_signup_profile_for_user(auth.uid());
END;
$$;

-- assign_resident_to_neighborhood: latest definition from 20260819031000_move_member_to_neighborhood.sql, city_admin removed.
CREATE OR REPLACE FUNCTION public.assign_resident_to_neighborhood(
  p_resident_user_id uuid,
  p_organization_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id uuid;
  suburb_id uuid;
  org_name text;
  target_role text;
  member_role_out text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT (
    public.is_resident_staff_verifier()
    OR public.is_global_app_staff()
    OR public.is_platform_staff()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_resident_user_id IS NULL THEN
    RAISE EXCEPTION 'Resident is required';
  END IF;

  org_id := COALESCE(p_organization_id, public.working_organization_id());
  IF org_id IS NULL THEN
    RAISE EXCEPTION 'Select a neighborhood first';
  END IF;

  SELECT o.id, o.primary_suburb_id, o.name
    INTO org_id, suburb_id, org_name
  FROM public.organizations o
  WHERE o.id = org_id
    AND o.type = 'nw_group'
    AND o.status IS DISTINCT FROM 'suspended';

  IF org_id IS NULL THEN
    RAISE EXCEPTION 'Neighborhood not found';
  END IF;

  IF NOT public.is_global_app_staff() AND NOT public.is_platform_staff() THEN
    IF org_id NOT IN (SELECT public.current_org_ids()) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;

  SELECT replace(lower(trim(u.role::text)), '-', '_')
    INTO target_role
  FROM public.users u
  WHERE u.id = p_resident_user_id;

  IF target_role IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF target_role IN ('admin', 'technical_support') THEN
    RAISE EXCEPTION 'Global accounts cannot be assigned here';
  END IF;

  member_role_out := CASE target_role
    WHEN 'nw_admin' THEN 'nw_admin'
    WHEN 'committee' THEN 'committee'
    WHEN 'security_admin' THEN 'security_admin'
    WHEN 'patroller' THEN 'patroller'
    WHEN 'volunteer' THEN 'patroller'
    WHEN 'investigator' THEN 'patroller'
    ELSE 'resident'
  END;

  DELETE FROM public.organization_members om
  USING public.organizations o
  WHERE om.user_id = p_resident_user_id
    AND om.organization_id = o.id
    AND o.type = 'nw_group'
    AND om.organization_id IS DISTINCT FROM org_id;

  INSERT INTO public.organization_members (
    organization_id,
    user_id,
    member_role,
    status
  )
  VALUES (org_id, p_resident_user_id, member_role_out, 'active')
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET status = 'active',
        member_role = EXCLUDED.member_role;

  UPDATE public.users
  SET
    organization_id = org_id,
    active_organization_id = org_id,
    home_suburb_id = COALESCE(suburb_id, home_suburb_id)
  WHERE id = p_resident_user_id;

  INSERT INTO public.resident_profiles (user_id, updated_at)
  VALUES (p_resident_user_id, now())
  ON CONFLICT (user_id) DO UPDATE
    SET updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'organization_id', org_id,
    'organization_name', org_name,
    'home_suburb_id', suburb_id,
    'member_role', member_role_out
  );
END;
$$;

-- camera_spot_readable: latest definition from 20261107010000_camera_spots_own_area.sql, city_admin removed.
CREATE OR REPLACE FUNCTION public.camera_spot_readable(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_global_app_staff()
    OR public.is_platform_staff()
    OR (p_org IS NOT NULL AND p_org IN (SELECT public.current_org_ids()))
    OR (p_org IS NOT NULL AND p_org IN (SELECT public.security_partner_assigned_org_ids()));
$$;

-- can_moderate_incidents: latest definition from 20260820060000_org_isolation_hardening.sql, city_admin removed.
CREATE OR REPLACE FUNCTION public.can_moderate_incidents()
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
        AND replace(lower(trim(cu.role::text)), '-', '_') IN (
          'admin',
          'technical_support',
          'nw_admin',
          'committee'
        )
    );
$$;

-- can_moderate_resident_content: latest definition from 20261031020000_community_content_reports.sql, city_admin removed.
CREATE OR REPLACE FUNCTION public.can_moderate_resident_content(p_org_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    COALESCE(p_org_id, public.working_organization_id()) IN (SELECT public.current_org_ids())
    AND (
      public.can_moderate_incidents()   -- admin, tech, nw_admin, committee + platform
      OR public.has_org_capability('resident_moderator', COALESCE(p_org_id, public.working_organization_id()))
    ),
    false
  );
$$;

-- can_view_city_hub: latest definition from 20260815037000_city_hub_authors_for_watch_roles.sql, city_admin removed.
CREATE OR REPLACE FUNCTION public.can_view_city_hub()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    public.is_global_app_staff()
    OR public.is_platform_staff()
    OR EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND replace(lower(trim(coalesce(cu.role::text, ''))), '-', '_') IN (
          'volunteer',
          'patroller',
          'investigator',
          'committee',
          'nw_admin',
          'admin',
          'technical_support',
          'security_admin'
        )
    );
$$;

-- can_view_criminal_intelligence: latest definition from 20261021005000_criminal_photos_storage_lockdown.sql, city_admin removed.
CREATE OR REPLACE FUNCTION public.can_view_criminal_intelligence()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_global_app_staff()
      OR EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = auth.uid()
          AND public.normalized_app_role(u.role::text) IN (
            'volunteer',
            'patroller',
            'investigator',
            'committee',
            'nw_admin',
            'admin',
            'technical_support',
            'security_admin'
          )
      );
$$;

-- is_chat_ops_member: latest definition from 20260815053000_chat_visibility_channels.sql, city_admin removed.
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
          'security_admin'
        )
    );
$$;

-- is_hotspot_staff: latest definition from 20260815038000_partner_city_dashboards.sql, city_admin removed.
CREATE OR REPLACE FUNCTION public.is_hotspot_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND replace(lower(trim(u.role::text)), '-', '_') IN (
        'admin',
        'committee',
        'technical_support',
        'nw_admin',
        'security_admin'
      )
  )
  OR public.is_global_app_staff()
  OR public.is_platform_staff();
$$;

-- is_sos_responder: latest definition from 20260815045000_sos_active_means_unresolved.sql, city_admin removed.
CREATE OR REPLACE FUNCTION public.is_sos_responder()
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
        AND replace(lower(trim(cu.role::text)), '-', '_') IN (
          'admin',
          'technical_support',
          'nw_admin',
          'committee',
          'patroller',
          'volunteer',
          'investigator',
          'security_admin'
        )
    );
$$;

-- is_staff_role: latest definition from 20260815010000_scale_multitenant_foundation.sql, city_admin removed.
CREATE OR REPLACE FUNCTION public.is_staff_role(p_role text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(coalesce(p_role, ''))) IN ('admin', 'committee', 'technical_support', 'nw_admin', 'security_admin');
$$;

-- list_watch_staff_activity: latest definition from 20261003002000_audit_log_hardening.sql, city_admin removed.
CREATE OR REPLACE FUNCTION public.list_watch_staff_activity(
  p_limit integer DEFAULT 150,
  p_role text DEFAULT NULL,
  p_all_areas boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  action text,
  details_json jsonb,
  organization_id uuid,
  organization_name text,
  actor_user_id uuid,
  actor_name text,
  actor_email text,
  actor_role text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  role_filter text;
  lim integer;
  all_areas boolean := coalesce(p_all_areas, false);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.is_global_app_staff() OR public.is_platform_staff()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  role_filter := replace(lower(trim(coalesce(p_role, ''))), '-', '_');
  IF role_filter NOT IN (
    'nw_admin', 'committee', 'volunteer', 'patroller', 'investigator',
    'admin', 'technical_support', 'security_admin'
  ) THEN
    role_filter := NULL;
  END IF;
  lim := GREATEST(1, LEAST(coalesce(p_limit, 150), 400));

  RETURN QUERY
  SELECT
    al.id,
    al.created_at,
    al.action,
    al.details_json,
    al.organization_id,
    o.name,
    al.user_id,
    coalesce(nullif(trim(al.details_json->>'actor_name'), ''), nullif(trim(u.full_name), ''), u.email),
    u.email,
    coalesce(
      nullif(trim(al.details_json->>'actor_role'), ''),
      replace(lower(trim(u.role::text)), '-', '_')
    )
  FROM public.activity_logs al
  LEFT JOIN public.users u ON u.id = al.user_id
  LEFT JOIN public.organizations o ON o.id = al.organization_id
  WHERE (
      coalesce(
        nullif(trim(al.details_json->>'actor_role'), ''),
        replace(lower(trim(u.role::text)), '-', '_')
      ) IN (
        'nw_admin', 'committee', 'volunteer', 'patroller', 'investigator',
        'admin', 'technical_support', 'security_admin'
      )
      OR replace(lower(trim(coalesce(al.details_json->>'subject_role', ''))), '-', '_') IN (
        'nw_admin', 'committee', 'volunteer', 'patroller', 'investigator',
        'admin', 'technical_support', 'security_admin'
      )
      OR nullif(trim(al.details_json->>'capability'), '') IS NOT NULL
    )
    AND (
      role_filter IS NULL
      OR coalesce(
        nullif(trim(al.details_json->>'actor_role'), ''),
        replace(lower(trim(u.role::text)), '-', '_'),
        al.details_json->>'subject_role'
      ) = role_filter
    )
    AND (
      all_areas
      OR al.organization_id IN (SELECT public.current_org_ids())
    )
  ORDER BY al.created_at DESC
  LIMIT lim;
END $$;

-- publish_incident_to_city_hub: latest definition from 20260815032000_city_hub_post_manage.sql, city_admin removed.
CREATE OR REPLACE FUNCTION public.publish_incident_to_city_hub(
  p_incident_id uuid,
  p_type text,
  p_title text,
  p_content text,
  p_related_profile_id uuid DEFAULT NULL
)
RETURNS public.city_hub_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  incident_row public.incidents;
  author_org uuid;
  post_row public.city_hub_posts;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users cu
    WHERE cu.id = uid
      AND (
        public.is_global_app_staff()
        OR lower(trim(coalesce(cu.role::text, ''))) IN (
          'admin',
          'technical_support',
          'nw_admin',
          'security_admin'
        )
      )
  ) THEN
    RAISE EXCEPTION 'forbidden: city hub publish role required';
  END IF;

  SELECT * INTO incident_row
  FROM public.incidents
  WHERE id = p_incident_id;

  IF incident_row.id IS NULL THEN
    RAISE EXCEPTION 'incident not found';
  END IF;

  IF incident_row.status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'only approved incidents can be shared';
  END IF;

  author_org := COALESCE(incident_row.organization_id, public.working_organization_id());
  IF author_org IS NULL THEN
    RAISE EXCEPTION 'incident has no organization to attribute this post to';
  END IF;

  IF NOT public.is_global_app_staff() THEN
    IF author_org NOT IN (SELECT public.current_org_ids()) THEN
      RAISE EXCEPTION 'forbidden: incident is outside your organization';
    END IF;
  ELSIF public.working_organization_id() IS NOT NULL
    AND incident_row.organization_id IS NOT NULL
    AND incident_row.organization_id IS DISTINCT FROM public.working_organization_id() THEN
    RAISE EXCEPTION 'switch to this neighborhood before sharing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.city_hub_posts
    WHERE related_incident_id = p_incident_id
      AND status = 'published'
  ) THEN
    RAISE EXCEPTION 'CITY_HUB_ALREADY_SHARED';
  END IF;

  INSERT INTO public.city_hub_posts (
    author_organization_id,
    type,
    title,
    content,
    visibility,
    status,
    created_by_user_id,
    related_incident_id,
    related_suspect_profile_id
  ) VALUES (
    author_org,
    p_type,
    p_title,
    p_content,
    'city_wide',
    'published',
    uid,
    p_incident_id,
    p_related_profile_id
  )
  RETURNING * INTO post_row;

  UPDATE public.incidents
  SET
    city_hub_post_id = post_row.id,
    city_hub_shared_at = now()
  WHERE id = p_incident_id;

  RETURN post_row;
END;
$$;

-- report_community_content: latest definition from 20261118010000_ugc_reports_incidents_suspects.sql, city_admin removed.
CREATE OR REPLACE FUNCTION public.report_community_content(
  p_content_type text,
  p_content_id uuid,
  p_reason text,
  p_details text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id uuid;
  new_id uuid;
  mod_id uuid;
  post_row public.city_hub_posts;
  msg_row public.chat_messages;
  item_id uuid;
  item_owner_a text;
  item_owner_b text;
  notify_label text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_content_type IS NULL OR p_content_type NOT IN (
    'area_broadcast', 'service_listing', 'service_review',
    'city_hub_post', 'chat_message', 'user_profile',
    'incident_report', 'criminal_profile'
  ) THEN
    RAISE EXCEPTION 'this content cannot be reported yet';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN (
    'spam', 'scam', 'offensive', 'false_info', 'privacy', 'duplicate', 'other'
  ) THEN
    RAISE EXCEPTION 'please choose a reason';
  END IF;
  IF p_details IS NOT NULL AND char_length(p_details) > 1000 THEN
    RAISE EXCEPTION 'details are too long (max 1000 characters)';
  END IF;

  org_id := CASE p_content_type
    WHEN 'area_broadcast' THEN (
      SELECT b.organization_id FROM public.area_broadcasts b WHERE b.id = p_content_id
    )
    WHEN 'service_listing' THEN (
      SELECT l.organization_id FROM public.local_service_listings l WHERE l.id = p_content_id
    )
    WHEN 'service_review' THEN (
      SELECT r.organization_id FROM public.local_service_reviews r WHERE r.id = p_content_id
    )
    WHEN 'city_hub_post' THEN (
      SELECT p.author_organization_id FROM public.city_hub_posts p WHERE p.id = p_content_id
    )
    WHEN 'chat_message' THEN (
      SELECT m.organization_id FROM public.chat_messages m WHERE m.id = p_content_id
    )
    WHEN 'user_profile' THEN (
      SELECT u.organization_id
      FROM public.users u
      WHERE u.id = p_content_id
    )
    WHEN 'incident_report' THEN (
      SELECT i.organization_id FROM public.incidents i WHERE i.id = p_content_id
    )
    WHEN 'criminal_profile' THEN (
      SELECT cp.organization_id FROM public.criminal_profiles cp WHERE cp.id = p_content_id
    )
    ELSE NULL
  END;

  IF p_content_type = 'city_hub_post' THEN
    SELECT * INTO post_row FROM public.city_hub_posts WHERE id = p_content_id;
    IF post_row.id IS NULL OR post_row.status <> 'published' OR NOT public.can_view_city_hub() THEN
      RAISE EXCEPTION 'content not found';
    END IF;
    IF post_row.hidden_at IS NOT NULL
       AND NOT public.can_moderate_resident_content(post_row.author_organization_id) THEN
      RAISE EXCEPTION 'content not found';
    END IF;
    IF post_row.created_by_user_id = auth.uid() THEN
      RAISE EXCEPTION 'you cannot report your own content';
    END IF;
  ELSIF p_content_type = 'chat_message' THEN
    IF org_id IS NULL THEN
      RAISE EXCEPTION 'content not found';
    END IF;
    SELECT * INTO msg_row FROM public.chat_messages WHERE id = p_content_id;
    IF msg_row.id IS NULL
       OR msg_row.organization_id NOT IN (SELECT public.current_org_ids())
       OR (msg_row.visibility = 'patrol' AND NOT public.is_chat_ops_member()) THEN
      RAISE EXCEPTION 'content not found';
    END IF;
    IF msg_row.sender_id = auth.uid() THEN
      RAISE EXCEPTION 'you cannot report your own content';
    END IF;
  ELSIF p_content_type = 'user_profile' THEN
    IF p_content_id = auth.uid() THEN
      RAISE EXCEPTION 'you cannot report your own content';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_content_id) THEN
      RAISE EXCEPTION 'content not found';
    END IF;
    IF org_id IS NOT NULL AND org_id IN (SELECT public.current_org_ids()) THEN
      NULL;
    ELSIF public.can_view_city_hub()
       AND EXISTS (
         SELECT 1
         FROM public.city_hub_posts p
         WHERE p.created_by_user_id = p_content_id
           AND p.status = 'published'
           AND p.hidden_at IS NULL
       ) THEN
      IF org_id IS NULL THEN
        SELECT p.author_organization_id
          INTO org_id
          FROM public.city_hub_posts p
         WHERE p.created_by_user_id = p_content_id
           AND p.status = 'published'
           AND p.hidden_at IS NULL
         ORDER BY p.created_at DESC
         LIMIT 1;
      END IF;
    ELSE
      RAISE EXCEPTION 'content not found';
    END IF;
    IF org_id IS NULL THEN
      RAISE EXCEPTION 'content not found';
    END IF;
  ELSIF p_content_type = 'incident_report' THEN
    -- Same visibility as incidents_select_org: a member of the incident's watch.
    -- (incidents_select_own also lets the submitter read it, but they cannot report their own.)
    SELECT i.id, i.submitted_by::text, i.reporter_id::text
      INTO item_id, item_owner_a, item_owner_b
      FROM public.incidents i
     WHERE i.id = p_content_id;
    IF item_id IS NULL
       OR org_id IS NULL
       OR org_id NOT IN (SELECT public.current_org_ids()) THEN
      RAISE EXCEPTION 'content not found';
    END IF;
    IF item_owner_a = auth.uid()::text OR item_owner_b = auth.uid()::text THEN
      RAISE EXCEPTION 'you cannot report your own content';
    END IF;
  ELSIF p_content_type = 'criminal_profile' THEN
    -- Same visibility as criminal_profiles_select_org (20261117020000):
    -- same watch AND an intelligence role. Residents get 'not found'.
    SELECT cp.id, cp.created_by::text
      INTO item_id, item_owner_a
      FROM public.criminal_profiles cp
     WHERE cp.id = p_content_id;
    IF item_id IS NULL
       OR org_id IS NULL
       OR org_id NOT IN (SELECT public.current_org_ids())
       OR NOT public.can_view_criminal_intelligence() THEN
      RAISE EXCEPTION 'content not found';
    END IF;
    IF item_owner_a = auth.uid()::text THEN
      RAISE EXCEPTION 'you cannot report your own content';
    END IF;
  ELSIF org_id IS NULL OR org_id NOT IN (SELECT public.current_org_ids()) THEN
    -- Existing adjacent-org exception for local services. Cross-org failure is 'not found'.
    IF p_content_type = 'service_listing'
       AND public.can_access_service_listing(p_content_id) THEN
      NULL;
    ELSIF p_content_type = 'service_review' AND EXISTS (
      SELECT 1
      FROM public.local_service_reviews r
      WHERE r.id = p_content_id
        AND public.can_access_service_listing(r.listing_id)
    ) THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'content not found';
    END IF;
  END IF;

  IF (
    SELECT count(*) FROM public.community_content_reports r
    WHERE r.reporter_user_id = auth.uid() AND r.created_at > now() - interval '24 hours'
  ) >= 10 THEN
    RAISE EXCEPTION 'too many reports today';
  END IF;

  INSERT INTO public.community_content_reports (
    organization_id, content_type, content_id, reporter_user_id, reason, details
  )
  VALUES (org_id, p_content_type, p_content_id, auth.uid(), p_reason, nullif(trim(p_details), ''))
  ON CONFLICT DO NOTHING
  RETURNING id INTO new_id;

  IF new_id IS NULL THEN
    RAISE EXCEPTION 'you have already reported this';
  END IF;

  notify_label := CASE p_content_type
    WHEN 'criminal_profile' THEN 'suspect profile'
    ELSE replace(p_content_type, '_', ' ')
  END;

  FOR mod_id IN
    SELECT DISTINCT g.user_id FROM public.org_capability_grants g
    WHERE g.organization_id = org_id
      AND g.capability = 'resident_moderator'
      AND g.revoked_at IS NULL
      AND (g.expires_at IS NULL OR g.expires_at > now())
      AND g.user_id <> auth.uid()
      -- Suspect-profile reports only go to moderators who may read suspect profiles.
      AND (
        p_content_type <> 'criminal_profile'
        OR EXISTS (
          SELECT 1 FROM public.users mu
          WHERE mu.id = g.user_id
            AND public.normalized_app_role(mu.role::text) IN (
              'volunteer', 'patroller', 'investigator', 'committee', 'nw_admin',
              'admin', 'technical_support', 'security_admin'
            )
        )
      )
  LOOP
    PERFORM public.notify_app_user(
      mod_id, 'moderation', 'New report to review',
      notify_label || ' - ' || replace(p_reason, '_', ' '),
      '/resident/moderate'
    );
  END LOOP;

  RETURN new_id;
END;
$$;

-- storage_city_hub_object_readable: latest definition from 20261117040000_city_hub_photos_role_lock.sql, city_admin removed.
CREATE OR REPLACE FUNCTION public.storage_city_hub_object_readable(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND lower(trim(coalesce(cu.role::text, ''))) IN (
          'volunteer',
          'patroller',
          'investigator',
          'committee',
          'nw_admin',
          'admin',
          'technical_support',
          'security_admin'
        )
    )
    AND EXISTS (
      SELECT 1
      FROM public.city_hub_posts p
      WHERE p.id = public.try_uuid((storage.foldername(p_name))[1])
        AND (
          p.status = 'published'
          OR p.author_organization_id IN (SELECT public.current_org_ids())
        )
        AND (
          p.hidden_at IS NULL
          OR public.can_moderate_resident_content(p.author_organization_id)
          OR public.can_manage_city_hub_post(p.created_by_user_id)
        )
        AND (
          p.type IS DISTINCT FROM 'suspect_alert'
          OR public.can_view_city_hub_suspect_alert(p.author_organization_id, p.city_id)
        )
    );
$$;

-- trg_apply_signup_profile: latest definition from 20260815040000_fix_resident_signup_auth_error.sql, city_admin removed.
CREATE OR REPLACE FUNCTION public.trg_apply_signup_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_role text;
BEGIN
  existing_role := lower(trim(coalesce(NEW.role::text, '')));
  IF existing_role IN (
    'admin',
    'technical_support',
    'committee',
    'investigator',
    'nw_admin',
    'security_admin'
  ) THEN
    UPDATE public.users
    SET signup_track = coalesce(nullif(btrim(coalesce(signup_track, '')), ''), 'invite')
    WHERE id = NEW.id
      AND (signup_track IS NULL OR btrim(signup_track) = '');
    RETURN NEW;
  END IF;

  BEGIN
    UPDATE auth.users
    SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
      || CASE
           WHEN coalesce(raw_user_meta_data, '{}'::jsonb) ? 'contact_phone'
             THEN jsonb_build_object('phone', raw_user_meta_data->>'contact_phone')
           ELSE '{}'::jsonb
         END
    WHERE id = NEW.id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM public.apply_signup_profile_for_user(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_apply_signup_profile failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- trg_users_privilege_guard: latest definition from 20261022001000_users_privilege_guard.sql, city_admin removed.
CREATE OR REPLACE FUNCTION public.trg_users_privilege_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  is_global boolean;
  new_role text := replace(lower(trim(coalesce(NEW.role::text, ''))), '-', '_');
BEGIN
  -- Only police direct client writes. See the file header.
  -- anon has no users-update path in the app. Reject it before any helper call:
  -- PL/pgSQL may evaluate a function inside AND even when an earlier term is false,
  -- and anon cannot execute those helpers.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF current_user = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  is_global := public.is_global_app_staff();
  IF NOT is_global THEN
    is_global := public.is_platform_staff();
  END IF;

  -- 1) Self-edits can never touch privileged columns.
  --    users.status is the account status column from 20260815010000.
  --    patroller_request_status is not a users column (resident_profiles).
  IF NEW.id = auth.uid() AND NOT is_global AND (
       NEW.role IS DISTINCT FROM OLD.role
    OR NEW.platform_role IS DISTINCT FROM OLD.platform_role
    OR NEW.verified IS DISTINCT FROM OLD.verified
    OR NEW.verification_method IS DISTINCT FROM OLD.verification_method
    OR NEW.verified_by_user_id IS DISTINCT FROM OLD.verified_by_user_id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'you cannot change your own role, verification, account status or neighbourhood here';
  END IF;

  -- active_organization_id self-change is allowed only to an org the user belongs to.
  -- Clearing it (NULL) is allowed. Global / platform staff are not limited here;
  -- the app switch goes through set_active_organization and never reaches this branch.
  -- The helper call is in its own IF. PL/pgSQL can evaluate a function that sits
  -- in the same AND list even when an earlier comparison is false, which would
  -- run this check on every profile save.
  IF NEW.id = auth.uid()
     AND NEW.active_organization_id IS DISTINCT FROM OLD.active_organization_id
     AND NEW.active_organization_id IS NOT NULL
     AND NOT is_global THEN
    IF NOT public.users_guard_self_in_org(NEW.active_organization_id) THEN
      RAISE EXCEPTION 'not a member of that neighbourhood';
    END IF;
  END IF;

  -- 2) Editing someone else: global/platform staff, or NW admin/committee
  --    of an org the caller already belongs to.
  IF NEW.id <> auth.uid() AND NOT is_global THEN
    -- A real other neighbourhood must not be distinguishable from a missing row.
    IF OLD.organization_id IS NOT NULL THEN
      IF OLD.organization_id NOT IN (SELECT public.current_org_ids()) THEN
        RAISE EXCEPTION 'not found';
      END IF;
    END IF;

    -- NULL organization_id is unassigned, not another org. Still staff-only,
    -- so a resident cannot edit that row (NULL would skip a bare IN check).
    IF NOT public.is_area_broadcast_staff() THEN
      RAISE EXCEPTION 'forbidden';
    END IF;

    -- Local staff can never mint global/platform roles or move users across orgs.
    -- GLOBAL_APP_ROLES in roleMatrix.js are admin and technical_support.
    -- security_admin is a partner role, also not a local assignment.
    IF new_role IN ('admin', 'technical_support', 'security_admin')
       OR NEW.platform_role IS DISTINCT FROM OLD.platform_role
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'only platform staff can make that change';
    END IF;

    -- Committee may not promote to nw_admin (D1).
    IF new_role = 'nw_admin' THEN
      IF NOT public.is_org_nw_admin(OLD.organization_id) THEN
        RAISE EXCEPTION 'only an NW admin can appoint another NW admin';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Policy city_hub_posts_insert on public.city_hub_posts: latest from 20260815032000_city_hub_post_manage.sql, city_admin removed.
DROP POLICY IF EXISTS city_hub_posts_insert ON public.city_hub_posts;
CREATE POLICY city_hub_posts_insert ON public.city_hub_posts
  FOR INSERT TO authenticated
  WITH CHECK (
    author_organization_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND (
          public.is_global_app_staff()
          OR lower(trim(coalesce(cu.role::text, ''))) IN (
            'admin',
            'technical_support',
            'nw_admin',
            'security_admin'
          )
        )
    )
    AND (
      public.is_global_app_staff()
      OR author_organization_id IN (SELECT public.current_org_ids())
    )
  );

-- Policy city_hub_posts_select on public.city_hub_posts: latest from 20261117030000_city_hub_suspect_alert_cross_watch.sql, city_admin removed.
DROP POLICY IF EXISTS city_hub_posts_select ON public.city_hub_posts;
CREATE POLICY city_hub_posts_select ON public.city_hub_posts
  FOR SELECT TO authenticated
  USING (
    (
      status = 'published'
      OR author_organization_id IN (SELECT public.current_org_ids())
    )
    AND EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND lower(trim(coalesce(cu.role::text, ''))) IN (
          'volunteer',
          'patroller',
          'investigator',
          'committee',
          'nw_admin',
          'admin',
          'technical_support',
          'security_admin'
        )
    )
    AND (
      hidden_at IS NULL
      OR public.can_moderate_resident_content(author_organization_id)
      OR public.can_manage_city_hub_post(created_by_user_id)
    )
    AND (
      type IS DISTINCT FROM 'suspect_alert'
      OR public.can_view_city_hub_suspect_alert(author_organization_id, city_id)
    )
  );

-- ---------------------------------------------------------------------------
-- R4 (database side): community admin contacts for platform and global staff
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_community_admin_contacts()
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
  LEFT JOIN LATERAL (
    SELECT cu.full_name, cu.email, cu.phone, cu.role
    FROM public.organization_members om
    JOIN public.users cu ON cu.id = om.user_id
    WHERE om.organization_id = o.id
      AND om.status = 'active'
      AND lower(trim(om.member_role)) IN ('nw_admin', 'admin', 'committee')
    ORDER BY
      CASE lower(trim(om.member_role))
        WHEN 'nw_admin' THEN 0
        WHEN 'admin' THEN 1
        ELSE 3
      END,
      cu.full_name
    LIMIT 1
  ) u ON true
  WHERE o.type IN ('nw_group', 'security_company')
    AND (public.is_global_app_staff() OR public.is_platform_staff())
  ORDER BY o.type, lower(o.name);
$$;

REVOKE ALL ON FUNCTION public.list_community_admin_contacts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_community_admin_contacts() TO authenticated, service_role;
COMMENT ON FUNCTION public.list_community_admin_contacts() IS
  'Admin contact per watch and security company. Platform and global staff only; everyone else gets no rows.';

-- Old name kept for older app builds; same rows, staff only.
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
  SELECT * FROM public.list_community_admin_contacts();
$$;

REVOKE ALL ON FUNCTION public.city_admin_communities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.city_admin_communities() TO authenticated, service_role;
COMMENT ON FUNCTION public.city_admin_communities() IS
  'Deprecated alias of list_community_admin_contacts() (city admin role retired).';

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Final check
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  problems text[] := ARRAY[]::text[];
  leftovers text;
  s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['public.admin_set_user_role(uuid,text)', 'public.apply_my_signup_profile()', 'public.assign_resident_to_neighborhood(uuid,uuid)', 'public.camera_spot_readable(uuid)', 'public.can_moderate_incidents()', 'public.can_moderate_resident_content(uuid)', 'public.can_view_city_hub()', 'public.can_view_criminal_intelligence()', 'public.is_chat_ops_member()', 'public.is_hotspot_staff()', 'public.is_sos_responder()', 'public.is_staff_role(text)', 'public.list_watch_staff_activity(integer,text,boolean)', 'public.publish_incident_to_city_hub(uuid,text,text,text,uuid)', 'public.report_community_content(text,uuid,text,text)', 'public.storage_city_hub_object_readable(text)', 'public.trg_apply_signup_profile()', 'public.trg_users_privilege_guard()', 'public.city_admin_communities()', 'public.list_community_admin_contacts()', 'public.refuse_retired_city_admin()'] LOOP
    IF to_regprocedure(s) IS NULL THEN
      problems := problems || (s || ' is missing');
    END IF;
  END LOOP;

  -- No function body (outside extensions and the refusal trigger) names city_admin.
  SELECT string_agg(format('%s.%s(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), ', ')
    INTO leftovers
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg_toast%'
    AND p.prokind IN ('f', 'p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    AND p.oid <> 'public.refuse_retired_city_admin()'::regprocedure
    AND position('city_admin' IN coalesce(p.prosrc, '')) > 0;
  IF leftovers IS NOT NULL THEN
    problems := problems || ('functions still naming city_admin: ' || leftovers);
  END IF;

  SELECT string_agg(format('%s on %s.%s', policyname, schemaname, tablename), ', ')
    INTO leftovers
  FROM pg_policies
  WHERE position('city_admin' IN coalesce(qual, '') || ' ' || coalesce(with_check, '')) > 0;
  IF leftovers IS NOT NULL THEN
    problems := problems || ('policies still naming city_admin: ' || leftovers);
  END IF;

  SELECT string_agg(format('%s.%s', schemaname, viewname), ', ')
    INTO leftovers
  FROM pg_views
  WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    AND position('city_admin' IN coalesce(definition, '')) > 0;
  IF leftovers IS NOT NULL THEN
    problems := problems || ('views still naming city_admin: ' || leftovers);
  END IF;

  FOREACH s IN ARRAY ARRAY['users_refuse_retired_city_admin', 'organization_members_refuse_retired_city_admin', 'organizations_refuse_retired_city_admin'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = s AND NOT tgisinternal) THEN
      problems := problems || (s || ' trigger is missing');
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'city_hub_posts' AND policyname = 'city_hub_posts_select')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'city_hub_posts' AND policyname = 'city_hub_posts_insert') THEN
    problems := problems || 'city_hub_posts select/insert policies are missing'::text;
  END IF;

  IF has_function_privilege('anon', 'public.list_community_admin_contacts()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.city_admin_communities()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.refuse_retired_city_admin()', 'EXECUTE') THEN
    problems := problems || 'contacts list or refusal trigger is callable by the wrong role'::text;
  END IF;

  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION 'Retire city admin: check failed: %', array_to_string(problems, '; ');
  END IF;
  RAISE NOTICE 'Retire city admin: OK';
END
$verify$;
