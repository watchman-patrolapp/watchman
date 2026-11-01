-- =============================================================================
-- P3c - Equipment desk fixes. Additive on top of 20261101030000. Idempotent.
--
--   * confirm_equipment_return / equipment_sweep: open transfer requests for a
--     unit that is returned or goes overdue are expired (the holder can no
--     longer accept them, and they kept the "asked to hand over" badge lit).
--   * set_equipment_unit_status_admin: managers can take a unit out of use
--     (repair, damaged, lost, stolen, retired) and bring it back. Before this,
--     a unit cleared to "under repair" could never become available again and
--     an unreturned unit could not be written off.
--   * extend_equipment_loan: managers can move an active loan's return time;
--     an overdue unit goes back to checked out.
-- =============================================================================

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
  PERFORM public.equipment_set_unit_status_ex(l.unit_id, 'available', NULL, coalesce(nullif(trim(p_note), ''), 'returned'),
    jsonb_build_object('loan_id', l.id, 'action', 'return', 'condition', p_condition, 'returned_by', l.requester_id));
  IF p_condition IS NOT NULL THEN
    UPDATE public.equipment_units SET condition = p_condition WHERE id = l.unit_id;
  END IF;
  UPDATE public.equipment_loans
     SET status = 'returned', ended_at = now(), ended_by = auth.uid(), return_condition = p_condition,
         return_note = nullif(trim(left(p_note, 500)), ''), updated_at = now()
   WHERE id = l.id;
  UPDATE public.equipment_transfers SET status = 'expired', responded_at = now()
   WHERE unit_id = l.unit_id AND status = 'requested';
  SELECT name INTO v_name FROM public.equipment_items WHERE id = l.item_id;
  PERFORM public.equipment_notify_user(l.requester_id, 'Returned: ' || v_name,
    'Thanks - ' || v_name || ' is checked back in.', '/equipment/mine');
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
  r record;
  n_exp int := 0;
  n_tr int := 0;
  n_over int := 0;
BEGIN
  IF NOT public.is_equipment_member(v_org) THEN RAISE EXCEPTION 'forbidden'; END IF;
  FOR r IN SELECT l.* FROM public.equipment_loans l
           WHERE l.organization_id = v_org AND l.status IN ('requested', 'approved')
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
  UPDATE public.equipment_transfers SET status = 'expired', responded_at = now()
   WHERE organization_id = v_org AND status = 'requested' AND created_at < now() - interval '7 days';
  GET DIAGNOSTICS n_tr = ROW_COUNT;
  FOR r IN SELECT l.*, i.name AS item_name FROM public.equipment_loans l
           JOIN public.equipment_units u ON u.id = l.unit_id
           JOIN public.equipment_items i ON i.id = l.item_id
           WHERE l.organization_id = v_org AND l.status = 'active' AND l.due_at < now()
             AND u.status = 'checked_out'
           FOR UPDATE OF l SKIP LOCKED LOOP
    PERFORM public.equipment_set_unit_status_ex(r.unit_id, 'overdue', r.requester_id, 'past agreed return time',
      jsonb_build_object('loan_id', r.id, 'action', 'overdue', 'due_at', r.due_at));
    UPDATE public.equipment_transfers SET status = 'expired', responded_at = now()
     WHERE unit_id = r.unit_id AND status = 'requested';
    IF r.overdue_notified_at IS NULL THEN
      UPDATE public.equipment_loans SET overdue_notified_at = now(), updated_at = now() WHERE id = r.id;
      PERFORM public.equipment_notify_user(r.requester_id, 'Overdue: ' || r.item_name,
        'Please return ' || r.item_name || ' - it was due back '
          || to_char(r.due_at AT TIME ZONE 'Africa/Johannesburg', 'DD Mon HH24:MI') || '.', '/equipment/mine');
      PERFORM public.equipment_notify_managers(v_org, 'Overdue: ' || r.item_name,
        coalesce(public.equipment_display_name(r.requester_id), 'A patroller') || ' has not returned ' || r.item_name || '.',
        '/equipment/admin/requests');
    END IF;
    n_over := n_over + 1;
  END LOOP;
  RETURN jsonb_build_object('expired_requests', n_exp, 'expired_transfers', n_tr, 'overdue', n_over);
END;
$fn$;

-- Manager status change outside the loan flow. Reserved / in-transfer units and
-- units with an open issue report go through the desk instead.
CREATE OR REPLACE FUNCTION public.set_equipment_unit_status_admin(p_unit_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS void
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
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO u FROM public.equipment_units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_equipment(u.organization_id) THEN RAISE EXCEPTION 'unit not found'; END IF;
  IF v_to NOT IN ('available', 'under_repair', 'damaged', 'lost', 'stolen', 'retired') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN RAISE EXCEPTION 'note is too long'; END IF;
  IF u.status = v_to THEN RETURN; END IF;
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
  UPDATE public.equipment_loans SET due_at = p_due_at, overdue_notified_at = NULL, updated_at = now() WHERE id = l.id;
  SELECT name INTO v_name FROM public.equipment_items WHERE id = l.item_id;
  PERFORM public.equipment_notify_user(l.requester_id, 'More time: ' || v_name,
    'Your NW admin moved the return time for ' || v_name || ' to '
      || to_char(p_due_at AT TIME ZONE 'Africa/Johannesburg', 'DD Mon HH24:MI') || '.',
    '/equipment/mine');
  RETURN p_due_at;
END;
$fn$;

REVOKE ALL ON FUNCTION public.confirm_equipment_return(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_equipment_return(uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.equipment_sweep() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipment_sweep() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_equipment_unit_status_admin(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_equipment_unit_status_admin(uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.extend_equipment_loan(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extend_equipment_loan(uuid, timestamptz) TO authenticated, service_role;
