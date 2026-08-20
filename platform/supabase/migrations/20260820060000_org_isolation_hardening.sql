-- Org isolation hardening: close SECURITY DEFINER / RLS gaps so Org A cannot
-- read or mutate Org B operational data (City Hub + Hotspots stay city-wide).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
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
          'committee',
          'city_admin'
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_moderate_incidents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_moderate_incidents() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_moderate_incidents() TO service_role;

CREATE OR REPLACE FUNCTION public.incident_in_caller_orgs(p_incident_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.incidents i
    WHERE i.id = p_incident_id
      AND i.organization_id IN (SELECT public.current_org_ids())
  );
$$;

REVOKE ALL ON FUNCTION public.incident_in_caller_orgs(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.incident_in_caller_orgs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.incident_in_caller_orgs(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- approve / reject — role + org scoped
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.approve_incident(uuid, text);
DROP FUNCTION IF EXISTS public.reject_incident(uuid, text, text);
DROP FUNCTION IF EXISTS public.approve_incident(uuid, uuid);
DROP FUNCTION IF EXISTS public.reject_incident(uuid, uuid, text);

CREATE FUNCTION public.approve_incident(p_incident_id uuid, p_admin_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF NOT public.can_moderate_incidents() THEN
    RAISE EXCEPTION 'not authorized to moderate incidents';
  END IF;
  IF NOT public.incident_in_caller_orgs(p_incident_id) THEN
    RAISE EXCEPTION 'incident not in working area';
  END IF;

  UPDATE public.incidents
  SET
    status = 'approved',
    approved_by = p_admin_id,
    approved_at = now()
  WHERE id = p_incident_id
    AND status = 'pending'
    AND organization_id IN (SELECT public.current_org_ids());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'incident not pending or not found';
  END IF;
END;
$$;

CREATE FUNCTION public.reject_incident(
  p_incident_id uuid,
  p_admin_id uuid,
  p_rejection_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_admin_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF NOT public.can_moderate_incidents() THEN
    RAISE EXCEPTION 'not authorized to moderate incidents';
  END IF;
  IF NOT public.incident_in_caller_orgs(p_incident_id) THEN
    RAISE EXCEPTION 'incident not in working area';
  END IF;

  UPDATE public.incidents
  SET
    status = 'rejected',
    rejected_by = p_admin_id,
    rejected_at = now(),
    rejection_reason = nullif(trim(p_rejection_reason), '')
  WHERE id = p_incident_id
    AND status = 'pending'
    AND organization_id IN (SELECT public.current_org_ids());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'incident not pending or not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_incident(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_incident(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.reject_incident(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_incident(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.approve_incident(uuid, uuid) IS
  'Approve pending incident in the caller''s working org(s) only.';
COMMENT ON FUNCTION public.reject_incident(uuid, uuid, text) IS
  'Reject pending incident in the caller''s working org(s) only.';

-- ---------------------------------------------------------------------------
-- Chat RLS — org on SELECT/INSERT/UPDATE/DELETE; no null-org ops leak
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS chat_messages_select_channel ON public.chat_messages;
CREATE POLICY chat_messages_select_channel ON public.chat_messages
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT public.current_org_ids())
    AND (
      visibility = 'resident'
      OR public.is_chat_ops_member()
    )
  );

DROP POLICY IF EXISTS chat_messages_insert_channel ON public.chat_messages;
CREATE POLICY chat_messages_insert_channel ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id::text = auth.uid()::text
    AND organization_id IN (SELECT public.current_org_ids())
    AND (
      visibility = 'resident'
      OR (visibility = 'patrol' AND public.is_chat_ops_member())
      OR (visibility = 'patrol' AND coalesce(is_critical, false) IS TRUE)
    )
  );

DROP POLICY IF EXISTS chat_messages_update_own ON public.chat_messages;
CREATE POLICY chat_messages_update_own ON public.chat_messages
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (SELECT public.current_org_ids())
    AND (sender_id::text = auth.uid()::text OR public.is_chat_ops_member())
  )
  WITH CHECK (
    organization_id IN (SELECT public.current_org_ids())
    AND (sender_id::text = auth.uid()::text OR public.is_chat_ops_member())
  );

