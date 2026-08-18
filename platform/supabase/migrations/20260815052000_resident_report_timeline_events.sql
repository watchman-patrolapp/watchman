-- Allow residents and staff to write acknowledgement timeline rows.
-- 51000 created the table + SELECT policy but not INSERT policies.

DROP POLICY IF EXISTS resident_report_events_insert_reporter ON public.resident_report_events;
CREATE POLICY resident_report_events_insert_reporter ON public.resident_report_events
  FOR INSERT TO authenticated
  WITH CHECK (
    reporter_id::text = auth.uid()::text
    AND event_type = 'received'
    AND EXISTS (
      SELECT 1
      FROM public.incidents i
      WHERE i.id = resident_report_events.incident_id
        AND (
          i.reporter_id::text = auth.uid()::text
          OR i.submitted_by::text = auth.uid()::text
        )
    )
  );

DROP POLICY IF EXISTS resident_report_events_insert_staff ON public.resident_report_events;
CREATE POLICY resident_report_events_insert_staff ON public.resident_report_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_global_app_staff()
    OR public.is_platform_staff()
    OR EXISTS (
      SELECT 1
      FROM public.incidents i
      JOIN public.users cu ON cu.id::text = auth.uid()::text
      WHERE i.id = resident_report_events.incident_id
        AND i.organization_id IN (SELECT public.current_org_ids())
        AND public.is_staff_role(cu.role::text)
    )
  );

-- Backfill received + approved/rejected for reports that have no timeline yet.
INSERT INTO public.resident_report_events (
  incident_id,
  reporter_id,
  event_type,
  title,
  details,
  created_at
)
SELECT
  i.id,
  i.reporter_id,
  'received',
  'Report received',
  'Your report was submitted to patrol.',
  coalesce(i.incident_date, now())
FROM public.incidents i
WHERE i.reporter_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.resident_report_events e
    WHERE e.incident_id = i.id
      AND e.event_type = 'received'
  );

INSERT INTO public.resident_report_events (
  incident_id,
  reporter_id,
  event_type,
  title,
  details,
  created_at
)
SELECT
  i.id,
  i.reporter_id,
  'resolved',
  CASE
    WHEN lower(trim(coalesce(i.status, ''))) = 'approved' THEN 'Logged for patrol'
    ELSE 'Not accepted'
  END,
  CASE
    WHEN lower(trim(coalesce(i.status, ''))) = 'approved'
      THEN 'Your report was reviewed and approved.'
    ELSE 'Your report was reviewed and closed.'
  END,
  coalesce(i.incident_date, now())
FROM public.incidents i
WHERE i.reporter_id IS NOT NULL
  AND lower(trim(coalesce(i.status, ''))) IN ('approved', 'rejected')
  AND NOT EXISTS (
    SELECT 1
    FROM public.resident_report_events e
    WHERE e.incident_id = i.id
      AND e.event_type = 'resolved'
  );
