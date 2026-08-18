-- Residents must be able to read their own activity reports even if org
-- membership is incomplete. Also recreate the report timeline table if 25000
-- was skipped (the list page used to fail hard when that table was missing).

DROP POLICY IF EXISTS incidents_select_own ON public.incidents;
CREATE POLICY incidents_select_own ON public.incidents
  FOR SELECT TO authenticated
  USING (
    reporter_id::text = auth.uid()::text
    OR submitted_by::text = auth.uid()::text
  );

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
    reporter_id::text = auth.uid()::text
    OR EXISTS (
      SELECT 1
      FROM public.incidents i
      JOIN public.users cu ON cu.id::text = auth.uid()::text
      WHERE i.id = resident_report_events.incident_id
        AND i.organization_id IN (SELECT public.current_org_ids())
        AND public.is_staff_role(cu.role::text)
    )
  );

NOTIFY pgrst, 'reload schema';
