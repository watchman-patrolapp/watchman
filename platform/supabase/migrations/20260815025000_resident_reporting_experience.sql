-- Resident reporting enhancements:
-- 1) Anonymous tip metadata on incidents
-- 2) Acknowledgement timeline events for resident reports

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS is_anonymous_tip boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS legal_acknowledged_at timestamptz;

CREATE TABLE IF NOT EXISTS public.resident_report_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.incidents (id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('received', 'assigned', 'resolved', 'status_changed')),
  title text NOT NULL,
  details text,
  actor_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resident_report_events_incident_id
  ON public.resident_report_events (incident_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_resident_report_events_reporter_id
  ON public.resident_report_events (reporter_id, created_at DESC);

ALTER TABLE public.resident_report_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS resident_report_events_select_scope ON public.resident_report_events;
CREATE POLICY resident_report_events_select_scope ON public.resident_report_events
  FOR SELECT TO authenticated
  USING (
    reporter_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.incidents i
      JOIN public.users cu ON cu.id = auth.uid()
      WHERE i.id = resident_report_events.incident_id
        AND i.organization_id IN (SELECT public.current_org_ids())
        AND public.is_staff_role(cu.role::text)
    )
  );

DROP POLICY IF EXISTS resident_report_events_insert_reporter ON public.resident_report_events;
CREATE POLICY resident_report_events_insert_reporter ON public.resident_report_events
  FOR INSERT TO authenticated
  WITH CHECK (
    reporter_id = auth.uid()
    AND event_type = 'received'
    AND EXISTS (
      SELECT 1
      FROM public.incidents i
      WHERE i.id = resident_report_events.incident_id
        AND i.reporter_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS resident_report_events_insert_staff ON public.resident_report_events;
CREATE POLICY resident_report_events_insert_staff ON public.resident_report_events
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.incidents i
      JOIN public.users cu ON cu.id = auth.uid()
      WHERE i.id = resident_report_events.incident_id
        AND i.organization_id IN (SELECT public.current_org_ids())
        AND public.is_staff_role(cu.role::text)
    )
  );
