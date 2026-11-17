-- =============================================================================
-- 20261118010000_ugc_reports_incidents_suspects.sql
-- In-context reports for incident reports and suspect (criminal) profiles.
--
-- Additive and idempotent: safe to re-run. Changes NO rows. It only:
--   1. Widens community_content_reports.content_type CHECK with
--      'incident_report' and 'criminal_profile' (all existing values kept).
--   2. Replaces report_community_content, list_community_reports and
--      resolve_community_report with copies of the 20261117010000 versions
--      plus the two new types:
--        - incident_report: reporter must be a member of the incident's watch
--          (same as incidents_select_org). The submitter cannot report it.
--        - criminal_profile: reporter must be in the profile's watch AND pass
--          can_view_criminal_intelligence() (same as criminal_profiles_select_org
--          from 20261117020000). Residents get 'content not found'. The creator
--          cannot report it.
--        - Suspect-profile reports are listed, notified and resolvable only for
--          moderators who may read suspect profiles.
--        - No auto-hide for either type: resolving only sets the report status.
--          Asking to hide them returns 'this content cannot be hidden yet'.
--   Grants on the three functions are the same as in 20261117010000.
--
-- Requires: 20261117010000_ugc_reports_posts_chat_users.sql and
--           20261117020000_criminal_profiles_role_gate.sql.
-- Run the whole file at once in the Supabase SQL editor. A multi-statement run
-- is one transaction, so if the verification block at the end fails, nothing
-- in this file is kept.
-- =============================================================================

-- 0) Preconditions ------------------------------------------------------------
DO $pre$
DECLARE
  missing text := '';
  fn text;
  col text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.report_community_content(text, uuid, text, text)',
    'public.list_community_reports(text)',
    'public.resolve_community_report(uuid, text, text, boolean)',
    'public.can_view_criminal_intelligence()',
    'public.normalized_app_role(text)',
    'public.current_org_ids()',
    'public.working_organization_id()',
    'public.can_moderate_resident_content(uuid)',
    'public.can_moderate_incidents()',
    'public.notify_app_user(uuid, text, text, text, text)'
  ]
  LOOP
    IF to_regprocedure(fn) IS NULL THEN
      missing := missing || fn || '; ';
    END IF;
  END LOOP;

  FOREACH col IN ARRAY ARRAY[
    'incidents.organization_id', 'incidents.submitted_by', 'incidents.reporter_id',
    'incidents.submitted_by_name', 'incidents.type', 'incidents.description',
    'incidents.is_anonymous_tip',
    'criminal_profiles.organization_id', 'criminal_profiles.created_by',
    'criminal_profiles.primary_name', 'criminal_profiles.status', 'criminal_profiles.risk_level'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = split_part(col, '.', 1)
        AND column_name = split_part(col, '.', 2)
    ) THEN
      missing := missing || col || '; ';
    END IF;
  END LOOP;

  IF to_regprocedure('public.report_community_content(text, uuid, text, text)') IS NOT NULL
     AND pg_get_functiondef('public.report_community_content(text, uuid, text, text)'::regprocedure)
         NOT LIKE '%user_profile%' THEN
    missing := missing || 'run 20261117010000_ugc_reports_posts_chat_users.sql first; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'criminal_profiles'
      AND policyname = 'criminal_profiles_select_org'
      AND qual LIKE '%can_view_criminal_intelligence%'
  ) THEN
    missing := missing || 'run 20261117020000_criminal_profiles_role_gate.sql first; ';
  END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION 'Reports for incidents and suspect profiles: missing prerequisites: %. Nothing was changed.', missing;
  END IF;
END
$pre$;

-- 1) Widen content_type CHECK (keep every existing value) -----------------------
ALTER TABLE public.community_content_reports
  DROP CONSTRAINT IF EXISTS community_content_reports_content_type_check;

ALTER TABLE public.community_content_reports
  ADD CONSTRAINT community_content_reports_content_type_check
  CHECK (content_type IN (
    'area_broadcast', 'service_listing', 'service_review',
    'lost_found', 'event',
    'city_hub_post', 'chat_message', 'user_profile',
    'incident_report', 'criminal_profile'
  ));

