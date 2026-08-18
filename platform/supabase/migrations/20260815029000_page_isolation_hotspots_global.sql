-- City Hub and Hotspots stay city-wide.
-- Every other neighborhood table is locked to the working organization.

-- ---------------------------------------------------------------------------
-- Hotspots + cameras: restore authenticated city-wide read/write for staff
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS stamp_working_organization_id ON public.hotspot_events;
DROP TRIGGER IF EXISTS stamp_working_organization_id ON public.camera_spots;

DROP POLICY IF EXISTS hotspot_events_select_org ON public.hotspot_events;
DROP POLICY IF EXISTS hotspot_events_select_authenticated ON public.hotspot_events;
CREATE POLICY hotspot_events_select_authenticated
  ON public.hotspot_events
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS hotspot_events_insert_staff ON public.hotspot_events;
CREATE POLICY hotspot_events_insert_staff
  ON public.hotspot_events
  FOR INSERT TO authenticated
  WITH CHECK (public.is_hotspot_staff() AND created_by = auth.uid());

DROP POLICY IF EXISTS hotspot_events_update_staff ON public.hotspot_events;
CREATE POLICY hotspot_events_update_staff
  ON public.hotspot_events
  FOR UPDATE TO authenticated
  USING (public.is_hotspot_staff())
  WITH CHECK (public.is_hotspot_staff());

DROP POLICY IF EXISTS hotspot_events_delete_staff ON public.hotspot_events;
CREATE POLICY hotspot_events_delete_staff
  ON public.hotspot_events
  FOR DELETE TO authenticated
  USING (public.is_hotspot_staff());

DROP POLICY IF EXISTS camera_spots_select_org ON public.camera_spots;
DROP POLICY IF EXISTS camera_spots_select_authenticated ON public.camera_spots;
CREATE POLICY camera_spots_select_authenticated
  ON public.camera_spots
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS camera_spots_insert_staff ON public.camera_spots;
CREATE POLICY camera_spots_insert_staff
  ON public.camera_spots
  FOR INSERT TO authenticated
  WITH CHECK (public.is_hotspot_staff() AND created_by = auth.uid());

DROP POLICY IF EXISTS camera_spots_update_staff ON public.camera_spots;
CREATE POLICY camera_spots_update_staff
  ON public.camera_spots
  FOR UPDATE TO authenticated
  USING (public.is_hotspot_staff())
  WITH CHECK (public.is_hotspot_staff());

DROP POLICY IF EXISTS camera_spots_delete_staff ON public.camera_spots;
CREATE POLICY camera_spots_delete_staff
  ON public.camera_spots
  FOR DELETE TO authenticated
  USING (public.is_hotspot_staff());

-- ---------------------------------------------------------------------------
-- Ensure org columns exist on remaining neighborhood tables
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'patrol_routes') THEN
    ALTER TABLE public.patrol_routes
      ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profile_match_queue') THEN
    ALTER TABLE public.profile_match_queue
      ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'resident_report_events') THEN
    ALTER TABLE public.resident_report_events
      ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sos_alerts') THEN
    ALTER TABLE public.sos_alerts
      ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations (id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
DECLARE
  v_legacy_org_id uuid;
BEGIN
  SELECT id INTO v_legacy_org_id
  FROM public.organizations
  WHERE lower(name) = 'theescombe neighborhood watch'
  LIMIT 1;
  IF v_legacy_org_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patrol_slots' AND column_name='organization_id') THEN
    UPDATE public.patrol_slots SET organization_id = v_legacy_org_id WHERE organization_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patrol_logs' AND column_name='organization_id') THEN
    UPDATE public.patrol_logs SET organization_id = v_legacy_org_id WHERE organization_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='active_patrols' AND column_name='organization_id') THEN
    UPDATE public.active_patrols SET organization_id = v_legacy_org_id WHERE organization_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patrol_locations' AND column_name='organization_id') THEN
    UPDATE public.patrol_locations SET organization_id = v_legacy_org_id WHERE organization_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patrol_routes' AND column_name='organization_id') THEN
    UPDATE public.patrol_routes SET organization_id = v_legacy_org_id WHERE organization_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='chat_messages' AND column_name='organization_id') THEN
    UPDATE public.chat_messages SET organization_id = v_legacy_org_id WHERE organization_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='feedback' AND column_name='organization_id') THEN
    UPDATE public.feedback SET organization_id = v_legacy_org_id WHERE organization_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profile_match_queue' AND column_name='organization_id') THEN
    UPDATE public.profile_match_queue SET organization_id = v_legacy_org_id WHERE organization_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='resident_report_events' AND column_name='organization_id') THEN
    UPDATE public.resident_report_events SET organization_id = v_legacy_org_id WHERE organization_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sos_alerts' AND column_name='organization_id') THEN
    UPDATE public.sos_alerts SET organization_id = v_legacy_org_id WHERE organization_id IS NULL;
  END IF;
