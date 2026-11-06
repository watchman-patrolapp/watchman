-- =============================================================================
-- P3c - Overdue escalation and the housekeeping timer. Additive.
-- Borrower is told when a loan goes overdue. Equipment custodians are told
-- 2 hours later. NW admins are told after 24 hours (kind
-- equipment_overdue_escalation, which cannot be muted).
-- equipment_sweep() runs the same work for the caller's neighbourhood.
-- run_equipment_housekeeping() is for pg_cron / service_role only.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.equipment_notify_custodians(
  p_org uuid, p_title text, p_body text, p_href text, p_skip uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  m uuid;
BEGIN
  FOR m IN
    SELECT DISTINCT g.user_id
    FROM public.org_capability_grants g
    WHERE g.organization_id = p_org
      AND g.capability = 'equipment_custodian'
      AND g.revoked_at IS NULL
      AND (g.expires_at IS NULL OR g.expires_at > now())
      AND g.user_id IS DISTINCT FROM auth.uid()
      AND g.user_id IS DISTINCT FROM p_skip
      AND public.user_in_org(g.user_id, p_org)
  LOOP
    PERFORM public.notify_app_user(m, 'equipment', left(p_title, 160), left(p_body, 500), p_href);
  END LOOP;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.equipment_notify_nw_admins(
  p_org uuid, p_title text, p_body text, p_href text, p_skip uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  m uuid;
BEGIN
  FOR m IN
    SELECT u.id FROM public.users u
    WHERE replace(lower(trim(u.role::text)), '-', '_') = 'nw_admin'
      AND public.user_in_org(u.id, p_org)
      AND u.id IS DISTINCT FROM auth.uid()
      AND u.id IS DISTINCT FROM p_skip
  LOOP
    PERFORM public.notify_app_user(m, 'equipment_overdue_escalation', left(p_title, 160), left(p_body, 500), p_href);
  END LOOP;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.equipment_housekeeping_org(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r record;
  n_exp int := 0;
  n_tr int := 0;
  n_over int := 0;
  n_cus int := 0;
  n_adm int := 0;
  n_cas int := 0;
  v_level int;
  v_name text;
BEGIN
  IF p_org IS NULL THEN RETURN jsonb_build_object('expired_requests', 0, 'expired_transfers', 0, 'overdue', 0); END IF;
  FOR r IN SELECT l.* FROM public.equipment_loans l
           WHERE l.organization_id = p_org AND l.status IN ('requested', 'approved')
             AND coalesce(l.decided_at, l.created_at) < now() - interval '7 days'
           FOR UPDATE SKIP LOCKED LOOP
    IF r.status = 'approved' AND r.unit_id IS NOT NULL
       AND (SELECT status FROM public.equipment_units WHERE id = r.unit_id) = 'reserved' THEN
      PERFORM public.equipment_set_unit_status_ex(r.unit_id, 'available', NULL, 'not collected within 7 days',
        jsonb_build_object('loan_id', r.id, 'action', 'expire'));
    END IF;
    UPDATE public.equipment_loans SET status = 'expired', ended_at = now(), updated_at = now() WHERE id = r.id;
    n_exp := n_exp + 1;
  END LOOP;
  FOR r IN SELECT t.id FROM public.equipment_transfers t
           WHERE t.organization_id = p_org AND t.status = 'requested'
             AND coalesce(t.respond_by, t.created_at + interval '12 hours') < now()
           FOR UPDATE SKIP LOCKED LOOP
    PERFORM public.equipment_abort_handover(r.id, 'accept window');
    n_tr := n_tr + 1;
  END LOOP;
  FOR r IN SELECT t.id FROM public.equipment_transfers t
           WHERE t.organization_id = p_org AND t.status = 'accepted' AND t.handover_by < now()
           FOR UPDATE SKIP LOCKED LOOP
    PERFORM public.equipment_abort_handover(r.id, 'hand-over window');
    n_tr := n_tr + 1;
  END LOOP;
  FOR r IN SELECT l.*, i.name AS item_name FROM public.equipment_loans l
           JOIN public.equipment_units u ON u.id = l.unit_id
           JOIN public.equipment_items i ON i.id = l.item_id
           WHERE l.organization_id = p_org AND l.status = 'active' AND l.due_at < now() AND u.status = 'checked_out'
           FOR UPDATE OF l SKIP LOCKED LOOP
    PERFORM public.equipment_set_unit_status_ex(r.unit_id, 'overdue', r.requester_id, 'past agreed return time',
      jsonb_build_object('loan_id', r.id, 'action', 'overdue', 'due_at', r.due_at));
    UPDATE public.equipment_transfers SET status = 'expired', responded_at = now()
     WHERE unit_id = r.unit_id AND status = 'requested';
    IF r.overdue_notified_at IS NULL THEN
      UPDATE public.equipment_loans
         SET overdue_notified_at = now(), escalation_level = 1, updated_at = now()
       WHERE id = r.id;
      PERFORM public.equipment_notify_user(r.requester_id, 'Overdue: ' || r.item_name,
        'Please return ' || r.item_name || ' - it was due back '
          || to_char(r.due_at AT TIME ZONE 'Africa/Johannesburg', 'DD Mon HH24:MI') || '.', '/equipment/mine');
    END IF;
    n_over := n_over + 1;
  END LOOP;
  FOR r IN SELECT l.*, i.name AS item_name, u.asset_tag FROM public.equipment_loans l
           JOIN public.equipment_units u ON u.id = l.unit_id
           JOIN public.equipment_items i ON i.id = l.item_id
           WHERE l.organization_id = p_org AND l.status = 'active' AND u.status = 'overdue'
             AND l.overdue_notified_at IS NOT NULL AND l.escalation_level < 3
           FOR UPDATE OF l SKIP LOCKED LOOP
    v_level := CASE WHEN r.escalation_level < 1 THEN 1 ELSE r.escalation_level END;
    IF v_level < 2 AND r.overdue_notified_at <= now() - interval '2 hours' THEN
      PERFORM public.equipment_notify_custodians(p_org, 'Gear still out: ' || r.item_name,
        coalesce(public.equipment_display_name(r.requester_id), 'A patroller') || ' has not returned ' || r.asset_tag
          || '. It has been overdue for 2 hours.',
        '/equipment/admin/requests', r.requester_id);
      PERFORM public.equipment_ledger_append(p_org, 'overdue_escalated', r.unit_id, r.item_id, 'overdue', 'overdue', r.requester_id,
        jsonb_build_object('loan_id', r.id, 'level', 2));
      v_level := 2;
      n_cus := n_cus + 1;
    END IF;
    IF v_level < 3 AND r.overdue_notified_at <= now() - interval '24 hours' THEN
      PERFORM public.equipment_notify_nw_admins(p_org, 'Overdue 24 hours: ' || r.item_name,
        coalesce(public.equipment_display_name(r.requester_id), 'A patroller') || ' still has ' || r.asset_tag || '.',
        '/equipment/admin/requests', r.requester_id);
      PERFORM public.equipment_ledger_append(p_org, 'overdue_escalated', r.unit_id, r.item_id, 'overdue', 'overdue', r.requester_id,
        jsonb_build_object('loan_id', r.id, 'level', 3));
      v_level := 3;
      n_adm := n_adm + 1;
    END IF;
    IF v_level IS DISTINCT FROM r.escalation_level THEN
      UPDATE public.equipment_loans
         SET escalation_level = v_level,
             custodian_escalated_at = CASE WHEN v_level >= 2 THEN coalesce(custodian_escalated_at, now()) ELSE custodian_escalated_at END,
             admin_escalated_at = CASE WHEN v_level >= 3 THEN coalesce(admin_escalated_at, now()) ELSE admin_escalated_at END,
             updated_at = now()
       WHERE id = r.id;
    END IF;
  END LOOP;
  FOR r IN SELECT ir.* FROM public.equipment_issue_reports ir
           WHERE ir.organization_id = p_org AND ir.kind = 'theft' AND ir.cleared_at IS NULL
             AND ir.saps_case_number IS NULL AND ir.cas_reminder_at IS NOT NULL AND ir.cas_reminder_at <= now()
           FOR UPDATE SKIP LOCKED LOOP
    UPDATE public.equipment_issue_reports SET cas_reminder_at = now() + interval '48 hours' WHERE id = r.id;
    SELECT u.asset_tag || ' ' || i.name INTO v_name
    FROM public.equipment_units u JOIN public.equipment_items i ON i.id = u.item_id WHERE u.id = r.unit_id;
    PERFORM public.equipment_notify_user(r.reporter_id, 'SAPS case number still needed',
      'Add the police case number for ' || coalesce(v_name, 'the stolen unit') || '. We will ask again in 48 hours.',
      '/equipment/units/' || r.unit_id);
    PERFORM public.equipment_notify_managers(p_org, 'SAPS case number still needed',
      coalesce(v_name, 'A stolen unit') || ' still has no CAS number.', '/equipment/admin/requests');
    n_cas := n_cas + 1;
  END LOOP;
  RETURN jsonb_build_object(
    'expired_requests', n_exp, 'expired_transfers', n_tr, 'overdue', n_over,
    'custodians_notified', n_cus, 'admins_notified', n_adm, 'cas_reminders', n_cas);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.equipment_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public.equipment_require_org();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_equipment_member(v_org) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN public.equipment_housekeeping_org(v_org);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.run_equipment_housekeeping()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  o record;
  n int := 0;
BEGIN
  FOR o IN SELECT id FROM public.organizations LOOP
    PERFORM public.equipment_housekeeping_org(o.id);
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('orgs', n);
END;
$fn$;

COMMENT ON FUNCTION public.run_equipment_housekeeping() IS
  'Expires hand-overs (12 h to accept, 6 h to finish), marks overdue loans, escalates reminders, and nags for missing SAPS case numbers. Schedule with pg_cron: platform/supabase/archive/schedule_equipment_cron.sql';

CREATE OR REPLACE FUNCTION public.confirm_equipment_return(
  p_loan_id uuid, p_condition text DEFAULT NULL, p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  l public.equipment_loans%ROWTYPE := public.equipment_manager_loan(p_loan_id);
  v_name text;
BEGIN
  IF l.status <> 'active' THEN RAISE EXCEPTION 'loan is not active (%)', l.status; END IF;
  IF p_condition IS NOT NULL AND p_condition NOT IN ('new', 'good', 'fair', 'poor') THEN
    RAISE EXCEPTION 'invalid condition';
  END IF;
  UPDATE public.equipment_transfers SET status = 'expired', responded_at = now()
   WHERE unit_id = l.unit_id AND status IN ('requested', 'accepted');
  PERFORM public.equipment_set_unit_status_ex(l.unit_id, 'available', NULL, coalesce(nullif(trim(p_note), ''), 'returned'),
    jsonb_build_object('loan_id', l.id, 'action', 'return', 'condition', p_condition, 'returned_by', l.requester_id));
  IF p_condition IS NOT NULL THEN
    UPDATE public.equipment_units SET condition = p_condition WHERE id = l.unit_id;
  END IF;
  UPDATE public.equipment_loans
     SET status = 'returned', ended_at = now(), ended_by = auth.uid(), return_condition = p_condition,
         return_note = nullif(trim(left(p_note, 500)), ''), updated_at = now()
   WHERE id = l.id;
  SELECT name INTO v_name FROM public.equipment_items WHERE id = l.item_id;
  PERFORM public.equipment_notify_user(l.requester_id, 'Returned: ' || v_name,
    'Thanks - ' || v_name || ' is checked back in.', '/equipment/mine');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.extend_equipment_loan(p_loan_id uuid, p_due_at timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  l public.equipment_loans%ROWTYPE := public.equipment_manager_loan(p_loan_id);
  v_status text;
  v_name text;
BEGIN
  IF l.status <> 'active' THEN RAISE EXCEPTION 'loan is not active (%)', l.status; END IF;
  IF p_due_at IS NULL OR p_due_at <= now() THEN RAISE EXCEPTION 'the new return time must be in the future'; END IF;
  IF p_due_at > now() + interval '1 year' THEN RAISE EXCEPTION 'the new return time is too far ahead'; END IF;
  SELECT status INTO v_status FROM public.equipment_units WHERE id = l.unit_id FOR UPDATE;
  IF v_status = 'overdue' THEN
    PERFORM public.equipment_set_unit_status_ex(l.unit_id, 'checked_out', l.requester_id, 'return time extended',
      jsonb_build_object('loan_id', l.id, 'action', 'extend', 'due_at', p_due_at, 'previous_due_at', l.due_at));
  ELSE
    PERFORM public.equipment_ledger_append(l.organization_id, 'unit_updated', l.unit_id, l.item_id, NULL, NULL, l.requester_id,
      jsonb_build_object('loan_id', l.id, 'action', 'extend', 'due_at', p_due_at, 'previous_due_at', l.due_at));
  END IF;
  UPDATE public.equipment_loans
     SET due_at = p_due_at, overdue_notified_at = NULL, escalation_level = 0,
         custodian_escalated_at = NULL, admin_escalated_at = NULL, updated_at = now()
   WHERE id = l.id;
  SELECT name INTO v_name FROM public.equipment_items WHERE id = l.item_id;
  PERFORM public.equipment_notify_user(l.requester_id, 'More time: ' || v_name,
    'Your NW admin moved the return time for ' || v_name || ' to '
      || to_char(p_due_at AT TIME ZONE 'Africa/Johannesburg', 'DD Mon HH24:MI') || '.',
    '/equipment/mine');
  RETURN p_due_at;
END;
$fn$;

DROP FUNCTION IF EXISTS public.set_equipment_unit_status_admin(uuid, text, text);

CREATE OR REPLACE FUNCTION public.set_equipment_unit_status_admin(p_unit_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  u public.equipment_units%ROWTYPE;
  l public.equipment_loans%ROWTYPE;
  v_to text := lower(trim(coalesce(p_status, '')));
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_name text;
  v_result text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO u FROM public.equipment_units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_equipment(u.organization_id) THEN RAISE EXCEPTION 'unit not found'; END IF;
  IF v_to NOT IN ('available', 'under_repair', 'damaged', 'lost', 'stolen', 'retired') THEN RAISE EXCEPTION 'invalid status'; END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN RAISE EXCEPTION 'note is too long'; END IF;
  IF u.status = v_to THEN RETURN 'ok'; END IF;
  IF EXISTS (SELECT 1 FROM public.equipment_issue_reports WHERE unit_id = u.id AND cleared_at IS NULL) THEN
    RAISE EXCEPTION 'this unit has an open issue report; resolve it on the loan desk';
  END IF;
  IF u.status IN ('reserved', 'in_transfer') THEN
    RAISE EXCEPTION 'this unit is reserved for a request; reject or hand it over on the loan desk first';
  END IF;
  IF u.status IN ('checked_out', 'overdue') THEN
    IF v_to NOT IN ('damaged', 'lost', 'stolen') THEN
      RAISE EXCEPTION 'this unit is on loan; take it back on the loan desk first';
    END IF;
    IF v_note IS NULL THEN RAISE EXCEPTION 'add a note saying what happened'; END IF;
  END IF;
  IF v_to = 'retired' THEN
    v_result := public.equipment_apply_write_off(u.id, NULL, v_note);
    IF v_result = 'retired' THEN
      UPDATE public.equipment_transfers SET status = 'expired', responded_at = now()
       WHERE unit_id = u.id AND status = 'requested';
    END IF;
    RETURN v_result;
  END IF;
  IF NOT public.equipment_transition_allowed(u.status, v_to) THEN
    RAISE EXCEPTION 'a % unit cannot go to %', u.status, v_to;
  END IF;
  SELECT * INTO l FROM public.equipment_loans WHERE unit_id = u.id AND status = 'active' FOR UPDATE;
  PERFORM public.equipment_set_unit_status_ex(u.id, v_to, NULL, coalesce(v_note, 'set by admin'),
    jsonb_build_object('action', 'admin_status', 'loan_id', l.id));
  IF l.id IS NOT NULL THEN
    UPDATE public.equipment_loans
       SET status = 'issue_reported', ended_at = now(), ended_by = auth.uid(), return_note = left(v_note, 500), updated_at = now()
     WHERE id = l.id;
    SELECT name INTO v_name FROM public.equipment_items WHERE id = u.item_id;
    PERFORM public.equipment_notify_user(l.requester_id, 'Loan closed: ' || v_name,
      'Your NW admin marked ' || v_name || ' (' || u.asset_tag || ') as ' || replace(v_to, '_', ' ') || ': ' || left(v_note, 200),
      '/equipment/mine');
  END IF;
  UPDATE public.equipment_transfers SET status = 'expired', responded_at = now()
   WHERE unit_id = u.id AND status = 'requested';
  RETURN 'ok';
END;
$fn$;

DROP FUNCTION IF EXISTS public.list_equipment_issues_admin();

CREATE OR REPLACE FUNCTION public.list_equipment_issues_admin()
RETURNS TABLE (
  id uuid, unit_id uuid, asset_tag text, item_id uuid, item_name text, unit_status text, kind text, note text,
  reporter_name text, created_at timestamptz, saps_case_number text, cas_pending boolean,
  purchase_price_cents bigint, write_off_status text, i_proposed_write_off boolean,
  liability_decision text, can_decide_liability boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public.equipment_require_org();
  uid uuid := auth.uid();
BEGIN
  IF NOT public.can_manage_equipment(v_org) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT r.id, r.unit_id, u.asset_tag, i.id, i.name, u.status, r.kind, r.note, coalesce(ru.full_name, 'Member'), r.created_at,
         r.saps_case_number, (r.kind = 'theft' AND r.saps_case_number IS NULL), u.purchase_price_cents,
         w.status, coalesce(w.proposed_by = uid, false), r.liability_decision, public.is_org_nw_admin(v_org)
  FROM public.equipment_issue_reports r
  JOIN public.equipment_units u ON u.id = r.unit_id
  JOIN public.equipment_items i ON i.id = u.item_id
  LEFT JOIN public.users ru ON ru.id = r.reporter_id
  LEFT JOIN public.equipment_write_offs w ON w.unit_id = r.unit_id AND w.status = 'pending'
  WHERE r.organization_id = v_org AND r.cleared_at IS NULL
  ORDER BY r.created_at;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.equipment_pending_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public.equipment_require_org();
  v_mgr boolean;
BEGIN
  IF NOT public.is_equipment_member(v_org) THEN
    RETURN jsonb_build_object('can_manage', false, 'requests', 0, 'to_collect', 0, 'overdue', 0, 'issues', 0,
      'admin_total', 0, 'incoming_transfers', 0, 'my_overdue', 0, 'my_ready', 0);
  END IF;
  v_mgr := public.can_manage_equipment(v_org);
  RETURN (
    SELECT jsonb_build_object(
      'can_manage', v_mgr,
      'requests', CASE WHEN v_mgr THEN a.req ELSE 0 END,
      'to_collect', CASE WHEN v_mgr THEN a.col ELSE 0 END,
      'overdue', CASE WHEN v_mgr THEN a.ovd ELSE 0 END,
      'issues', CASE WHEN v_mgr THEN a.iss ELSE 0 END,
      'admin_total', CASE WHEN v_mgr THEN a.req + a.ovd + a.iss ELSE 0 END,
      'incoming_transfers', (SELECT count(*) FROM public.equipment_transfers t
                              JOIN public.equipment_loans l ON l.id = t.from_loan_id
                              WHERE t.organization_id = v_org AND (
                                (t.status = 'requested' AND l.requester_id = auth.uid())
                                OR (t.status = 'accepted' AND t.from_user_id = auth.uid() AND t.giver_confirmed_at IS NULL)
                                OR (t.status = 'accepted' AND t.to_user_id = auth.uid() AND t.receiver_confirmed_at IS NULL))),
      'my_overdue', (SELECT count(*) FROM public.equipment_loans l
                      WHERE l.organization_id = v_org AND l.requester_id = auth.uid() AND l.status = 'active' AND l.due_at < now()),
      'my_ready', (SELECT count(*) FROM public.equipment_loans l
                    WHERE l.organization_id = v_org AND l.requester_id = auth.uid() AND l.status = 'approved'))
    FROM (SELECT
            (SELECT count(*) FROM public.equipment_loans WHERE organization_id = v_org AND status = 'requested') AS req,
            (SELECT count(*) FROM public.equipment_loans WHERE organization_id = v_org AND status = 'approved') AS col,
            (SELECT count(*) FROM public.equipment_loans WHERE organization_id = v_org AND status = 'active' AND due_at < now()) AS ovd,
            (SELECT count(*) FROM public.equipment_issue_reports WHERE organization_id = v_org AND cleared_at IS NULL) AS iss) a
  );
END;
$fn$;

-- Best-effort timer. Missing pg_cron does not fail the migration.
-- Operators can also run platform/supabase/archive/schedule_equipment_cron.sql.
DO $cron$
DECLARE
  jid bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'cron' AND p.proname = 'schedule'
  ) THEN RETURN; END IF;
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'equipment_housekeeping_15m';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
  PERFORM cron.schedule('equipment_housekeeping_15m', '*/15 * * * *',
    $job$SELECT public.run_equipment_housekeeping();$job$);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'equipment housekeeping cron was not scheduled: %', SQLERRM;
END
$cron$;

REVOKE ALL ON FUNCTION public.equipment_notify_custodians(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_notify_custodians(uuid, text, text, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.equipment_notify_nw_admins(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_notify_nw_admins(uuid, text, text, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.equipment_housekeeping_org(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_housekeeping_org(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.run_equipment_housekeeping() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_equipment_housekeeping() TO service_role;
REVOKE ALL ON FUNCTION public.equipment_sweep() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipment_sweep() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_equipment_return(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_equipment_return(uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.extend_equipment_loan(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extend_equipment_loan(uuid, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_equipment_unit_status_admin(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_equipment_unit_status_admin(uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_equipment_issues_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_equipment_issues_admin() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.equipment_pending_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipment_pending_counts() TO authenticated, service_role;
