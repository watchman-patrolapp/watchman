-- P-UGC — In-context reports for City Hub posts, chat messages, and user profiles.
-- Additive, idempotent. Do not edit shipped migrations.
-- Extends public.community_content_reports and the existing RPCs:
--   report_community_content, list_community_reports, resolve_community_report
-- New helpers: restore_hidden_city_hub_post, list_hidden_city_hub_posts
-- City Hub hide uses hidden_at/hidden_by/hidden_reason, NOT archive and NOT a 'hidden' status.

-- =====================================================================
-- 1) Widen community_content_reports content_type CHECK
-- =====================================================================
ALTER TABLE public.community_content_reports
  DROP CONSTRAINT IF EXISTS community_content_reports_content_type_check;

ALTER TABLE public.community_content_reports
  ADD CONSTRAINT community_content_reports_content_type_check
  CHECK (content_type IN (
    'area_broadcast', 'service_listing', 'service_review',
    'lost_found', 'event',
    'city_hub_post', 'chat_message', 'user_profile'
  ));

-- =====================================================================
-- 2) City Hub moderator-hide columns (distinct from archive)
-- =====================================================================
ALTER TABLE public.city_hub_posts
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hidden_reason text;

-- =====================================================================
-- 3) Recreate city_hub_posts_select: keep existing read rules, add hidden_at
-- =====================================================================
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
          'security_admin',
          'city_admin'
        )
    )
    AND (
      hidden_at IS NULL
      OR public.can_moderate_resident_content(author_organization_id)
      OR public.can_manage_city_hub_post(created_by_user_id)
    )
  );

