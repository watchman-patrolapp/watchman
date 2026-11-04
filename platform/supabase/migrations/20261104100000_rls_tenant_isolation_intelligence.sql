-- Prompt 2: Close remaining cross-tenant RLS holes on intelligence child
-- tables, incident section updates, feedback insert, and the security metrics
-- view. profile_match_queue was already org-scoped in
-- 20260815029000_page_isolation_hotspots_global.sql (left unchanged).

-- ---------------------------------------------------------------------------
-- profile_associates: was authenticated-open SELECT/INSERT/UPDATE/DELETE
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.profile_associates;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.profile_associates;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.profile_associates;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON public.profile_associates;
DROP POLICY IF EXISTS profile_associates_select_org ON public.profile_associates;
DROP POLICY IF EXISTS profile_associates_insert_org ON public.profile_associates;
DROP POLICY IF EXISTS profile_associates_update_org ON public.profile_associates;
DROP POLICY IF EXISTS profile_associates_delete_org ON public.profile_associates;

ALTER TABLE public.profile_associates ENABLE ROW LEVEL SECURITY;

CREATE POLICY profile_associates_select_org ON public.profile_associates
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.criminal_profiles cp
      WHERE cp.id IN (profile_associates.profile_id, profile_associates.associate_profile_id)
        AND cp.organization_id IN (SELECT public.current_org_ids())
    )
  );

CREATE POLICY profile_associates_insert_org ON public.profile_associates
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.criminal_profiles cp
      WHERE cp.id = profile_associates.profile_id
        AND cp.organization_id IN (SELECT public.current_org_ids())
    )
    AND EXISTS (
      SELECT 1
      FROM public.criminal_profiles cp2
      WHERE cp2.id = profile_associates.associate_profile_id
        AND cp2.organization_id IN (SELECT public.current_org_ids())
    )
  );

CREATE POLICY profile_associates_update_org ON public.profile_associates
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.criminal_profiles cp
      WHERE cp.id = profile_associates.profile_id
        AND cp.organization_id IN (SELECT public.current_org_ids())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.criminal_profiles cp
      WHERE cp.id = profile_associates.profile_id
        AND cp.organization_id IN (SELECT public.current_org_ids())
    )
    AND EXISTS (
      SELECT 1
      FROM public.criminal_profiles cp2
      WHERE cp2.id = profile_associates.associate_profile_id
        AND cp2.organization_id IN (SELECT public.current_org_ids())
    )
  );

CREATE POLICY profile_associates_delete_org ON public.profile_associates
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.criminal_profiles cp
      WHERE cp.id = profile_associates.profile_id
        AND cp.organization_id IN (SELECT public.current_org_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- profile_geography: was authenticated-open SELECT/INSERT (no UPDATE/DELETE)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.profile_geography;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.profile_geography;
DROP POLICY IF EXISTS profile_geography_select_org ON public.profile_geography;
DROP POLICY IF EXISTS profile_geography_insert_org ON public.profile_geography;

ALTER TABLE public.profile_geography ENABLE ROW LEVEL SECURITY;

CREATE POLICY profile_geography_select_org ON public.profile_geography
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.criminal_profiles cp
      WHERE cp.id = profile_geography.profile_id
        AND cp.organization_id IN (SELECT public.current_org_ids())
    )
  );

CREATE POLICY profile_geography_insert_org ON public.profile_geography
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.criminal_profiles cp
      WHERE cp.id = profile_geography.profile_id
        AND cp.organization_id IN (SELECT public.current_org_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- profile_intelligence: was authenticated-open SELECT/INSERT (no UPDATE/DELETE)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.profile_intelligence;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.profile_intelligence;
DROP POLICY IF EXISTS profile_intelligence_select_org ON public.profile_intelligence;
DROP POLICY IF EXISTS profile_intelligence_insert_org ON public.profile_intelligence;

ALTER TABLE public.profile_intelligence ENABLE ROW LEVEL SECURITY;

CREATE POLICY profile_intelligence_select_org ON public.profile_intelligence
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.criminal_profiles cp
      WHERE cp.id = profile_intelligence.profile_id
        AND cp.organization_id IN (SELECT public.current_org_ids())
    )
  );

