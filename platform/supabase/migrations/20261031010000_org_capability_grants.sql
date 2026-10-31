-- P0a - Capability grants (backend). NEW_FEATURES_BLUEPRINT sections 5.1, 5.4, 12.7; D1, D3, D17.
--
-- Scoped capabilities per organization (resident moderators, street reps, equipment custodians).
-- Layered on top of users.role; does not replace it.
--
-- Purely additive: one new table, new indexes, one new policy, new functions.
-- No existing rows are inserted, updated or deleted. Existing helpers it relies on
-- (working_organization_id, current_org_ids, is_global_app_staff, is_platform_staff,
-- is_org_nw_admin, user_in_org [G2 20261003002000], is_verified_household
-- [20260818061000], resident_street_label [20260815042000], write_staff_activity
-- [20260819020000, grants hardened in G2], notify_app_user [G6 20261030010000])
-- are called, NOT re-created, so their live bodies and grants stay as they are.
--
-- Deviations from the 5.4 draft (security, per 12.7 checklist):
--   * revoke_org_capability: a grant outside the caller's orgs raises 'grant not found'
--     (the draft raised 'forbidden', which leaks existence across orgs).
--   * list_org_capability_grants: also requires can_manage_org_capabilities(org).
--     The draft only filtered by org, so any member could read admin notes and
--     revoke reasons through the RPC, defeating the table's SELECT policy.
--   * grant_org_capability: rejects unknown capability text with a friendly error
--     before the CHECK constraint fires; trims p_reason in the audit row.

-- ---------------------------------------------------------------------------
-- 1) Table + indexes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_capability_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  capability text NOT NULL CHECK (capability IN (
    'resident_broadcaster',
    'resident_moderator',
    'equipment_custodian'
  )),
  title text CHECK (title IS NULL OR char_length(title) <= 60),   -- e.g. 'Street rep - Theescombe Ave'
  scope_suburb_id uuid REFERENCES public.suburbs (id) ON DELETE SET NULL, -- optional, future street/suburb scoping
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  granted_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  revoked_at timestamptz,
  revoke_reason text CHECK (revoke_reason IS NULL OR char_length(revoke_reason) <= 500)
);

-- One active grant per (org, user, capability).
CREATE UNIQUE INDEX IF NOT EXISTS org_capability_grants_active_uidx
  ON public.org_capability_grants (organization_id, user_id, capability)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS org_capability_grants_user_active_idx
  ON public.org_capability_grants (user_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.org_capability_grants ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2) Capability checks
-- ---------------------------------------------------------------------------
-- Core check for any user (used by triggers / RPCs where auth.uid() may not be the subject).
-- Internal: service_role only.
CREATE OR REPLACE FUNCTION public.user_has_org_capability(
  p_user_id uuid,
  p_capability text,
  p_org_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id IS NOT NULL AND p_org_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.org_capability_grants g
    WHERE g.user_id = p_user_id
      AND g.organization_id = p_org_id
      AND g.revoked_at IS NULL
      AND (g.expires_at IS NULL OR g.expires_at > now())
      AND (
        g.capability = p_capability
        OR (p_capability = 'resident_broadcaster' AND g.capability = 'resident_moderator')
      )
  );
$$;

-- Caller check against the working organization (or an explicit org the caller belongs to).
CREATE OR REPLACE FUNCTION public.has_org_capability(p_capability text, p_org_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    COALESCE(p_org_id, public.working_organization_id()) IN (SELECT public.current_org_ids())
    AND public.user_has_org_capability(
      auth.uid(),
      p_capability,
      COALESCE(p_org_id, public.working_organization_id())
    ),
    false
  );
$$;

-- Who may assign / revoke: Main admin, Technical support, platform staff (working area),
-- or the NW admin of that organization. Committee cannot (default D1).
CREATE OR REPLACE FUNCTION public.can_manage_org_capabilities(p_org_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    COALESCE(p_org_id, public.working_organization_id()) IN (SELECT public.current_org_ids())
    AND (
      public.is_global_app_staff()
      OR public.is_platform_staff()
      OR public.is_org_nw_admin(COALESCE(p_org_id, public.working_organization_id()))
    ),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- 3) RLS: own rows or managers. Other members never read this table (it holds
--    admin notes / revoke reasons); badges come from list_capability_badges().
--    No INSERT/UPDATE/DELETE policies: writes go through RPCs only.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS org_capability_grants_select ON public.org_capability_grants;
CREATE POLICY org_capability_grants_select ON public.org_capability_grants
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.can_manage_org_capabilities(organization_id)
  );