DROP POLICY IF EXISTS chat_messages_delete_ops ON public.chat_messages;
CREATE POLICY chat_messages_delete_ops ON public.chat_messages
  FOR DELETE TO authenticated
  USING (
    organization_id IN (SELECT public.current_org_ids())
    AND public.is_chat_ops_member()
  );

-- ---------------------------------------------------------------------------
-- Live map garage — org-scoped (match get_active_patroller_avatars)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_patroller_garage_for_map()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  color text,
  is_primary boolean,
  make_model text,
  registration text,
  vehicle_type text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.id,
    v.user_id,
    v.color,
    COALESCE(v.is_primary, false) AS is_primary,
    v.make_model,
    v.registration,
    v.vehicle_type
  FROM public.user_vehicles v
  WHERE EXISTS (
    SELECT 1
    FROM public.active_patrols ap
    WHERE ap.user_id = v.user_id
      AND (
        ap.organization_id IN (SELECT public.current_org_ids())
        OR ap.organization_id IS NOT DISTINCT FROM public.working_organization_id()
      )
  );
$$;

COMMENT ON FUNCTION public.get_patroller_garage_for_map() IS
  'Vehicles for active patrollers in the caller''s working org(s) only.';

-- ---------------------------------------------------------------------------
-- Sightings directory — org-scoped
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_patrollers_for_sightings()
RETURNS TABLE (
  id uuid,
  full_name text,
  email text,
  avatar_url text,
  role text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT u.id, u.full_name, u.email, u.avatar_url, u.role::text
  FROM public.users u
  WHERE lower(trim(coalesce(u.role::text, ''))) IN (
    'patroller',
    'investigator',
    'committee',
    'admin',
    'technical_support'
  )
  AND u.organization_id IN (SELECT public.current_org_ids())
  ORDER BY lower(trim(coalesce(u.full_name, u.email, ''))), u.id;
$$;

COMMENT ON FUNCTION public.list_patrollers_for_sightings() IS
  'Sighting attribution directory limited to the caller''s working org(s).';

-- ---------------------------------------------------------------------------
-- Staff user lists — drop bare global OR (current_org_ids already covers working area)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_users_for_staff()
RETURNS SETOF public.users
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT u.*
  FROM public.users u
  WHERE u.id = auth.uid()
     OR u.organization_id IN (SELECT public.current_org_ids())
  ORDER BY u.created_at DESC;
$$;

COMMENT ON FUNCTION public.list_users_for_staff() IS
  'Users in the caller''s working org(s) (globals: active_organization_id only).';

DROP FUNCTION IF EXISTS public.list_neighborhood_next_of_kin();

CREATE FUNCTION public.list_neighborhood_next_of_kin()
RETURNS TABLE (
  user_id uuid,
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_user_id uuid,
  emergency_contact_relationship text,
  emergency_contact_2_name text,
  emergency_contact_2_phone text,
  emergency_contact_2_user_id uuid,
  emergency_contact_2_relationship text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    u.emergency_contact_name,
    u.emergency_contact_phone,
    u.emergency_contact_user_id,
    u.emergency_contact_relationship,
    u.emergency_contact_2_name,
    u.emergency_contact_2_phone,
    u.emergency_contact_2_user_id,
    u.emergency_contact_2_relationship
  FROM public.users u
  WHERE u.id = auth.uid()
     OR u.organization_id IN (SELECT public.current_org_ids());
$$;

REVOKE ALL ON FUNCTION public.list_neighborhood_next_of_kin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_neighborhood_next_of_kin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_neighborhood_next_of_kin() TO service_role;

COMMENT ON FUNCTION public.list_neighborhood_next_of_kin() IS
  'Primary and backup next-of-kin for residents in the caller''s working org(s).';

-- ---------------------------------------------------------------------------
-- Audit labels — no cross-org PII oracle
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_labels_for_audit(p_user_ids text[])
RETURNS TABLE (id uuid, full_name text, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT u.id, u.full_name, u.email::text
  FROM public.users u
  WHERE EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_user_ids, ARRAY[]::text[])) AS t(raw_id)
    WHERE u.id::text = trim(both FROM t.raw_id)
  )
  AND (
    u.id = auth.uid()
    OR u.organization_id IN (SELECT public.current_org_ids())
  );
$$;

COMMENT ON FUNCTION public.user_labels_for_audit(text[]) IS
  'Audit display names limited to self + working org(s).';