CREATE POLICY profile_intelligence_insert_org ON public.profile_intelligence
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.criminal_profiles cp
      WHERE cp.id = profile_intelligence.profile_id
        AND cp.organization_id IN (SELECT public.current_org_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- mo_pattern_history: RLS on, but never had policies (deny-all). Add org scope
-- so legitimate org members can use it the same way as other intel children.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.mo_pattern_history;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.mo_pattern_history;
DROP POLICY IF EXISTS mo_pattern_history_select_org ON public.mo_pattern_history;
DROP POLICY IF EXISTS mo_pattern_history_insert_org ON public.mo_pattern_history;

ALTER TABLE public.mo_pattern_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY mo_pattern_history_select_org ON public.mo_pattern_history
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.criminal_profiles cp
      WHERE cp.id = mo_pattern_history.profile_id
        AND cp.organization_id IN (SELECT public.current_org_ids())
    )
  );

CREATE POLICY mo_pattern_history_insert_org ON public.mo_pattern_history
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.criminal_profiles cp
      WHERE cp.id = mo_pattern_history.profile_id
        AND cp.organization_id IN (SELECT public.current_org_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- incident_section_updates: SELECT was USING (true); INSERT had roles but no org
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS incident_section_updates_select_authenticated ON public.incident_section_updates;
DROP POLICY IF EXISTS incident_section_updates_insert_elevated ON public.incident_section_updates;
DROP POLICY IF EXISTS incident_section_updates_select_org ON public.incident_section_updates;
DROP POLICY IF EXISTS incident_section_updates_insert_elevated_org ON public.incident_section_updates;

ALTER TABLE public.incident_section_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY incident_section_updates_select_org ON public.incident_section_updates
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.incidents i
      WHERE i.id = incident_section_updates.incident_id
        AND (
          i.organization_id IN (SELECT public.current_org_ids())
          OR i.reporter_id::text = auth.uid()::text
          OR i.submitted_by::text = auth.uid()::text
        )
    )
  );

CREATE POLICY incident_section_updates_insert_elevated_org ON public.incident_section_updates
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND lower(trim(u.role::text)) IN (
          'admin',
          'committee',
          'patroller',
          'investigator'
        )
    )
    AND EXISTS (
      SELECT 1
      FROM public.incidents i
      WHERE i.id = incident_section_updates.incident_id
        AND i.organization_id IN (SELECT public.current_org_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- feedback INSERT: was org OR NULL. Tie to caller + working org.
-- SELECT/UPDATE remain technical_support + org (unchanged).
-- ---------------------------------------------------------------------------
-- Drop stamp_working_organization_id on feedback: it filled NULL with the
-- caller's working org BEFORE RLS/CHECK, so a NULL insert still succeeded.
-- The app (FeedbackForm) already sends organization_id explicitly.
DROP TRIGGER IF EXISTS stamp_working_organization_id ON public.feedback;

-- Drop every INSERT policy on feedback (legacy names may still linger).
DO $drop_fb_ins$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'feedback'
      AND cmd = 'INSERT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.feedback', r.policyname);
  END LOOP;
END;
$drop_fb_ins$;

CREATE POLICY feedback_insert_org ON public.feedback
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id IN (SELECT public.current_org_ids())
    AND submitter_user_id = auth.uid()
  );

-- Belt-and-braces: reject NULL org even if an INSERT policy is misconfigured.
ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_organization_id_required;
ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_organization_id_required
  CHECK (organization_id IS NOT NULL) NOT VALID;
ALTER TABLE public.feedback VALIDATE CONSTRAINT feedback_organization_id_required;