-- 2) Report / list / resolve RPCs (20261117010000 versions + new types) --------

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
              'admin', 'technical_support', 'security_admin', 'city_admin'
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

CREATE OR REPLACE FUNCTION public.list_community_reports(p_status text DEFAULT 'open')
RETURNS TABLE (
  content_type text,
  content_id uuid,
  report_ids uuid[],
  report_count integer,
  reasons text[],
  details text[],
  status text,
  first_reported_at timestamptz,
  last_reported_at timestamptz,
  headline text,
  body_preview text,
  author_name text,
  author_badge text,
  content_hidden_at timestamptz,
  can_hide boolean,
  reporter_ids uuid[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id uuid := public.working_organization_id();
  st text := coalesce(nullif(trim(p_status), ''), 'open');
  is_staff boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF org_id IS NULL THEN RAISE EXCEPTION 'no neighbourhood selected'; END IF;
  IF NOT public.can_moderate_resident_content(org_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF st NOT IN ('open', 'actioned', 'dismissed') THEN RAISE EXCEPTION 'unknown status'; END IF;
  is_staff := public.can_moderate_incidents();

  RETURN QUERY
  SELECT
    r.content_type,
    r.content_id,
    array_agg(r.id ORDER BY r.created_at),
    count(*)::integer,
    array_agg(DISTINCT r.reason),
    array_remove(array_agg(r.details ORDER BY r.created_at), NULL),
    st,
    min(r.created_at),
    max(r.created_at),
    max(
      CASE
        WHEN r.content_type = 'area_broadcast' THEN coalesce(nullif(trim(b.headline), ''), 'Neighbourhood notice')
        WHEN r.content_type = 'service_listing' THEN coalesce(nullif(trim(sl.title), ''), 'Service listing')
        WHEN r.content_type = 'service_review' THEN 'Service review'
        WHEN r.content_type = 'city_hub_post' THEN coalesce(nullif(trim(hp.title), ''), 'City Hub post')
        WHEN r.content_type = 'chat_message' THEN 'Chat message'
        WHEN r.content_type = 'user_profile' THEN coalesce(nullif(trim(tu.full_name), ''), 'Member')
        WHEN r.content_type = 'incident_report' THEN
          CASE
            WHEN inc.id IS NULL THEN 'Incident report (no longer available)'
            ELSE 'Incident report: ' || coalesce(nullif(trim(inc.type::text), ''), 'incident')
          END
        WHEN r.content_type = 'criminal_profile' THEN
          CASE
            WHEN cp.id IS NULL THEN 'Suspect profile (no longer available)'
            ELSE coalesce(nullif(trim(cp.primary_name::text), ''), 'Suspect profile')
          END
        ELSE NULL
      END
    ),
    max(
      CASE
        WHEN r.content_type = 'area_broadcast' THEN left(b.body, 280)
        WHEN r.content_type = 'service_listing' THEN left(sl.description, 280)
        WHEN r.content_type = 'service_review' THEN left(sr.body, 280)
        WHEN r.content_type = 'city_hub_post' THEN left(hp.content, 280)
        WHEN r.content_type = 'chat_message' THEN
          CASE
            WHEN cm.visibility = 'patrol' AND NOT public.is_chat_ops_member() THEN 'Preview hidden'
            ELSE left(cm.text, 280)
          END
        WHEN r.content_type = 'user_profile' THEN NULL
        WHEN r.content_type = 'incident_report' AND inc.id IS NOT NULL THEN left(inc.description::text, 280)
        WHEN r.content_type = 'criminal_profile' AND cp.id IS NOT NULL THEN nullif(concat_ws(', ',
          'Status: ' || nullif(trim(cp.status::text), ''),
          'Risk: ' || nullif(trim(cp.risk_level::text), '')
        ), '')
        ELSE NULL
      END
    ),
    max(
      CASE
        WHEN r.content_type = 'area_broadcast' THEN coalesce(nullif(trim(u.full_name), ''), 'Neighbourhood watch')
        WHEN r.content_type = 'service_listing' THEN coalesce(nullif(trim(slu.full_name), ''), 'Neighbour')
        WHEN r.content_type = 'service_review' THEN coalesce(nullif(trim(sru.full_name), ''), 'Neighbour')
        WHEN r.content_type = 'city_hub_post' THEN coalesce(nullif(trim(pu.full_name), ''), 'Author')
        WHEN r.content_type = 'chat_message' THEN coalesce(
          nullif(trim(cm.sender_name), ''),
          nullif(trim(smu.full_name), ''),
          'Sender'
        )
        WHEN r.content_type = 'user_profile' THEN coalesce(nullif(trim(tu.full_name), ''), 'Member')
        WHEN r.content_type = 'incident_report' AND inc.id IS NOT NULL THEN
          CASE
            WHEN coalesce(inc.is_anonymous_tip, false) THEN 'Anonymous tip'
            ELSE coalesce(nullif(trim(inc.submitted_by_name::text), ''), nullif(trim(incu.full_name), ''), 'Reporter')
          END
        WHEN r.content_type = 'criminal_profile' AND cp.id IS NOT NULL THEN
          coalesce(nullif(trim(cpu.full_name), ''), 'Creator')
        ELSE NULL
      END
    ),
    max(b.author_badge),
    max(
      CASE
        WHEN r.content_type = 'area_broadcast' THEN b.hidden_at
        WHEN r.content_type = 'service_listing' AND sl.status IN ('hidden', 'removed') THEN sl.moderated_at
        WHEN r.content_type = 'service_review' AND sr.status = 'hidden' THEN sr.updated_at
        WHEN r.content_type = 'city_hub_post' THEN hp.hidden_at
        ELSE NULL
      END
    ),
    bool_or(
      (r.content_type = 'area_broadcast' AND b.id IS NOT NULL
        AND (public.is_area_broadcast_staff() OR b.author_badge IS NOT NULL))
      OR (r.content_type = 'service_listing' AND sl.id IS NOT NULL)
      OR (r.content_type = 'service_review' AND sr.id IS NOT NULL)
      OR (r.content_type = 'city_hub_post' AND hp.id IS NOT NULL
        AND hp.status = 'published' AND hp.hidden_at IS NULL)
    ),
    CASE WHEN is_staff THEN array_remove(array_agg(r.reporter_user_id), NULL) ELSE NULL END
  FROM public.community_content_reports r
  LEFT JOIN public.area_broadcasts b
    ON r.content_type = 'area_broadcast' AND b.id = r.content_id AND b.organization_id = r.organization_id
  LEFT JOIN public.users u ON u.id = b.author_id
  LEFT JOIN public.local_service_listings sl
    ON r.content_type = 'service_listing' AND sl.id = r.content_id AND sl.organization_id = r.organization_id
  LEFT JOIN public.users slu ON slu.id = sl.owner_user_id
  LEFT JOIN public.local_service_reviews sr
    ON r.content_type = 'service_review' AND sr.id = r.content_id AND sr.organization_id = r.organization_id
  LEFT JOIN public.users sru ON sru.id = sr.reviewer_user_id
  LEFT JOIN public.city_hub_posts hp
    ON r.content_type = 'city_hub_post' AND hp.id = r.content_id AND hp.author_organization_id = r.organization_id
  LEFT JOIN public.users pu ON pu.id = hp.created_by_user_id
  LEFT JOIN public.chat_messages cm
    ON r.content_type = 'chat_message' AND cm.id = r.content_id AND cm.organization_id = r.organization_id
  LEFT JOIN public.users smu ON smu.id = cm.sender_id
  LEFT JOIN public.users tu
    ON r.content_type = 'user_profile' AND tu.id = r.content_id
  LEFT JOIN public.incidents inc
    ON r.content_type = 'incident_report' AND inc.id = r.content_id AND inc.organization_id = r.organization_id
  LEFT JOIN public.users incu
    ON inc.id IS NOT NULL AND incu.id::text = coalesce(inc.submitted_by::text, inc.reporter_id::text)
  LEFT JOIN public.criminal_profiles cp
    ON r.content_type = 'criminal_profile' AND cp.id = r.content_id AND cp.organization_id = r.organization_id
  LEFT JOIN public.users cpu
    ON cp.id IS NOT NULL AND cpu.id::text = cp.created_by::text
  WHERE r.organization_id = org_id
    AND r.status = st
    -- Suspect-profile reports are listed only to moderators who may read suspect profiles.
    AND (r.content_type <> 'criminal_profile' OR public.can_view_criminal_intelligence())
  GROUP BY r.content_type, r.content_id
  ORDER BY max(r.created_at) DESC
  LIMIT 100;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_community_report(
  p_report_id uuid,
  p_status text,
  p_note text DEFAULT NULL,
  p_hide_content boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.community_content_reports;
  cleaned_note text := nullif(trim(p_note), '');
  n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO r FROM public.community_content_reports WHERE id = p_report_id FOR UPDATE;
  IF r.id IS NULL OR r.organization_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'report not found';
  END IF;
  IF NOT public.can_moderate_resident_content(r.organization_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF r.content_type = 'criminal_profile' AND NOT public.can_view_criminal_intelligence() THEN
    RAISE EXCEPTION 'report not found';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('actioned', 'dismissed') THEN
    RAISE EXCEPTION 'status must be actioned or dismissed';
  END IF;
  IF cleaned_note IS NOT NULL AND char_length(cleaned_note) > 1000 THEN
    RAISE EXCEPTION 'note is too long';
  END IF;
  IF r.status <> 'open' THEN
    RAISE EXCEPTION 'report already handled';
  END IF;

  IF coalesce(p_hide_content, false) THEN
    IF r.content_type = 'area_broadcast' THEN
      PERFORM public.hide_area_broadcast(r.content_id, left(cleaned_note, 300));
    ELSIF r.content_type = 'service_listing' THEN
      PERFORM public.set_service_listing_status(r.content_id, 'hidden', left(coalesce(cleaned_note, 'Reported'), 300));
    ELSIF r.content_type = 'service_review' THEN
      PERFORM public.hide_service_review(r.content_id, left(coalesce(cleaned_note, 'Reported'), 300));
    ELSIF r.content_type = 'city_hub_post' THEN
      UPDATE public.city_hub_posts
      SET hidden_at = now(),
          hidden_by = auth.uid(),
          hidden_reason = left(coalesce(cleaned_note, 'Reported'), 300)
      WHERE id = r.content_id
        AND hidden_at IS NULL;
    ELSE
      RAISE EXCEPTION 'this content cannot be hidden yet';
    END IF;
  END IF;

  UPDATE public.community_content_reports
  SET status = p_status, handled_by = auth.uid(), handled_at = now(), resolution_note = cleaned_note
  WHERE content_type = r.content_type
    AND content_id = r.content_id
    AND organization_id = r.organization_id
    AND status = 'open';
  GET DIAGNOSTICS n = ROW_COUNT;

  PERFORM public.write_staff_activity(
    'content_report_resolved',
    jsonb_build_object(
      'content_type', r.content_type,
      'content_id', r.content_id,
      'status', p_status,
      'reports', n,
      'hidden', coalesce(p_hide_content, false),
      'note', cleaned_note
    ) || CASE WHEN NOT public.can_moderate_incidents()
              THEN jsonb_build_object('capability', 'resident_moderator')
              ELSE '{}'::jsonb END,
    auth.uid(),
    r.organization_id
  );

  RETURN n;
END;
$$;

-- 3) Grants (same as 20261117010000) --------------------------------------------
REVOKE ALL ON FUNCTION public.report_community_content(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_community_content(text, uuid, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_community_reports(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_community_reports(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.resolve_community_report(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_community_report(uuid, text, text, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- 4) Verification -----------------------------------------------------------------
DO $verify$
DECLARE
  missing text := '';
  check_def text;
  report_def text;
  list_def text;
  resolve_def text;
  v text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO check_def
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'community_content_reports'
    AND c.conname = 'community_content_reports_content_type_check';

  FOREACH v IN ARRAY ARRAY[
    'area_broadcast', 'service_listing', 'service_review', 'lost_found', 'event',
    'city_hub_post', 'chat_message', 'user_profile', 'incident_report', 'criminal_profile'
  ]
  LOOP
    IF check_def IS NULL OR check_def NOT LIKE '%''' || v || '''%' THEN
      missing := missing || 'content_type check ' || v || '; ';
    END IF;
  END LOOP;

  report_def := pg_get_functiondef('public.report_community_content(text, uuid, text, text)'::regprocedure);
  IF report_def IS NULL
     OR report_def NOT LIKE '%city_hub_post%'
     OR report_def NOT LIKE '%chat_message%'
     OR report_def NOT LIKE '%user_profile%'
     OR report_def NOT LIKE '%service_listing%'
     OR report_def NOT LIKE '%area_broadcast%' THEN
    missing := missing || 'report_community_content lost existing types; ';
  END IF;
  IF report_def IS NULL
     OR report_def NOT LIKE '%hidden_at IS NOT NULL%'
     OR report_def NOT LIKE '%can_moderate_resident_content%'
     OR report_def LIKE '%coalesce(u.organization_id, public.working_organization_id())%' THEN
    missing := missing || 'report_community_content existing guards; ';
  END IF;
  IF report_def IS NULL
     OR report_def NOT LIKE '%''incident_report''%'
     OR report_def NOT LIKE '%''criminal_profile''%'
     OR report_def NOT LIKE '%public.incidents i%'
     OR report_def NOT LIKE '%public.criminal_profiles cp%'
     OR report_def NOT LIKE '%NOT public.can_view_criminal_intelligence()%' THEN
    missing := missing || 'report_community_content incident/suspect branches; ';
  END IF;

  list_def := pg_get_functiondef('public.list_community_reports(text)'::regprocedure);
  IF list_def IS NULL
     OR list_def NOT LIKE '%Preview hidden%'
     OR list_def NOT LIKE '%cm.text%' THEN
    missing := missing || 'list_community_reports patrol preview guard; ';
  END IF;
  IF list_def IS NULL
     OR list_def NOT LIKE '%LEFT JOIN public.incidents inc%'
     OR list_def NOT LIKE '%LEFT JOIN public.criminal_profiles cp%'
     OR list_def NOT LIKE '%can_view_criminal_intelligence()%' THEN
    missing := missing || 'list_community_reports incident/suspect rows; ';
  END IF;

  resolve_def := pg_get_functiondef('public.resolve_community_report(uuid, text, text, boolean)'::regprocedure);
  IF resolve_def IS NULL
     OR resolve_def NOT LIKE '%hide_area_broadcast%'
     OR resolve_def NOT LIKE '%hidden_reason = left(coalesce(cleaned_note, ''Reported''), 300)%'
     OR resolve_def NOT LIKE '%cannot be hidden yet%' THEN
    missing := missing || 'resolve_community_report existing hide branches; ';
  END IF;
  IF resolve_def IS NULL
     OR resolve_def NOT LIKE '%''criminal_profile'' AND NOT public.can_view_criminal_intelligence()%' THEN
    missing := missing || 'resolve_community_report suspect guard; ';
  END IF;

  IF has_function_privilege('anon', 'public.report_community_content(text, uuid, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.list_community_reports(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.resolve_community_report(uuid, text, text, boolean)', 'EXECUTE') THEN
    missing := missing || 'anon can execute report RPCs; ';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.report_community_content(text, uuid, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.list_community_reports(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.resolve_community_report(uuid, text, text, boolean)', 'EXECUTE') THEN
    missing := missing || 'authenticated cannot execute report RPCs; ';
  END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION 'Reports for incidents and suspect profiles: verification failed: %', missing;
  END IF;

  RAISE NOTICE 'Reports for incidents and suspect profiles: OK (incident_report, criminal_profile).';
END
$verify$;