-- ---------------------------------------------------------------------------
-- Watch staff activity — default to working org; optional all-areas for globals
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_watch_staff_activity(integer, text);

CREATE FUNCTION public.list_watch_staff_activity(
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
  IF role_filter NOT IN ('nw_admin', 'committee') THEN
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
      public.is_watch_local_staff_role(
        coalesce(
          nullif(trim(al.details_json->>'actor_role'), ''),
          replace(lower(trim(u.role::text)), '-', '_')
        )
      )
      OR public.is_watch_local_staff_role(al.details_json->>'subject_role')
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
END;
$$;

REVOKE ALL ON FUNCTION public.list_watch_staff_activity(integer, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_watch_staff_activity(integer, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_watch_staff_activity(integer, text, boolean) TO service_role;

COMMENT ON FUNCTION public.list_watch_staff_activity(integer, text, boolean) IS
  'Global staff activity feed; defaults to working org unless p_all_areas.';

-- ---------------------------------------------------------------------------
-- SOS insert — must stamp an org the caller can access
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS sos_alerts_insert_self ON public.sos_alerts;
CREATE POLICY sos_alerts_insert_self ON public.sos_alerts
  FOR INSERT TO authenticated
  WITH CHECK (
    (resident_id = auth.uid() OR public.is_sos_responder())
    AND organization_id IN (SELECT public.current_org_ids())
  );

DROP POLICY IF EXISTS sos_alerts_update_responders ON public.sos_alerts;
CREATE POLICY sos_alerts_update_responders ON public.sos_alerts
  FOR UPDATE TO authenticated
  USING (
    public.is_sos_responder()
    AND (
      public.is_global_app_staff()
      OR public.is_platform_staff()
      OR organization_id IN (SELECT public.current_org_ids())
      OR EXISTS (
        SELECT 1
        FROM public.incidents i
        WHERE i.id = sos_alerts.incident_id
          AND i.organization_id IN (SELECT public.current_org_ids())
      )
    )
  )
  WITH CHECK (
    public.is_sos_responder()
    AND (
      public.is_global_app_staff()
      OR public.is_platform_staff()
      OR organization_id IN (SELECT public.current_org_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- Patrol org resolve — never invent Theescombe for unrelated / blank zones
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_patrol_organization_id(
  p_organization_id uuid,
  p_user_id text,
  p_zone text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id uuid := p_organization_id;
  uid uuid;
  zone_key text;
BEGIN
  IF org_id IS NOT NULL THEN
    RETURN org_id;
  END IF;

  BEGIN
    uid := nullif(trim(p_user_id), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    uid := NULL;
  END;

  IF uid IS NOT NULL THEN
    SELECT u.organization_id INTO org_id
    FROM public.users u
    WHERE u.id = uid;
    IF org_id IS NOT NULL THEN
      RETURN org_id;
    END IF;
  END IF;

  BEGIN
    org_id := public.working_organization_id();
  EXCEPTION WHEN undefined_function THEN
    org_id := NULL;
  END;
  IF org_id IS NOT NULL THEN
    RETURN org_id;
  END IF;

  zone_key := lower(trim(coalesce(p_zone, '')));
  IF zone_key <> '' AND zone_key <> 'unknown' THEN
    SELECT o.id INTO org_id
    FROM public.organizations o
    WHERE o.type = 'nw_group'
      AND (
        lower(trim(o.name)) = zone_key
        OR lower(trim(o.name)) = regexp_replace(zone_key, '\s+(neighbourhood|neighborhood)\s+watch$', '', 'i')
        OR lower(trim(o.name)) LIKE zone_key || '%'
      )
    ORDER BY
      CASE WHEN lower(trim(o.name)) = zone_key THEN 0 ELSE 1 END,
      length(o.name)
    LIMIT 1;
    IF org_id IS NOT NULL THEN
      RETURN org_id;
    END IF;
  END IF;

  -- Explicit Theescombe / legacy Zone A only — never guess for blank zones.
  IF zone_key LIKE 'theescombe%' OR zone_key = 'zone a' THEN
    RETURN public.resolve_theescombe_organization_id();
  END IF;

  RETURN NULL;
END;
$$;

NOTIFY pgrst, 'reload schema';