-- ---------------------------------------------------------------------------
-- security_company_resident_metrics: grants already revoked (20260820070000).
-- Recreate with security_invoker so a future GRANT cannot run as view owner.
-- Drop the staff RPC first so the view has no dependents.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_security_company_resident_metrics();
DROP VIEW IF EXISTS public.security_company_resident_metrics;

CREATE VIEW public.security_company_resident_metrics
  WITH (security_invoker = true)
AS
SELECT
  o.id AS security_company_id,
  o.name AS security_company_name,
  count(DISTINCT rsm.resident_user_id) FILTER (
    WHERE rsm.membership_status IN ('self_reported', 'verified')
  ) AS residents_linked_count,
  count(DISTINCT rsm.resident_user_id) FILTER (
    WHERE rsm.membership_status = 'self_reported'
  ) AS residents_pending_count,
  count(DISTINCT rsm.resident_user_id) FILTER (
    WHERE rsm.membership_status = 'verified'
  ) AS residents_verified_count,
  count(DISTINCT public.resident_watch_area_id(rsm.resident_user_id)) FILTER (
    WHERE rsm.membership_status IN ('self_reported', 'verified')
  ) AS watch_areas_count,
  (
    SELECT count(*)::bigint
    FROM public.security_membership_events e
    WHERE e.to_company_id = o.id
      AND e.event_type = 'transferred'
      AND e.created_at >= now() - interval '30 days'
  ) AS clients_won_30d,
  (
    SELECT count(*)::bigint
    FROM public.security_membership_events e
    WHERE e.from_company_id = o.id
      AND e.event_type = 'transferred'
      AND e.created_at >= now() - interval '30 days'
  ) AS clients_lost_30d,
  count(DISTINCT i.id) FILTER (
    WHERE COALESCE(
      (to_jsonb(i)->>'created_at')::timestamptz,
      (to_jsonb(i)->>'submitted_at')::timestamptz,
      (to_jsonb(i)->>'incident_date')::timestamptz
    ) >= now() - interval '30 days'
  ) AS incidents_last_30d
FROM public.organizations o
LEFT JOIN public.resident_security_memberships rsm
  ON rsm.security_company_id = o.id
LEFT JOIN public.users u
  ON u.id = rsm.resident_user_id
LEFT JOIN public.incidents i
  ON i.reporter_id::text = u.id::text
WHERE o.type = 'security_company'
GROUP BY o.id, o.name;

REVOKE ALL ON TABLE public.security_company_resident_metrics FROM PUBLIC;
REVOKE ALL ON TABLE public.security_company_resident_metrics FROM anon;
REVOKE ALL ON TABLE public.security_company_resident_metrics FROM authenticated;

COMMENT ON VIEW public.security_company_resident_metrics IS
  'Internal aggregate view (security_invoker). Do not GRANT SELECT to authenticated - use list_security_company_resident_metrics().';


CREATE FUNCTION public.list_security_company_resident_metrics()
RETURNS TABLE (
  security_company_id uuid,
  security_company_name text,
  residents_linked_count bigint,
  residents_pending_count bigint,
  residents_verified_count bigint,
  watch_areas_count bigint,
  clients_won_30d bigint,
  clients_lost_30d bigint,
  incidents_last_30d bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.is_platform_staff() OR public.is_global_app_staff()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    m.security_company_id,
    m.security_company_name,
    m.residents_linked_count,
    m.residents_pending_count,
    m.residents_verified_count,
    m.watch_areas_count,
    m.clients_won_30d,
    m.clients_lost_30d,
    m.incidents_last_30d
  FROM public.security_company_resident_metrics m
  ORDER BY m.residents_linked_count DESC, m.security_company_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_security_company_resident_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_security_company_resident_metrics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_security_company_resident_metrics() TO service_role;

COMMENT ON FUNCTION public.list_security_company_resident_metrics() IS
  'Platform / global staff only: city-wide security company client metrics. View itself is not selectable by authenticated.';

NOTIFY pgrst, 'reload schema';
