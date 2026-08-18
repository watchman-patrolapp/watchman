-- Confirmed break-in / attempted break-in pins (hotspots) and community CCTV registry.
-- Members can read; admin / committee / technical_support can write.

CREATE TABLE IF NOT EXISTS public.hotspot_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('break_in', 'attempted_break_in')),
  address text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  occurred_at timestamptz NOT NULL,
  time_known boolean NOT NULL DEFAULT true,
  notes text,
  incident_id uuid REFERENCES public.incidents (id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hotspot_events_occurred_at ON public.hotspot_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_hotspot_events_kind ON public.hotspot_events (kind);
CREATE INDEX IF NOT EXISTS idx_hotspot_events_incident_id ON public.hotspot_events (incident_id);

COMMENT ON TABLE public.hotspot_events IS
  'Confirmed or attempted break-ins plotted on the Hotspots map. Separate from full incident reports.';

CREATE TABLE IF NOT EXISTS public.camera_spots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  facing_bearing double precision CHECK (facing_bearing IS NULL OR (facing_bearing >= 0 AND facing_bearing < 360)),
  range_meters integer NOT NULL DEFAULT 50 CHECK (range_meters BETWEEN 10 AND 300),
  notes text,
  created_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_camera_spots_created_at ON public.camera_spots (created_at DESC);

COMMENT ON TABLE public.camera_spots IS
  'Community CCTV registry for local (no-LLM) footage-time suggestions on hotspot pins.';

CREATE TABLE IF NOT EXISTS public.hotspot_camera_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotspot_event_id uuid NOT NULL REFERENCES public.hotspot_events (id) ON DELETE CASCADE,
  camera_spot_id uuid NOT NULL REFERENCES public.camera_spots (id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('checked', 'useful', 'nothing')),
  created_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotspot_event_id, camera_spot_id, created_by)
);

CREATE INDEX IF NOT EXISTS idx_hotspot_camera_checks_event ON public.hotspot_camera_checks (hotspot_event_id);

COMMENT ON TABLE public.hotspot_camera_checks IS
  'Human review of suggested cameras for a hotspot (checked / useful / nothing).';

ALTER TABLE public.hotspot_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.camera_spots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotspot_camera_checks ENABLE ROW LEVEL SECURITY;

-- Staff helper: admin, committee, technical_support (matches canStaffManageIncidents).
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
      AND lower(trim(u.role::text)) IN ('admin', 'committee', 'technical_support')
  );
$$;

REVOKE ALL ON FUNCTION public.is_hotspot_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_hotspot_staff() TO authenticated;

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

DROP POLICY IF EXISTS hotspot_camera_checks_select_authenticated ON public.hotspot_camera_checks;
CREATE POLICY hotspot_camera_checks_select_authenticated
  ON public.hotspot_camera_checks
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS hotspot_camera_checks_insert_own ON public.hotspot_camera_checks;
CREATE POLICY hotspot_camera_checks_insert_own
  ON public.hotspot_camera_checks
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS hotspot_camera_checks_update_own ON public.hotspot_camera_checks;
CREATE POLICY hotspot_camera_checks_update_own
  ON public.hotspot_camera_checks
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS hotspot_camera_checks_delete_own ON public.hotspot_camera_checks;
CREATE POLICY hotspot_camera_checks_delete_own
  ON public.hotspot_camera_checks
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hotspot_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.camera_spots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hotspot_camera_checks TO authenticated;