-- =====================================================================
-- 4) Recreate report / list / resolve RPCs (keep existing branches)
-- =====================================================================
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
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_content_type IS NULL OR p_content_type NOT IN (
    'area_broadcast', 'service_listing', 'service_review',
    'city_hub_post', 'chat_message', 'user_profile'
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
      SELECT coalesce(u.organization_id, public.working_organization_id())
      FROM public.users u
      WHERE u.id = p_content_id
    )
    ELSE NULL
  END;

  IF org_id IS NULL THEN
    RAISE EXCEPTION 'content not found';
  END IF;

  IF p_content_type = 'city_hub_post' THEN
    SELECT * INTO post_row FROM public.city_hub_posts WHERE id = p_content_id;
    IF post_row.id IS NULL OR post_row.status <> 'published' OR NOT public.can_view_city_hub() THEN
      RAISE EXCEPTION 'content not found';
    END IF;
    IF post_row.created_by_user_id = auth.uid() THEN
      RAISE EXCEPTION 'you cannot report your own content';
    END IF;
  ELSIF p_content_type = 'chat_message' THEN
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
    IF org_id NOT IN (SELECT public.current_org_ids()) THEN
      IF NOT public.can_view_city_hub()
         OR NOT EXISTS (
           SELECT 1
           FROM public.city_hub_posts p
           WHERE p.created_by_user_id = p_content_id
             AND p.status = 'published'
             AND p.hidden_at IS NULL
         ) THEN
        RAISE EXCEPTION 'content not found';
      END IF;
    END IF;
  ELSIF org_id NOT IN (SELECT public.current_org_ids()) THEN
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

  FOR mod_id IN
    SELECT DISTINCT g.user_id FROM public.org_capability_grants g
    WHERE g.organization_id = org_id
      AND g.capability = 'resident_moderator'
      AND g.revoked_at IS NULL
      AND (g.expires_at IS NULL OR g.expires_at > now())
      AND g.user_id <> auth.uid()
  LOOP
    PERFORM public.notify_app_user(
      mod_id, 'moderation', 'New report to review',
      replace(p_content_type, '_', ' ') || ' - ' || replace(p_reason, '_', ' '),
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
  WHERE r.organization_id = org_id
    AND r.status = st
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

-- =====================================================================
-- 5) Restore / list hidden City Hub posts
-- =====================================================================
CREATE OR REPLACE FUNCTION public.restore_hidden_city_hub_post(p_post_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  post_row public.city_hub_posts;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO post_row FROM public.city_hub_posts WHERE id = p_post_id;
  IF post_row.id IS NULL
     OR post_row.author_organization_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'not found';
  END IF;
  IF NOT public.can_moderate_resident_content(post_row.author_organization_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.city_hub_posts
  SET hidden_at = NULL,
      hidden_by = NULL,
      hidden_reason = NULL
  WHERE id = post_row.id;

  RETURN post_row.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_hidden_city_hub_posts(p_limit integer DEFAULT 30)
RETURNS TABLE (
  id uuid,
  title text,
  content_preview text,
  author_name text,
  hidden_at timestamptz,
  hidden_reason text,
  hidden_by uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id uuid := public.working_organization_id();
  lim integer := greatest(1, least(coalesce(p_limit, 30), 100));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF org_id IS NULL THEN RAISE EXCEPTION 'no neighbourhood selected'; END IF;
  IF NOT public.can_moderate_resident_content(org_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.title,
    left(p.content, 280),
    coalesce(nullif(trim(pu.full_name), ''), 'Author'),
    p.hidden_at,
    p.hidden_reason,
    p.hidden_by
  FROM public.city_hub_posts p
  LEFT JOIN public.users pu ON pu.id = p.created_by_user_id
  WHERE p.hidden_at IS NOT NULL
    AND p.author_organization_id = org_id
  ORDER BY p.hidden_at DESC
  LIMIT lim;
END;
$$;

-- =====================================================================
-- 6) Grants (only functions this migration creates or replaces)
-- =====================================================================
REVOKE ALL ON FUNCTION public.report_community_content(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_community_content(text, uuid, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_community_reports(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_community_reports(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.resolve_community_report(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_community_report(uuid, text, text, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.restore_hidden_city_hub_post(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_hidden_city_hub_post(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_hidden_city_hub_posts(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_hidden_city_hub_posts(integer) TO authenticated, service_role;

-- =====================================================================
-- 7) Verification
-- =====================================================================
DO $$
DECLARE
  missing text := '';
  check_def text;
  fn_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO check_def
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'community_content_reports'
    AND c.conname = 'community_content_reports_content_type_check';

  IF check_def IS NULL
     OR check_def NOT LIKE '%city_hub_post%'
     OR check_def NOT LIKE '%chat_message%'
     OR check_def NOT LIKE '%user_profile%'
     OR check_def NOT LIKE '%area_broadcast%'
     OR check_def NOT LIKE '%service_listing%' THEN
    missing := missing || 'content_type check; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
    WHERE nsp.nspname = 'public'
      AND c.relname = 'city_hub_posts'
      AND a.attname = 'hidden_at'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    missing := missing || 'city_hub_posts.hidden_at; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
    WHERE nsp.nspname = 'public' AND p.proname = 'report_community_content'
  ) THEN
    missing := missing || 'report_community_content; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
    WHERE nsp.nspname = 'public' AND p.proname = 'list_community_reports'
  ) THEN
    missing := missing || 'list_community_reports; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
    WHERE nsp.nspname = 'public' AND p.proname = 'resolve_community_report'
  ) THEN
    missing := missing || 'resolve_community_report; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
    WHERE nsp.nspname = 'public' AND p.proname = 'restore_hidden_city_hub_post'
  ) THEN
    missing := missing || 'restore_hidden_city_hub_post; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
    WHERE nsp.nspname = 'public' AND p.proname = 'list_hidden_city_hub_posts'
  ) THEN
    missing := missing || 'list_hidden_city_hub_posts; ';
  END IF;

  fn_def := pg_get_functiondef('public.report_community_content(text, uuid, text, text)'::regprocedure);
  IF fn_def IS NULL
     OR fn_def NOT LIKE '%city_hub_post%'
     OR fn_def NOT LIKE '%chat_message%'
     OR fn_def NOT LIKE '%user_profile%' THEN
    missing := missing || 'report_community_content missing new types; ';
  END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION 'P-UGC verification failed: %', missing;
  END IF;

  RAISE NOTICE 'P-UGC: OK (city_hub_post, chat_message, user_profile reports; hidden_at hide/restore).';
END;
$$;