END $$;

-- Stamp new neighborhood rows with the working area (not Hotspots).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'incidents',
    'criminal_profiles',
    'profile_incidents',
    'profile_match_queue',
    'patrol_logs',
    'patrol_slots',
    'active_patrols',
    'patrol_locations',
    'patrol_routes',
    'chat_messages',
    'feedback',
    'sos_alerts',
    'resident_report_events'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'organization_id'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS stamp_working_organization_id ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER stamp_working_organization_id BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.stamp_working_organization_id()',
        t
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Org-only RLS for neighborhood operational tables
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  r record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'patrol_slots',
    'patrol_logs',
    'active_patrols',
    'patrol_locations',
    'patrol_routes',
    'chat_messages',
    'profile_match_queue',
    'resident_report_events',
    'sos_alerts'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'organization_id'
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    FOR r IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (organization_id IN (SELECT public.current_org_ids()))',
      t || '_select_org',
      t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (organization_id IN (SELECT public.current_org_ids()))',
      t || '_insert_org',
      t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (organization_id IN (SELECT public.current_org_ids())) WITH CHECK (organization_id IN (SELECT public.current_org_ids()))',
      t || '_update_org',
      t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (organization_id IN (SELECT public.current_org_ids()))',
      t || '_delete_org',
      t
    );
  END LOOP;
END $$;

-- Feedback remains readable/updatable only by technical support, still org-scoped.
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'feedback'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.feedback', r.policyname);
  END LOOP;
END $$;

CREATE POLICY feedback_insert_org ON public.feedback
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT public.current_org_ids())
    OR organization_id IS NULL
  );

CREATE POLICY feedback_select_technical_support ON public.feedback
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT public.current_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND lower(trim(cu.role::text)) = 'technical_support'
    )
  );

CREATE POLICY feedback_update_technical_support ON public.feedback
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (SELECT public.current_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND lower(trim(cu.role::text)) = 'technical_support'
    )
  )
  WITH CHECK (
    organization_id IN (SELECT public.current_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.users cu
      WHERE cu.id = auth.uid()
        AND lower(trim(cu.role::text)) = 'technical_support'
    )
  );

-- Chat unread / mark-read must not treat NULL org as city-wide.
CREATE OR REPLACE FUNCTION public.chat_unread_for_me(p_organization_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH boundary AS (
    SELECT COALESCE(
      (SELECT m.created_at
       FROM public.chat_messages m
       JOIN public.chat_read_state crs ON crs.user_id = auth.uid() AND m.id::text = crs.last_read_message_id::text),
      (SELECT crs2.last_read_at FROM public.chat_read_state crs2 WHERE crs2.user_id = auth.uid()),
      '-infinity'::timestamptz
    ) AS t
  ),
  allowed_org AS (
    SELECT COALESCE(p_organization_id, public.working_organization_id()) AS org_id
  )
  SELECT count(*)::int
  FROM public.chat_messages cm, boundary b, allowed_org ao
  WHERE cm.sender_id::text IS DISTINCT FROM auth.uid()::text
    AND cm.expires_at > now()
    AND cm.created_at > b.t
    AND ao.org_id IS NOT NULL
    AND cm.organization_id = ao.org_id;
$$;

CREATE OR REPLACE FUNCTION public.chat_mark_read(p_message_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  mid uuid;
  mts timestamptz;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_message_id IS NOT NULL THEN
    SELECT id, created_at INTO mid, mts
    FROM public.chat_messages
    WHERE id = p_message_id
      AND expires_at > now()
      AND organization_id IN (SELECT public.current_org_ids());
    IF mid IS NULL THEN
      RETURN;
    END IF;
  ELSE
    SELECT id, created_at INTO mid, mts
    FROM public.chat_messages
    WHERE expires_at > now()
      AND organization_id IN (SELECT public.current_org_ids())
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  INSERT INTO public.chat_read_state (user_id, last_read_message_id, last_read_at, updated_at)
  VALUES (uid, mid, COALESCE(mts, now()), now())
  ON CONFLICT (user_id) DO UPDATE SET
    last_read_message_id = EXCLUDED.last_read_message_id,
    last_read_at = EXCLUDED.last_read_at,
    updated_at = now();
END;
$$;
