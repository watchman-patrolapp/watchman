-- Admin, technical support, and neighborhood watch admin can remove SOS history
-- (false alarms, accidental hold-to-activate by elderly residents).

CREATE OR REPLACE FUNCTION public.is_sos_history_manager()
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
          'nw_admin'
        )
    );
$$;

REVOKE ALL ON FUNCTION public.is_sos_history_manager() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_sos_history_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_sos_history_manager() TO service_role;

DROP POLICY IF EXISTS sos_alerts_delete_managers ON public.sos_alerts;
CREATE POLICY sos_alerts_delete_managers ON public.sos_alerts
  FOR DELETE TO authenticated
  USING (
    public.is_sos_history_manager()
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
  );

CREATE OR REPLACE FUNCTION public.delete_sos_board_alert(p_alert_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alert public.sos_alerts%ROWTYPE;
  v_incident_id uuid;
  v_incident_type text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_sos_history_manager() THEN
    RAISE EXCEPTION 'forbidden: admin, technical support, or neighborhood admin required';
  END IF;

  SELECT * INTO v_alert
  FROM public.sos_alerts
  WHERE id = p_alert_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SOS alert not found';
  END IF;

  IF NOT public.is_global_app_staff() AND NOT public.is_platform_staff() THEN
    IF NOT (
      v_alert.organization_id IN (SELECT public.current_org_ids())
      OR EXISTS (
        SELECT 1
        FROM public.incidents i
        WHERE i.id = v_alert.incident_id
          AND i.organization_id IN (SELECT public.current_org_ids())
      )
    ) THEN
      RAISE EXCEPTION 'forbidden: SOS is outside your neighborhood';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'chat_messages'
  ) THEN
    DELETE FROM public.chat_messages
    WHERE sender_id = v_alert.resident_id
      AND created_at BETWEEN v_alert.created_at - interval '5 minutes'
                         AND v_alert.created_at + interval '5 minutes'
      AND upper(left(trim(coalesce(text, '')), 3)) = 'SOS';
  END IF;

  v_incident_id := v_alert.incident_id;
  DELETE FROM public.sos_alerts WHERE id = p_alert_id;

  IF v_incident_id IS NULL THEN
    RETURN;
  END IF;

  SELECT type INTO v_incident_type FROM public.incidents WHERE id = v_incident_id;
  IF upper(trim(coalesce(v_incident_type, ''))) <> 'SOS' THEN
    RETURN;
  END IF;

  DELETE FROM public.profile_match_queue
  WHERE source_incident_id = v_incident_id
     OR source_evidence_id IN (
       SELECT id FROM public.incident_evidence WHERE incident_id = v_incident_id
     );
  DELETE FROM public.incident_evidence WHERE incident_id = v_incident_id;
  DELETE FROM public.incident_suspects WHERE incident_id = v_incident_id;
  DELETE FROM public.profile_incidents WHERE incident_id = v_incident_id;
  DELETE FROM public.incidents WHERE id = v_incident_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_sos_board_alert(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_sos_board_alert(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_sos_board_alert(uuid) TO service_role;
