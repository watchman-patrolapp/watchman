-- =============================================================================
-- P3d - Offline-tolerant equipment actions.
-- Start return, report an issue, confirm the hand-over giver, and a paper
-- hand-over claim are idempotent on client_event_id. Code confirmation stays
-- live: confirm_equipment_handover_receiver is unchanged.
-- occurred_at is clamped to [now - 72 hours, now + 5 minutes].
-- =============================================================================

DROP FUNCTION IF EXISTS public.report_equipment_issue(uuid, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.report_equipment_issue(uuid, text, text);

CREATE OR REPLACE FUNCTION public.report_equipment_issue(
  p_unit_id uuid, p_kind text, p_note text,
  p_saps_case text DEFAULT NULL, p_saps_station text DEFAULT NULL, p_location text DEFAULT NULL,
  p_client_event_id uuid DEFAULT NULL, p_occurred_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  u public.equipment_units%ROWTYPE;
  l public.equipment_loans%ROWTYPE;
  v_kind text := lower(trim(coalesce(p_kind, '')));
  v_note text := trim(coalesce(p_note, ''));
  v_case text;
  v_to text;
  v_id uuid;
  v_name text;
  v_when timestamptz;
  v_replay jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO u FROM public.equipment_units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_equipment_member(u.organization_id) THEN RAISE EXCEPTION 'unit not found'; END IF;
  v_replay := public.equipment_client_begin(u.organization_id, p_client_event_id, 'report_issue');
  IF v_replay IS NOT NULL THEN RETURN (v_replay->>'id')::uuid; END IF;
  IF v_kind NOT IN ('damage', 'theft', 'malfunction') THEN RAISE EXCEPTION 'unknown issue type'; END IF;
  IF char_length(v_note) < 3 OR char_length(v_note) > 1000 THEN RAISE EXCEPTION 'describe what happened (3 to 1000 characters)'; END IF;
  IF p_location IS NOT NULL AND char_length(trim(p_location)) > 120 THEN RAISE EXCEPTION 'location is too long'; END IF;
  IF p_saps_station IS NOT NULL AND char_length(trim(p_saps_station)) > 80 THEN RAISE EXCEPTION 'police station name is too long'; END IF;
  v_case := CASE WHEN v_kind = 'theft' THEN public.equipment_normalize_cas(p_saps_case) ELSE NULL END;
  v_when := public.equipment_clamp_occurred_at(p_occurred_at);
  SELECT * INTO l FROM public.equipment_loans
   WHERE unit_id = u.id AND collected_at IS NOT NULL
   ORDER BY collected_at DESC, created_at DESC LIMIT 1;
  IF NOT FOUND OR l.requester_id <> uid THEN RAISE EXCEPTION 'only the latest holder can report an issue'; END IF;
  IF u.status NOT IN ('available', 'checked_out', 'overdue') THEN
    RAISE EXCEPTION 'an issue cannot be reported while the unit is %', u.status;
  END IF;
  IF u.status = 'available' AND l.ended_at < now() - interval '7 days' THEN
    RAISE EXCEPTION 'issues must be reported within 7 days of returning the unit';
  END IF;
  v_to := CASE v_kind WHEN 'theft' THEN 'stolen' ELSE 'damaged' END;
  BEGIN
    INSERT INTO public.equipment_issue_reports (
      organization_id, unit_id, loan_id, reporter_id, kind, note, from_status,
      saps_case_number, saps_station, cas_reminder_at, location_label)
    VALUES (
      u.organization_id, u.id, l.id, uid, v_kind, v_note, u.status, v_case,
      nullif(trim(p_saps_station), ''),
      CASE WHEN v_kind = 'theft' AND v_case IS NULL THEN now() + interval '48 hours' ELSE NULL END,
      nullif(trim(p_location), ''))
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'an issue is already open for this unit';
  END;
  PERFORM public.equipment_set_unit_status_ex(u.id, v_to, NULL, v_kind || ': ' || left(v_note, 400),
    jsonb_build_object('issue_id', v_id, 'kind', v_kind, 'loan_id', l.id, 'reported_by', uid, 'action', 'issue',
      'cas_pending', v_kind = 'theft' AND v_case IS NULL, 'client_occurred_at', v_when));
  IF l.status = 'active' THEN
    UPDATE public.equipment_loans SET status = 'issue_reported', ended_at = now(), ended_by = uid, updated_at = now()
     WHERE id = l.id;
  END IF;
  UPDATE public.equipment_transfers SET status = 'expired', responded_at = now()
   WHERE unit_id = u.id AND status = 'requested';
  SELECT name INTO v_name FROM public.equipment_items WHERE id = u.item_id;
  PERFORM public.equipment_notify_managers(u.organization_id,
    initcap(v_kind) || ' reported: ' || v_name || ' ' || u.asset_tag,
    coalesce(public.equipment_display_name(uid), 'A patroller') || ': ' || left(v_note, 180)
      || CASE WHEN v_kind = 'theft' AND v_case IS NULL THEN ' SAPS case number still needed.' ELSE '' END,
    '/equipment/admin/requests');
  PERFORM public.equipment_client_finish(u.organization_id, p_client_event_id, 'report_issue', jsonb_build_object('id', v_id));
  RETURN v_id;
END;
$fn$;

DROP FUNCTION IF EXISTS public.confirm_equipment_handover_giver(uuid);

CREATE OR REPLACE FUNCTION public.confirm_equipment_handover_giver(
  p_transfer_id uuid, p_client_event_id uuid DEFAULT NULL, p_occurred_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  t public.equipment_transfers%ROWTYPE;
  v_new uuid;
  v_first boolean;
  v_result jsonb;
  v_replay jsonb;
  v_when timestamptz;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO t FROM public.equipment_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR t.from_user_id IS DISTINCT FROM uid OR NOT public.is_equipment_member(t.organization_id) THEN
    RAISE EXCEPTION 'transfer not found';
  END IF;
  v_replay := public.equipment_client_begin(t.organization_id, p_client_event_id, 'handover_giver');
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF t.status <> 'accepted' THEN RAISE EXCEPTION 'transfer is no longer open (%)', t.status; END IF;
  IF t.handover_by IS NOT NULL AND t.handover_by < now() THEN
    PERFORM public.equipment_abort_handover(t.id, 'hand-over window');
    v_result := jsonb_build_object('ok', false, 'error', 'This hand-over has expired. The unit is still with the holder.');
    PERFORM public.equipment_client_finish(t.organization_id, p_client_event_id, 'handover_giver', v_result);
    RETURN v_result;
  END IF;
  v_when := public.equipment_clamp_occurred_at(p_occurred_at);
  v_first := t.giver_confirmed_at IS NULL;
  IF v_first THEN
    UPDATE public.equipment_transfers SET giver_confirmed_at = now() WHERE id = t.id;
    PERFORM public.equipment_ledger_append_client(t.organization_id, 'handover_giver_confirmed', t.unit_id, NULL, NULL, NULL, uid,
      jsonb_build_object('transfer_id', t.id, 'recorded_later', p_occurred_at IS NOT NULL), p_client_event_id, v_when);
  END IF;
  SELECT * INTO t FROM public.equipment_transfers WHERE id = t.id;
  IF t.receiver_confirmed_at IS NOT NULL THEN
    v_new := public.equipment_finish_handover(t.id, 'completed', false);
    v_result := jsonb_build_object('ok', true, 'completed', true, 'loan_id', v_new);
  ELSE
    v_result := jsonb_build_object('ok', true, 'completed', false);
  END IF;
  PERFORM public.equipment_client_finish(t.organization_id, p_client_event_id, 'handover_giver', v_result);
  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.request_equipment_return(
  p_loan_id uuid, p_client_event_id uuid DEFAULT NULL, p_occurred_at timestamptz DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  l public.equipment_loans%ROWTYPE;
  v_when timestamptz;
  v_replay jsonb;
  v_name text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO l FROM public.equipment_loans WHERE id = p_loan_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_equipment_member(l.organization_id) OR l.requester_id IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'loan not found';
  END IF;
  v_replay := public.equipment_client_begin(l.organization_id, p_client_event_id, 'return_request');
  IF v_replay IS NOT NULL THEN RETURN (v_replay->>'return_requested_at')::timestamptz; END IF;
  IF l.status <> 'active' THEN RAISE EXCEPTION 'this loan is not active'; END IF;
  v_when := coalesce(l.return_requested_at, public.equipment_clamp_occurred_at(p_occurred_at));
  IF l.return_requested_at IS NULL THEN
    UPDATE public.equipment_loans SET return_requested_at = v_when, updated_at = now() WHERE id = l.id;
    PERFORM public.equipment_ledger_append_client(l.organization_id, 'return_requested', l.unit_id, l.item_id, NULL, NULL, uid,
      jsonb_build_object('loan_id', l.id, 'recorded_later', p_occurred_at IS NOT NULL), p_client_event_id, v_when);
    SELECT name INTO v_name FROM public.equipment_items WHERE id = l.item_id;
    PERFORM public.equipment_notify_managers(l.organization_id, 'Return started: ' || coalesce(v_name, 'equipment'),
      coalesce(public.equipment_display_name(uid), 'A patroller') || ' is bringing ' || coalesce(v_name, 'a unit') || ' back.',
      '/equipment/admin/requests');
  END IF;
  PERFORM public.equipment_client_finish(l.organization_id, p_client_event_id, 'return_request',
    jsonb_build_object('return_requested_at', v_when));
  RETURN v_when;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.submit_equipment_paper_claim(
  p_unit_id uuid, p_note text DEFAULT NULL, p_occurred_at timestamptz DEFAULT NULL,
  p_photo_path text DEFAULT NULL, p_client_event_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  u public.equipment_units%ROWTYPE;
  i public.equipment_items%ROWTYPE;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_when timestamptz;
  v_id uuid;
  v_replay jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO u FROM public.equipment_units WHERE id = p_unit_id;
  IF NOT FOUND OR NOT public.is_equipment_member(u.organization_id) THEN RAISE EXCEPTION 'unit not found'; END IF;
  v_replay := public.equipment_client_begin(u.organization_id, p_client_event_id, 'paper_claim');
  IF v_replay IS NOT NULL THEN RETURN (v_replay->>'id')::uuid; END IF;
  IF u.current_holder_id IS NULL OR u.current_holder_id = uid THEN RAISE EXCEPTION 'you cannot claim a unit you already hold'; END IF;
  IF u.status NOT IN ('checked_out', 'overdue') THEN RAISE EXCEPTION 'this unit is not on loan'; END IF;
  IF NOT public.equipment_user_can_borrow(uid, u.organization_id) THEN
    RAISE EXCEPTION 'only patrol members of this neighbourhood can borrow equipment';
  END IF;
  SELECT * INTO i FROM public.equipment_items WHERE id = u.item_id;
  IF i.requires_certification AND NOT public.equipment_has_certification(uid, i.id) THEN
    RAISE EXCEPTION 'training sign-off required for this item';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN RAISE EXCEPTION 'note is too long'; END IF;
  v_when := public.equipment_clamp_occurred_at(p_occurred_at);
  BEGIN
    INSERT INTO public.equipment_paper_handovers (
      organization_id, unit_id, from_user_id, to_user_id, occurred_at, note, photo_path, submitted_by)
    VALUES (u.organization_id, u.id, u.current_holder_id, uid, v_when, v_note, nullif(trim(p_photo_path), ''), uid)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id FROM public.equipment_paper_handovers
     WHERE unit_id = u.id AND to_user_id = uid AND status = 'pending';
  END;
  PERFORM public.equipment_notify_managers(u.organization_id, 'Paper hand-over to confirm',
    coalesce(public.equipment_display_name(uid), 'A patroller') || ' says they received ' || u.asset_tag
      || ' while phones were offline. Confirm it on the equipment overview.',
    '/equipment/admin');
  PERFORM public.equipment_client_finish(u.organization_id, p_client_event_id, 'paper_claim', jsonb_build_object('id', v_id));
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.record_paper_handover(
  p_claim_id uuid DEFAULT NULL, p_unit_id uuid DEFAULT NULL, p_from_user uuid DEFAULT NULL, p_to_user uuid DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT NULL, p_note text DEFAULT NULL, p_photo_path text DEFAULT NULL,
  p_client_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  c public.equipment_paper_handovers%ROWTYPE;
  u public.equipment_units%ROWTYPE;
  l public.equipment_loans%ROWTYPE;
  i public.equipment_items%ROWTYPE;
  v_new uuid;
  v_when timestamptz;
  v_replay jsonb;
  v_result jsonb;
  v_due timestamptz;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_claim_id IS NOT NULL THEN
    SELECT * INTO c FROM public.equipment_paper_handovers WHERE id = p_claim_id FOR UPDATE;
    IF NOT FOUND OR NOT public.can_manage_equipment(c.organization_id) THEN RAISE EXCEPTION 'claim not found'; END IF;
    v_replay := public.equipment_client_begin(c.organization_id, p_client_event_id, 'paper_record');
    IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  ELSE
    SELECT * INTO u FROM public.equipment_units WHERE id = p_unit_id;
    IF NOT FOUND OR NOT public.can_manage_equipment(u.organization_id) THEN RAISE EXCEPTION 'unit not found'; END IF;
    v_replay := public.equipment_client_begin(u.organization_id, p_client_event_id, 'paper_record');
    IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
    IF p_from_user IS NULL OR p_to_user IS NULL OR p_from_user = p_to_user THEN
      RAISE EXCEPTION 'say who handed it over and who received it';
    END IF;
    v_when := public.equipment_clamp_occurred_at(p_occurred_at);
    BEGIN
      INSERT INTO public.equipment_paper_handovers (
        organization_id, unit_id, from_user_id, to_user_id, occurred_at, note, photo_path, submitted_by, status)
      VALUES (u.organization_id, u.id, p_from_user, p_to_user, v_when, nullif(trim(p_note), ''), nullif(trim(p_photo_path), ''), uid, 'pending')
      RETURNING * INTO c;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'a paper hand-over is already waiting for this unit';
    END;
  END IF;
  IF c.status = 'recorded' THEN
    v_result := jsonb_build_object('ok', true, 'claim_id', c.id, 'already', true);
    PERFORM public.equipment_client_finish(c.organization_id, p_client_event_id, 'paper_record', v_result);
    RETURN v_result;
  END IF;
  SELECT * INTO u FROM public.equipment_units WHERE id = c.unit_id FOR UPDATE;
  SELECT * INTO l FROM public.equipment_loans WHERE unit_id = u.id AND status = 'active' FOR UPDATE;
  IF NOT FOUND OR l.requester_id IS DISTINCT FROM c.from_user_id OR u.current_holder_id IS DISTINCT FROM c.from_user_id
     OR u.status NOT IN ('checked_out', 'overdue') THEN
    RAISE EXCEPTION 'that patroller no longer holds this unit';
  END IF;
  SELECT * INTO i FROM public.equipment_items WHERE id = u.item_id;
  IF i.requires_certification AND NOT public.equipment_has_certification(c.to_user_id, i.id) THEN
    RAISE EXCEPTION 'the receiver has no training sign-off for this item';
  END IF;
  IF NOT public.equipment_user_can_borrow(c.to_user_id, u.organization_id) THEN
    RAISE EXCEPTION 'the receiver is not a patrol member here';
  END IF;
  v_when := c.occurred_at;
  PERFORM public.equipment_set_unit_status_ex(u.id, 'in_transfer', l.requester_id, 'paper handover',
    jsonb_build_object('claim_id', c.id, 'action', 'paper_handover'));
  UPDATE public.equipment_loans
     SET status = 'transferred', ended_at = now(), ended_by = uid, updated_at = now()
   WHERE id = l.id;
  v_due := CASE WHEN l.due_at > now() THEN l.due_at ELSE now() + interval '24 hours' END;
  BEGIN
    INSERT INTO public.equipment_loans (
      organization_id, item_id, unit_id, requester_id, status, source, note,
      due_at, decided_by, decided_at, collected_at, collected_by)
    VALUES (l.organization_id, l.item_id, u.id, c.to_user_id, 'active', 'transfer', c.note,
      v_due, uid, now(), now(), uid)
    RETURNING id INTO v_new;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'the receiver already has an open request or loan for this item';
  END;
  PERFORM public.equipment_set_unit_status_ex(u.id, 'checked_out', c.to_user_id, 'paper handover recorded',
    jsonb_build_object('claim_id', c.id, 'loan_id', v_new, 'action', 'paper_handover', 'recorded_later', true));
  UPDATE public.equipment_paper_handovers
     SET status = 'recorded', recorded_by = uid, recorded_at = now()
   WHERE id = c.id;
  PERFORM public.equipment_ledger_append_client(u.organization_id, 'paper_handover_recorded', u.id, u.item_id,
    'checked_out', 'checked_out', c.to_user_id,
    jsonb_build_object('claim_id', c.id, 'from_user', c.from_user_id, 'to_user', c.to_user_id,
      'note', c.note, 'photo_path', c.photo_path, 'recorded_later', true, 'by', uid),
    p_client_event_id, v_when);
  PERFORM public.write_staff_activity('equipment_paper_handover_recorded',
    jsonb_build_object('claim_id', c.id, 'unit_id', u.id, 'recorded_later', true), uid, u.organization_id);
  PERFORM public.equipment_notify_user(c.to_user_id, 'Paper hand-over recorded',
    u.asset_tag || ' is now with you. An admin recorded this later.', '/equipment/mine');
  PERFORM public.equipment_notify_user(c.from_user_id, 'Paper hand-over recorded',
    u.asset_tag || ' was recorded as handed on. You no longer hold it.', '/equipment/mine');
  v_result := jsonb_build_object('ok', true, 'claim_id', c.id, 'loan_id', v_new, 'recorded_later', true);
  PERFORM public.equipment_client_finish(c.organization_id, p_client_event_id, 'paper_record', v_result);
  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.list_equipment_paper_claims()
RETURNS TABLE (
  id uuid, unit_id uuid, asset_tag text, item_name text, from_name text, to_name text,
  occurred_at timestamptz, note text, created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public.equipment_require_org();
BEGIN
  IF NOT public.can_manage_equipment(v_org) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT c.id, c.unit_id, u.asset_tag, i.name,
         public.equipment_display_name(c.from_user_id), public.equipment_display_name(c.to_user_id),
         c.occurred_at, c.note, c.created_at
  FROM public.equipment_paper_handovers c
  JOIN public.equipment_units u ON u.id = c.unit_id
  JOIN public.equipment_items i ON i.id = u.item_id
  WHERE c.organization_id = v_org AND c.status = 'pending'
  ORDER BY c.created_at;
END;
$fn$;

DROP FUNCTION IF EXISTS public.list_my_equipment_loans();

CREATE OR REPLACE FUNCTION public.list_my_equipment_loans()
RETURNS TABLE (
  id uuid, item_id uuid, item_name text, item_photo_path text, unit_id uuid, asset_tag text, status text,
  source text, note text, desired_due_at timestamptz, due_at timestamptz, is_overdue boolean,
  decision_note text, collected_at timestamptz, ended_at timestamptz, created_at timestamptz,
  return_requested_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN QUERY
  SELECT l.id, l.item_id, i.name, i.photo_path, l.unit_id, u.asset_tag, l.status, l.source, l.note,
         l.desired_due_at, l.due_at, (l.status = 'active' AND l.due_at < now()), l.decision_note,
         l.collected_at, l.ended_at, l.created_at, l.return_requested_at
  FROM public.equipment_loans l
  JOIN public.equipment_items i ON i.id = l.item_id
  LEFT JOIN public.equipment_units u ON u.id = l.unit_id
  WHERE l.requester_id = auth.uid() AND public.is_equipment_member(l.organization_id)
    AND (l.status IN ('requested', 'approved', 'active') OR l.updated_at > now() - interval '60 days')
  ORDER BY (l.status IN ('requested', 'approved', 'active')) DESC, l.updated_at DESC
  LIMIT 100;
END;
$fn$;

REVOKE ALL ON FUNCTION public.report_equipment_issue(uuid, text, text, text, text, text, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_equipment_issue(uuid, text, text, text, text, text, uuid, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_equipment_handover_giver(uuid, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_equipment_handover_giver(uuid, uuid, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.request_equipment_return(uuid, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_equipment_return(uuid, uuid, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_equipment_paper_claim(uuid, text, timestamptz, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_equipment_paper_claim(uuid, text, timestamptz, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_paper_handover(uuid, uuid, uuid, uuid, timestamptz, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_paper_handover(uuid, uuid, uuid, uuid, timestamptz, text, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_equipment_paper_claims() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_equipment_paper_claims() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_my_equipment_loans() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_equipment_loans() TO authenticated, service_role;

DO $p3d_offline$
DECLARE
  missing text;
  names text[] := ARRAY[
    'report_equipment_issue', 'confirm_equipment_handover_giver', 'request_equipment_return',
    'submit_equipment_paper_claim', 'record_paper_handover', 'list_equipment_paper_claims',
    'list_my_equipment_loans'
  ];
BEGIN
  SELECT string_agg(u.name, ', ' ORDER BY u.name) INTO missing
  FROM unnest(names) AS u(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = u.name
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'P3d offline functions still missing: %', missing;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'report_equipment_issue'
      AND pg_get_function_identity_arguments(p.oid) LIKE '%p_client_event_id%'
  ) THEN
    RAISE EXCEPTION 'report_equipment_issue is missing p_client_event_id';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'confirm_equipment_handover_giver'
      AND pg_get_function_identity_arguments(p.oid) LIKE '%p_client_event_id%'
  ) THEN
    RAISE EXCEPTION 'confirm_equipment_handover_giver is missing p_client_event_id';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'equipment_loans' AND column_name = 'return_requested_at'
  ) THEN
    RAISE EXCEPTION 'equipment_loans.return_requested_at is missing';
  END IF;
END
$p3d_offline$;
