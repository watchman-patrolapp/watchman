-- SOS must reach patrollers on duty, not only admin-panel users.
-- Allow patrol responders to acknowledge alerts in their neighborhood.
-- Accept hold-to-activate as a trigger type (resident SOS button).

ALTER TABLE public.sos_alerts
  ADD COLUMN IF NOT EXISTS acknowledged_by_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;

ALTER TABLE public.sos_alerts DROP CONSTRAINT IF EXISTS sos_alerts_trigger_type_check;
ALTER TABLE public.sos_alerts
  ADD CONSTRAINT sos_alerts_trigger_type_check
  CHECK (trigger_type IN ('button', 'voice_command', 'timer_expired', 'hold'));

CREATE OR REPLACE FUNCTION public.is_sos_responder()
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
          'patroller',
          'volunteer',
          'investigator'
        )
    );
$$;

REVOKE ALL ON FUNCTION public.is_sos_responder() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_sos_responder() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_sos_responder() TO service_role;

DROP POLICY IF EXISTS sos_alerts_write_org ON public.sos_alerts;
DROP POLICY IF EXISTS sos_alerts_insert_self ON public.sos_alerts;
DROP POLICY IF EXISTS sos_alerts_update_responders ON public.sos_alerts;

CREATE POLICY sos_alerts_insert_self ON public.sos_alerts
  FOR INSERT TO authenticated
  WITH CHECK (
    resident_id = auth.uid()
    OR public.is_sos_responder()
  );

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
  );