-- ---------------------------------------------------------------------------
-- 4) Grant / revoke RPCs (audited + notified)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_org_capability(
  p_user_id uuid,
  p_capability text,
  p_title text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS public.org_capability_grants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id uuid := public.working_organization_id();
  target_role text;
  row_out public.org_capability_grants;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF org_id IS NULL THEN RAISE EXCEPTION 'no neighbourhood selected'; END IF;
  IF NOT public.can_manage_org_capabilities(org_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_capability IS NULL OR p_capability NOT IN ('resident_broadcaster', 'resident_moderator', 'equipment_custodian') THEN
    RAISE EXCEPTION 'unknown capability';
  END IF;
  -- Explicit membership check: org is always the caller's working org, and the
  -- target must belong to it (stops Main admin / B admin granting to an A user).
  IF p_user_id IS NULL OR NOT public.user_in_org(p_user_id, org_id) THEN
    RAISE EXCEPTION 'user is not in this neighbourhood';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN RAISE EXCEPTION 'expiry must be in the future'; END IF;

  SELECT replace(lower(trim(u.role::text)), '-', '_') INTO target_role
  FROM public.users u WHERE u.id = p_user_id;

  -- Resident-side capabilities are for households (residents + household-mode watch members).
  IF p_capability IN ('resident_broadcaster', 'resident_moderator')
     AND coalesce(target_role, '') NOT IN ('resident', 'volunteer', 'patroller', 'investigator', 'committee', 'nw_admin') THEN
    RAISE EXCEPTION 'capability not allowed for this role';
  END IF;
  -- Default D3: resident-side moderators must be verified households.
  IF p_capability IN ('resident_broadcaster', 'resident_moderator')
     AND NOT public.is_verified_household(p_user_id) THEN
    RAISE EXCEPTION 'only verified households can hold this responsibility';
  END IF;
  -- D17: equipment custodians must be watch members (not plain residents).
  IF p_capability = 'equipment_custodian'
     AND coalesce(target_role, '') NOT IN ('volunteer', 'patroller', 'investigator', 'committee', 'nw_admin') THEN
    RAISE EXCEPTION 'equipment custodian must be a watch member';
  END IF;

  INSERT INTO public.org_capability_grants (
    organization_id, user_id, capability, title, note, granted_by, expires_at
  )
  VALUES (
    org_id, p_user_id, p_capability,
    nullif(trim(p_title), ''), nullif(trim(p_note), ''), auth.uid(), p_expires_at
  )
  ON CONFLICT (organization_id, user_id, capability) WHERE revoked_at IS NULL
  DO UPDATE SET title = EXCLUDED.title, note = EXCLUDED.note, expires_at = EXCLUDED.expires_at
  RETURNING * INTO row_out;

  PERFORM public.write_staff_activity(
    'capability_granted',
    jsonb_build_object('grant_id', row_out.id, 'target_user_id', p_user_id,
                       'capability', p_capability, 'title', row_out.title),
    auth.uid(), org_id
  );

  PERFORM public.notify_app_user(
    p_user_id, 'capability',
    CASE p_capability
      WHEN 'resident_moderator' THEN 'You are now a resident moderator'
      WHEN 'resident_broadcaster' THEN 'You can now post neighbourhood notices'
      WHEN 'equipment_custodian' THEN 'You are now the equipment custodian'
      ELSE 'New responsibility assigned'
    END,
    coalesce(row_out.title, 'Assigned by your neighbourhood watch.'),
    CASE p_capability
      WHEN 'equipment_custodian' THEN '/equipment/admin'
      ELSE '/resident/moderate'
    END
  );

  RETURN row_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_org_capability(p_grant_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g public.org_capability_grants;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO g FROM public.org_capability_grants WHERE id = p_grant_id FOR UPDATE;
  -- Cross-org (or missing / already revoked) -> 'not found', never 'forbidden'.
  IF g.id IS NULL OR g.revoked_at IS NOT NULL
     OR (g.user_id <> auth.uid() AND g.organization_id NOT IN (SELECT public.current_org_ids())) THEN
    RAISE EXCEPTION 'grant not found';
  END IF;
  -- Holders may step down themselves.
  IF g.user_id <> auth.uid() AND NOT public.can_manage_org_capabilities(g.organization_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.org_capability_grants
  SET revoked_at = now(), revoked_by = auth.uid(), revoke_reason = nullif(trim(p_reason), '')
  WHERE id = p_grant_id;

  PERFORM public.write_staff_activity(
    'capability_revoked',
    jsonb_build_object('grant_id', g.id, 'target_user_id', g.user_id,
                       'capability', g.capability, 'reason', nullif(trim(p_reason), '')),
    auth.uid(), g.organization_id
  );
  IF g.user_id <> auth.uid() THEN
    PERFORM public.notify_app_user(g.user_id, 'capability', 'A responsibility was removed',
      coalesce(nullif(trim(p_reason), ''), 'Contact your NW admin for details.'), '/profile');
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Read RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_org_capabilities()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT g.capability ORDER BY g.capability), '{}')
  FROM public.org_capability_grants g
  WHERE g.user_id = auth.uid()
    AND g.organization_id = public.working_organization_id()
    AND g.revoked_at IS NULL
    AND (g.expires_at IS NULL OR g.expires_at > now());
$$;

-- Managers only (NW admin of the working org, global / platform staff).
CREATE OR REPLACE FUNCTION public.list_org_capability_grants(p_include_revoked boolean DEFAULT false)
RETURNS TABLE (
  id uuid, user_id uuid, full_name text, street_label text, capability text, title text,
  granted_by_name text, granted_at timestamptz, expires_at timestamptz,
  revoked_at timestamptz, revoked_by_name text, revoke_reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.id, g.user_id, u.full_name,
         public.resident_street_label(coalesce(nullif(trim(rp.home_address), ''), u.address)),  -- same expression as list_resident_neighbours
         g.capability, g.title, gb.full_name, g.granted_at, g.expires_at,
         g.revoked_at, rb.full_name, g.revoke_reason
  FROM public.org_capability_grants g
  JOIN public.users u ON u.id = g.user_id
  LEFT JOIN public.resident_profiles rp ON rp.user_id = g.user_id
  LEFT JOIN public.users gb ON gb.id = g.granted_by
  LEFT JOIN public.users rb ON rb.id = g.revoked_by
  WHERE g.organization_id = public.working_organization_id()
    AND g.organization_id IN (SELECT public.current_org_ids())
    AND public.can_manage_org_capabilities(g.organization_id)
    AND (p_include_revoked OR g.revoked_at IS NULL)
  ORDER BY g.revoked_at NULLS FIRST, g.granted_at DESC;
$$;

-- Badges for any list of users (neighbour cards, broadcast author line, profile).
-- Returns only user_id + capability + title, and only for the caller's orgs.
CREATE OR REPLACE FUNCTION public.list_capability_badges(p_user_ids uuid[])
RETURNS TABLE (user_id uuid, capability text, title text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.user_id, g.capability, g.title
  FROM public.org_capability_grants g
  WHERE g.user_id = ANY (p_user_ids)
    AND g.organization_id IN (SELECT public.current_org_ids())
    AND g.revoked_at IS NULL
    AND (g.expires_at IS NULL OR g.expires_at > now())
    AND g.capability IN ('resident_broadcaster', 'resident_moderator', 'equipment_custodian');
$$;

-- ---------------------------------------------------------------------------
-- 6) Grants (convention: REVOKE FROM PUBLIC, anon; client RPCs -> authenticated
--    + service_role; internal helpers -> service_role only)
-- ---------------------------------------------------------------------------
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.has_org_capability(text, uuid)',
    'public.can_manage_org_capabilities(uuid)',
    'public.grant_org_capability(uuid, text, text, text, timestamptz)',
    'public.revoke_org_capability(uuid, text)',
    'public.get_my_org_capabilities()',
    'public.list_org_capability_grants(boolean)',
    'public.list_capability_badges(uuid[])'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;

-- Internal helper (takes an arbitrary user id): never callable from the client.
REVOKE ALL ON FUNCTION public.user_has_org_capability(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_org_capability(uuid, text, uuid) TO service_role;

REVOKE ALL ON public.org_capability_grants FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.org_capability_grants FROM anon, authenticated;  -- RPC-only writes
GRANT SELECT ON public.org_capability_grants TO authenticated;
GRANT ALL ON public.org_capability_grants TO service_role;

-- ---------------------------------------------------------------------------
-- Verification (run manually in the SQL editor; read-only)
-- ---------------------------------------------------------------------------
-- PRE-CHECKS (before applying):
--   -- helpers this migration calls must exist (expect 10 rows):
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid)
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
--   WHERE p.proname IN ('working_organization_id','current_org_ids','is_global_app_staff',
--     'is_platform_staff','is_org_nw_admin','user_in_org','is_verified_household',
--     'write_staff_activity','notify_app_user','resident_street_label')
--   ORDER BY 1;
--   -- table must not exist yet (expect NULL):
--   SELECT to_regclass('public.org_capability_grants');
--   -- baseline counts to compare afterwards:
--   SELECT (SELECT count(*) FROM public.users) AS users,
--          (SELECT count(*) FROM public.activity_logs) AS activity_logs,
--          (SELECT count(*) FROM public.app_notifications) AS app_notifications;
--
-- POST-CHECKS (after applying):
--   SELECT to_regclass('public.org_capability_grants');              -- not NULL
--   SELECT count(*) FROM public.org_capability_grants;                -- 0
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.org_capability_grants'::regclass; -- true
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'org_capability_grants'; -- 1 row, SELECT
--   SELECT indexname FROM pg_indexes WHERE tablename = 'org_capability_grants';        -- pkey + 2
--   -- function grants (anon must be false everywhere; user_has_org_capability false for authenticated):
--   SELECT p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
--          has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
--   WHERE p.proname IN ('user_has_org_capability','has_org_capability','can_manage_org_capabilities',
--     'grant_org_capability','revoke_org_capability','get_my_org_capabilities',
--     'list_org_capability_grants','list_capability_badges')
--   ORDER BY 1;
--   -- authenticated has SELECT only on the table:
--   SELECT privilege_type FROM information_schema.role_table_grants
--   WHERE table_name = 'org_capability_grants' AND grantee = 'authenticated';  -- SELECT
--   -- baseline counts unchanged (same query as pre-check).
