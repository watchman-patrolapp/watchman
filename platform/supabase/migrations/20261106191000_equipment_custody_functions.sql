-- =============================================================================
-- P3c repair. Additive. Do not edit 20261106180000-20261106190000.
-- Recreates every P3c function, the two new tables, and their read policies.
-- CREATE OR REPLACE / IF NOT EXISTS, so a database that already has them is unchanged
-- in behaviour. Fixes a live database where decide_equipment_liability was missing
-- (regprocedure lookup 42883) the same way handover_by was missing earlier.
-- No new triggers: the P3c migrations do not create any.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.equipment_write_offs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.equipment_units (id) ON DELETE RESTRICT,
  issue_id uuid REFERENCES public.equipment_issue_reports (id) ON DELETE SET NULL,
  value_cents bigint,
  note text,
  proposed_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  approved_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_write_offs_one_pending
  ON public.equipment_write_offs (unit_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS equipment_write_offs_org_idx
  ON public.equipment_write_offs (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.equipment_maintenance_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.equipment_units (id) ON DELETE RESTRICT,
  issue_id uuid REFERENCES public.equipment_issue_reports (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN (
    'inspection', 'repair', 'service', 'battery_replaced', 'cleaning', 'calibration', 'other')),
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  vendor text CHECK (vendor IS NULL OR char_length(vendor) <= 120),
  cost_cents bigint CHECK (cost_cents IS NULL OR cost_cents >= 0),
  performed_at timestamptz NOT NULL DEFAULT now(),
  performed_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  next_due date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS equipment_maintenance_unit_idx
  ON public.equipment_maintenance_logs (unit_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS equipment_maintenance_org_idx
  ON public.equipment_maintenance_logs (organization_id, performed_at DESC);

ALTER TABLE public.equipment_write_offs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_maintenance_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.equipment_write_offs, public.equipment_maintenance_logs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.equipment_write_offs, public.equipment_maintenance_logs TO service_role;
DROP POLICY IF EXISTS equipment_write_offs_select ON public.equipment_write_offs;
CREATE POLICY equipment_write_offs_select ON public.equipment_write_offs
  FOR SELECT TO authenticated USING (public.can_manage_equipment(organization_id));
DROP POLICY IF EXISTS equipment_maintenance_select ON public.equipment_maintenance_logs;
CREATE POLICY equipment_maintenance_select ON public.equipment_maintenance_logs
  FOR SELECT TO authenticated USING (public.is_equipment_member(organization_id));

CREATE OR REPLACE FUNCTION public.equipment_new_handover_code(p_transfer uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_bytes bytea := extensions.gen_random_bytes(3);
  v_code text;
BEGIN
  v_code := lpad((mod(get_byte(v_bytes, 0) * 65536 + get_byte(v_bytes, 1) * 256 + get_byte(v_bytes, 2), 1000000))::text, 6, '0');
  UPDATE public.equipment_transfers
     SET code_hash = encode(extensions.digest(v_code || ':' || p_transfer::text, 'sha256'), 'hex'),
         code_attempts = 0
   WHERE id = p_transfer;
  RETURN v_code;
END;
$fn$;

-- Closes the giver's loan and opens the receiver's. Caller holds the transfer row.
CREATE OR REPLACE FUNCTION public.equipment_finish_handover(p_transfer uuid, p_final text, p_force boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  t public.equipment_transfers%ROWTYPE;
  l public.equipment_loans%ROWTYPE;
  u public.equipment_units%ROWTYPE;
  i public.equipment_items%ROWTYPE;
  v_new uuid;
  v_actor uuid := auth.uid();
BEGIN
  SELECT * INTO t FROM public.equipment_transfers WHERE id = p_transfer FOR UPDATE;
  IF NOT FOUND OR t.status <> 'accepted' THEN
    RAISE EXCEPTION 'transfer is no longer open (%)', coalesce(t.status, 'missing');
  END IF;
  IF NOT p_force AND (t.giver_confirmed_at IS NULL OR t.receiver_confirmed_at IS NULL) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO l FROM public.equipment_loans WHERE id = t.from_loan_id FOR UPDATE;
  SELECT * INTO u FROM public.equipment_units WHERE id = t.unit_id FOR UPDATE;
  SELECT * INTO i FROM public.equipment_items WHERE id = u.item_id;
  IF l.status <> 'active' OR u.current_holder_id IS DISTINCT FROM l.requester_id THEN
    RAISE EXCEPTION 'this unit can no longer be transferred (%)', u.status;
  END IF;
  IF u.status = 'checked_out' THEN
    PERFORM public.equipment_set_unit_status_ex(u.id, 'in_transfer', l.requester_id, 'handover',
      jsonb_build_object('transfer_id', t.id, 'action', 'transfer'));
  ELSIF u.status <> 'in_transfer' THEN
    RAISE EXCEPTION 'this unit can no longer be transferred (%)', u.status;
  END IF;
  IF i.requires_certification AND NOT public.equipment_has_certification(t.to_user_id, i.id) THEN
    RAISE EXCEPTION 'the requester has no training sign-off for this item';
  END IF;
  UPDATE public.equipment_loans
     SET status = 'transferred', ended_at = clock_timestamp(), ended_by = v_actor, updated_at = now()
   WHERE id = l.id;
  BEGIN
    INSERT INTO public.equipment_loans (
      organization_id, item_id, unit_id, requester_id, status, source, note,
      due_at, decided_by, decided_at, collected_at, collected_by)
    VALUES (
      l.organization_id, l.item_id, u.id, t.to_user_id, 'active', 'transfer', t.note,
      l.due_at, v_actor, now(), clock_timestamp(), v_actor)
    RETURNING id INTO v_new;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'the requester already has an open request or loan for this item';
  END;
  PERFORM public.equipment_set_unit_status_ex(u.id, 'checked_out', t.to_user_id, 'handover complete',
    jsonb_build_object('transfer_id', t.id, 'loan_id', v_new, 'action', 'transfer'));
  IF t.receiver_condition IS NOT NULL THEN
    UPDATE public.equipment_units SET condition = t.receiver_condition WHERE id = u.id;
  END IF;
  UPDATE public.equipment_transfers
     SET status = p_final, to_loan_id = v_new, responded_at = coalesce(responded_at, now())
   WHERE id = t.id;
  UPDATE public.equipment_transfers
     SET status = 'expired', responded_at = now()
   WHERE unit_id = u.id AND status = 'requested' AND id <> t.id;
  PERFORM public.equipment_notify_user(t.to_user_id, 'You now hold ' || i.name,
    i.name || ' (' || u.asset_tag || ') is yours'
      || coalesce(' until ' || to_char(l.due_at AT TIME ZONE 'Africa/Johannesburg', 'DD Mon HH24:MI'), '') || '.',
    '/equipment/mine');
  PERFORM public.equipment_notify_user(t.from_user_id, 'Hand-over complete: ' || i.name,
    u.asset_tag || ' is now with ' || coalesce(public.equipment_display_name(t.to_user_id), 'the other patroller') || '.',
    '/equipment/mine');
  PERFORM public.equipment_notify_managers(t.organization_id, 'Handed over: ' || i.name || ' ' || u.asset_tag,
    coalesce(public.equipment_display_name(t.from_user_id), 'A patroller') || ' handed ' || u.asset_tag || ' to '
      || coalesce(public.equipment_display_name(t.to_user_id), 'a patroller') || '.',
    '/equipment/units/' || u.id);
  RETURN v_new;
END;
$fn$;

-- Reverts an open hand-over. Safe to call twice. Notifies both parties.
CREATE OR REPLACE FUNCTION public.equipment_abort_handover(p_transfer uuid, p_event text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  t public.equipment_transfers%ROWTYPE;
  u public.equipment_units%ROWTYPE;
  v_name text;
BEGIN
  SELECT * INTO t FROM public.equipment_transfers WHERE id = p_transfer FOR UPDATE;
  IF NOT FOUND OR t.status NOT IN ('requested', 'accepted') THEN RETURN; END IF;
  SELECT * INTO u FROM public.equipment_units WHERE id = t.unit_id FOR UPDATE;
  IF t.status = 'accepted' AND u.status = 'in_transfer' THEN
    PERFORM public.equipment_set_unit_status_ex(u.id, 'checked_out', t.from_user_id, 'hand-over expired',
      jsonb_build_object('transfer_id', t.id, 'action', 'transfer_expire'));
  END IF;
  UPDATE public.equipment_transfers SET status = 'expired', responded_at = now() WHERE id = t.id;
  PERFORM public.equipment_ledger_append(t.organization_id, 'transfer_expired', t.unit_id, u.item_id, NULL, NULL, t.from_user_id,
    jsonb_build_object('transfer_id', t.id, 'why', p_event));
  SELECT name INTO v_name FROM public.equipment_items WHERE id = u.item_id;
  IF p_event = 'accept window' THEN
    PERFORM public.equipment_notify_user(t.from_user_id, 'Transfer expired: ' || coalesce(v_name, 'equipment'),
      'You did not accept the hand-over of ' || coalesce(u.asset_tag, 'that unit') || ' within 12 hours.',
      '/equipment/mine');
    PERFORM public.equipment_notify_user(t.to_user_id, 'Transfer expired: ' || coalesce(v_name, 'equipment'),
      'The holder did not accept within 12 hours. Ask again if you still need ' || coalesce(u.asset_tag, 'it') || '.',
      '/equipment/mine');
  ELSE
    PERFORM public.equipment_notify_user(t.from_user_id, 'Hand-over expired: ' || coalesce(v_name, 'equipment'),
      coalesce(u.asset_tag, 'The unit') || ' is still with you. It was not handed over within 6 hours.',
      '/equipment/mine');
    PERFORM public.equipment_notify_user(t.to_user_id, 'Hand-over expired: ' || coalesce(v_name, 'equipment'),
      'The hand-over of ' || coalesce(u.asset_tag, 'that unit') || ' expired before both of you confirmed.',
      '/equipment/mine');
  END IF;
END;
$fn$;

-- -----------------------------------------------------------------------------
-- Client RPCs
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.request_equipment_transfer(uuid, text);

CREATE OR REPLACE FUNCTION public.request_equipment_transfer(
  p_unit_id uuid, p_note text DEFAULT NULL, p_requested_for timestamptz DEFAULT NULL
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
  l public.equipment_loans%ROWTYPE;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO u FROM public.equipment_units WHERE id = p_unit_id;
  IF NOT FOUND OR NOT public.is_equipment_member(u.organization_id) THEN RAISE EXCEPTION 'unit not found'; END IF;
  IF NOT public.equipment_user_can_borrow(uid, u.organization_id) THEN
    RAISE EXCEPTION 'only patrol members of this neighbourhood can borrow equipment';
  END IF;
  SELECT * INTO i FROM public.equipment_items WHERE id = u.item_id;
  IF i.requires_certification AND NOT public.equipment_has_certification(uid, i.id) THEN
    RAISE EXCEPTION 'training sign-off required for this item';
  END IF;
  IF u.status = 'overdue' THEN RAISE EXCEPTION 'this unit is overdue; it must be returned first'; END IF;
  SELECT * INTO l FROM public.equipment_loans WHERE unit_id = u.id AND status = 'active';
  IF NOT FOUND OR u.status <> 'checked_out' THEN RAISE EXCEPTION 'this unit is not on loan'; END IF;
  IF l.requester_id = uid THEN RAISE EXCEPTION 'you already hold this unit'; END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN RAISE EXCEPTION 'note is too long'; END IF;
  IF p_requested_for IS NOT NULL AND p_requested_for < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'pick a hand-over time from now';
  END IF;
  IF p_requested_for IS NOT NULL AND p_requested_for > now() + interval '7 days' THEN
    RAISE EXCEPTION 'pick a hand-over time within 7 days';
  END IF;
  IF EXISTS (SELECT 1 FROM public.equipment_transfers WHERE unit_id = u.id AND status = 'accepted') THEN
    RAISE EXCEPTION 'a hand-over is already in progress for this unit';
  END IF;
  IF EXISTS (SELECT 1 FROM public.equipment_loans
             WHERE item_id = i.id AND requester_id = uid AND status IN ('requested', 'approved', 'active')) THEN
    RAISE EXCEPTION 'you already have an open request or loan for this item';
  END IF;
  BEGIN
    INSERT INTO public.equipment_transfers (
      organization_id, unit_id, from_loan_id, from_user_id, to_user_id, note, requested_for, respond_by)
    VALUES (u.organization_id, u.id, l.id, l.requester_id, uid, v_note, p_requested_for, now() + interval '12 hours')
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'you already asked for this unit';
  END;
  PERFORM public.equipment_ledger_append(u.organization_id, 'transfer_requested', u.id, i.id, NULL, NULL, uid,
    jsonb_build_object('transfer_id', v_id, 'from_user', l.requester_id, 'requested_for', p_requested_for));
  PERFORM public.equipment_notify_user(l.requester_id, 'Transfer request: ' || i.name,
    coalesce(public.equipment_display_name(uid), 'A patroller') || ' asked you to hand over ' || i.name
      || ' (' || u.asset_tag || '). Accept within 12 hours.',
    '/equipment/handover/' || v_id);
  RETURN v_id;
END;
$fn$;

DROP FUNCTION IF EXISTS public.respond_equipment_transfer(uuid, boolean, text);

CREATE OR REPLACE FUNCTION public.respond_equipment_transfer(
  p_transfer_id uuid, p_accept boolean, p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  t public.equipment_transfers%ROWTYPE;
  l public.equipment_loans%ROWTYPE;
  u public.equipment_units%ROWTYPE;
  i public.equipment_items%ROWTYPE;
  v_code text;
  v_by timestamptz;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO t FROM public.equipment_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer not found'; END IF;
  SELECT * INTO l FROM public.equipment_loans WHERE id = t.from_loan_id FOR UPDATE;
  IF l.requester_id IS DISTINCT FROM uid OR NOT public.is_equipment_member(t.organization_id) THEN
    RAISE EXCEPTION 'transfer not found';
  END IF;
  IF t.status <> 'requested' THEN RAISE EXCEPTION 'transfer is no longer open (%)', t.status; END IF;
  IF t.respond_by IS NOT NULL AND t.respond_by < now() THEN
    PERFORM public.equipment_abort_handover(t.id, 'accept window');
    RETURN jsonb_build_object('ok', false, 'error', 'This request has expired. Ask again if you still need it.');
  END IF;
  SELECT * INTO u FROM public.equipment_units WHERE id = t.unit_id FOR UPDATE;
  SELECT * INTO i FROM public.equipment_items WHERE id = u.item_id;
  IF NOT coalesce(p_accept, false) THEN
    UPDATE public.equipment_transfers
       SET status = 'declined', responded_at = now(), response_note = nullif(trim(left(p_note, 500)), '')
     WHERE id = t.id;
    PERFORM public.equipment_ledger_append(t.organization_id, 'transfer_declined', u.id, i.id, NULL, NULL, uid,
      jsonb_build_object('transfer_id', t.id));
    PERFORM public.equipment_notify_user(t.to_user_id, 'Transfer declined: ' || i.name,
      coalesce(public.equipment_display_name(uid), 'The holder') || ' declined to hand over ' || i.name || '.',
      '/equipment/mine');
    RETURN jsonb_build_object('ok', true, 'status', 'declined');
  END IF;
  IF l.status <> 'active' OR u.status <> 'checked_out' OR u.current_holder_id IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'this unit can no longer be transferred (%)', u.status;
  END IF;
  IF i.requires_certification AND NOT public.equipment_has_certification(t.to_user_id, i.id) THEN
    RAISE EXCEPTION 'the requester has no training sign-off for this item';
  END IF;
  IF NOT public.equipment_user_can_borrow(t.to_user_id, t.organization_id) THEN
    RAISE EXCEPTION 'the requester is no longer a patrol member here';
  END IF;
  v_by := coalesce(t.requested_for, now()) + interval '6 hours';
  v_code := public.equipment_new_handover_code(t.id);
  UPDATE public.equipment_transfers
     SET status = 'accepted', responded_at = now(), handover_by = v_by,
         response_note = nullif(trim(left(p_note, 500)), '')
   WHERE id = t.id;
  PERFORM public.equipment_set_unit_status_ex(u.id, 'in_transfer', uid, 'hand-over accepted',
    jsonb_build_object('transfer_id', t.id, 'action', 'transfer'));
  UPDATE public.equipment_transfers SET status = 'expired', responded_at = now()
   WHERE unit_id = u.id AND status = 'requested' AND id <> t.id;
  PERFORM public.equipment_ledger_append(t.organization_id, 'transfer_accepted', u.id, i.id, 'checked_out', 'in_transfer', uid,
    jsonb_build_object('transfer_id', t.id, 'handover_by', v_by));
  PERFORM public.equipment_notify_user(t.to_user_id, 'Hand-over accepted: ' || i.name,
    'Meet the holder and enter their 6-digit code within 6 hours. ' || u.asset_tag || ' is not yours until you both confirm.',
    '/equipment/handover/' || t.id);
  RETURN jsonb_build_object('ok', true, 'status', 'accepted', 'code', v_code, 'handover_by', v_by, 'transfer_id', t.id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.confirm_equipment_handover_giver(p_transfer_id uuid)
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
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO t FROM public.equipment_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR t.from_user_id IS DISTINCT FROM uid OR NOT public.is_equipment_member(t.organization_id) THEN
    RAISE EXCEPTION 'transfer not found';
  END IF;
  IF t.status <> 'accepted' THEN RAISE EXCEPTION 'transfer is no longer open (%)', t.status; END IF;
  IF t.handover_by IS NOT NULL AND t.handover_by < now() THEN
    PERFORM public.equipment_abort_handover(t.id, 'hand-over window');
    RETURN jsonb_build_object('ok', false, 'error', 'This hand-over has expired. The unit is still with the holder.');
  END IF;
  v_first := t.giver_confirmed_at IS NULL;
  IF v_first THEN
    UPDATE public.equipment_transfers SET giver_confirmed_at = now() WHERE id = t.id;
    PERFORM public.equipment_ledger_append(t.organization_id, 'handover_giver_confirmed', t.unit_id, NULL, NULL, NULL, uid,
      jsonb_build_object('transfer_id', t.id));
  END IF;
  SELECT * INTO t FROM public.equipment_transfers WHERE id = t.id;
  IF t.receiver_confirmed_at IS NOT NULL THEN
    v_new := public.equipment_finish_handover(t.id, 'completed', false);
    RETURN jsonb_build_object('ok', true, 'completed', true, 'loan_id', v_new);
  END IF;
  RETURN jsonb_build_object('ok', true, 'completed', false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.confirm_equipment_handover_receiver(
  p_transfer_id uuid, p_code text, p_condition text DEFAULT NULL, p_ack boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  t public.equipment_transfers%ROWTYPE;
  v_code text := trim(coalesce(p_code, ''));
  v_hash text;
  v_new uuid;
  v_left int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO t FROM public.equipment_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR t.to_user_id IS DISTINCT FROM uid OR NOT public.is_equipment_member(t.organization_id) THEN
    RAISE EXCEPTION 'transfer not found';
  END IF;
  IF t.status <> 'accepted' THEN RAISE EXCEPTION 'transfer is no longer open (%)', t.status; END IF;
  IF t.handover_by IS NOT NULL AND t.handover_by < now() THEN
    PERFORM public.equipment_abort_handover(t.id, 'hand-over window');
    RETURN jsonb_build_object('ok', false, 'error', 'This hand-over has expired. The unit is still with the holder.');
  END IF;
  IF NOT coalesce(p_ack, false) THEN
    RAISE EXCEPTION 'tick the box to accept responsibility for this unit';
  END IF;
  IF p_condition IS NOT NULL AND p_condition NOT IN ('new', 'good', 'fair', 'poor') THEN
    RAISE EXCEPTION 'invalid condition';
  END IF;
  IF t.code_attempts >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'locked', true, 'error', 'Too many wrong codes. Ask the holder for a new code.');
  END IF;
  IF v_code !~ '^[0-9]{6}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Enter the 6-digit code from the holder.');
  END IF;
  v_hash := encode(extensions.digest(v_code || ':' || t.id::text, 'sha256'), 'hex');
  IF t.code_hash IS DISTINCT FROM v_hash THEN
    UPDATE public.equipment_transfers SET code_attempts = code_attempts + 1 WHERE id = t.id RETURNING code_attempts INTO v_left;
    IF v_left >= 5 THEN
      RETURN jsonb_build_object('ok', false, 'locked', true, 'error', 'Too many wrong codes. Ask the holder for a new code.');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'That code does not match.', 'attempts_left', 5 - v_left);
  END IF;
  UPDATE public.equipment_transfers
     SET receiver_confirmed_at = coalesce(receiver_confirmed_at, now()),
         receiver_condition = coalesce(p_condition, receiver_condition),
         receiver_ack = true
   WHERE id = t.id;
  IF t.receiver_confirmed_at IS NULL THEN
    PERFORM public.equipment_ledger_append(t.organization_id, 'handover_receiver_confirmed', t.unit_id, NULL, NULL, NULL, uid,
      jsonb_build_object('transfer_id', t.id, 'condition', p_condition));
  END IF;
  SELECT * INTO t FROM public.equipment_transfers WHERE id = t.id;
  IF t.giver_confirmed_at IS NOT NULL THEN
    v_new := public.equipment_finish_handover(t.id, 'completed', false);
    RETURN jsonb_build_object('ok', true, 'completed', true, 'loan_id', v_new);
  END IF;
  RETURN jsonb_build_object('ok', true, 'completed', false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.regenerate_equipment_handover_code(p_transfer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  t public.equipment_transfers%ROWTYPE;
  v_code text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO t FROM public.equipment_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR t.from_user_id IS DISTINCT FROM uid OR NOT public.is_equipment_member(t.organization_id) THEN
    RAISE EXCEPTION 'transfer not found';
  END IF;
  IF t.status <> 'accepted' THEN RAISE EXCEPTION 'transfer is no longer open (%)', t.status; END IF;
  IF t.handover_by IS NOT NULL AND t.handover_by < now() THEN
    PERFORM public.equipment_abort_handover(t.id, 'hand-over window');
    RETURN jsonb_build_object('ok', false, 'error', 'This hand-over has expired. The unit is still with the holder.');
  END IF;
  v_code := public.equipment_new_handover_code(t.id);
  PERFORM public.equipment_notify_user(t.to_user_id, 'New hand-over code',
    'The holder created a new code. Ask them for it. The old code no longer works.',
    '/equipment/handover/' || t.id);
  RETURN jsonb_build_object('ok', true, 'code', v_code, 'handover_by', t.handover_by);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cancel_equipment_transfer(p_transfer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  t public.equipment_transfers%ROWTYPE;
  u public.equipment_units%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO t FROM public.equipment_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_equipment_member(t.organization_id) THEN RAISE EXCEPTION 'transfer not found'; END IF;
  IF uid IS DISTINCT FROM t.to_user_id AND uid IS DISTINCT FROM t.from_user_id THEN
    RAISE EXCEPTION 'transfer not found';
  END IF;
  IF t.status = 'requested' AND uid IS DISTINCT FROM t.to_user_id THEN
    RAISE EXCEPTION 'transfer not found';
  END IF;
  IF t.status NOT IN ('requested', 'accepted') THEN RAISE EXCEPTION 'transfer is no longer open (%)', t.status; END IF;
  IF t.status = 'accepted' THEN
    SELECT * INTO u FROM public.equipment_units WHERE id = t.unit_id FOR UPDATE;
    IF u.status = 'in_transfer' THEN
      PERFORM public.equipment_set_unit_status_ex(u.id, 'checked_out', t.from_user_id, 'hand-over cancelled',
        jsonb_build_object('transfer_id', t.id, 'action', 'transfer_cancel'));
    END IF;
  END IF;
  UPDATE public.equipment_transfers SET status = 'cancelled', responded_at = now() WHERE id = t.id;
  PERFORM public.equipment_ledger_append(t.organization_id, 'transfer_cancelled', t.unit_id, NULL, NULL, NULL, uid,
    jsonb_build_object('transfer_id', t.id));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.force_complete_equipment_transfer(p_transfer_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  t public.equipment_transfers%ROWTYPE;
  v_reason text := trim(coalesce(p_reason, ''));
  v_new uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF char_length(v_reason) < 10 THEN RAISE EXCEPTION 'say why this hand-over is being completed (at least 10 characters)'; END IF;
  SELECT * INTO t FROM public.equipment_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_equipment(t.organization_id) THEN RAISE EXCEPTION 'transfer not found'; END IF;
  IF uid IN (t.from_user_id, t.to_user_id) THEN
    RAISE EXCEPTION 'use the hand-over code; an admin cannot force their own hand-over';
  END IF;
  IF t.status NOT IN ('requested', 'accepted') THEN RAISE EXCEPTION 'transfer is no longer open (%)', t.status; END IF;
  IF t.status = 'requested' THEN
    UPDATE public.equipment_transfers
       SET status = 'accepted', responded_at = now(), handover_by = now() + interval '6 hours'
     WHERE id = t.id;
  END IF;
  UPDATE public.equipment_transfers
     SET giver_confirmed_at = coalesce(giver_confirmed_at, now()),
         receiver_confirmed_at = coalesce(receiver_confirmed_at, now()),
         forced_by = uid, forced_reason = left(v_reason, 500)
   WHERE id = t.id;
  PERFORM public.equipment_ledger_append(t.organization_id, 'transfer_forced', t.unit_id, NULL, NULL, NULL, uid,
    jsonb_build_object('transfer_id', t.id, 'reason', left(v_reason, 500)));
  v_new := public.equipment_finish_handover(t.id, 'forced', true);
  RETURN v_new;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.get_equipment_handover(p_transfer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  t public.equipment_transfers%ROWTYPE;
  v_party boolean;
  v_mgr boolean;
  v_other uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO t FROM public.equipment_transfers WHERE id = p_transfer_id;
  IF NOT FOUND OR NOT public.is_equipment_member(t.organization_id) THEN RAISE EXCEPTION 'transfer not found'; END IF;
  v_mgr := public.can_manage_equipment(t.organization_id);
  v_party := uid IN (t.from_user_id, t.to_user_id);
  IF NOT v_party AND NOT v_mgr THEN RAISE EXCEPTION 'transfer not found'; END IF;
  v_other := CASE WHEN uid = t.from_user_id THEN t.to_user_id ELSE t.from_user_id END;
  RETURN jsonb_build_object(
    'id', t.id, 'unit_id', t.unit_id, 'status', t.status, 'note', t.note,
    'respond_by', t.respond_by, 'handover_by', t.handover_by, 'requested_for', t.requested_for,
    'giver_confirmed', t.giver_confirmed_at IS NOT NULL,
    'receiver_confirmed', t.receiver_confirmed_at IS NOT NULL,
    'i_am_giver', uid = t.from_user_id, 'i_am_receiver', uid = t.to_user_id, 'can_manage', v_mgr,
    'asset_tag', (SELECT asset_tag FROM public.equipment_units WHERE id = t.unit_id),
    'item_name', (SELECT i.name FROM public.equipment_items i
                    JOIN public.equipment_units u ON u.item_id = i.id WHERE u.id = t.unit_id),
    'giver_name', public.equipment_display_name(t.from_user_id),
    'receiver_name', public.equipment_display_name(t.to_user_id),
    'other_name', public.equipment_display_name(v_other),
    'other_phone', CASE WHEN t.status IN ('requested', 'accepted') AND (v_party OR v_mgr) THEN (
      SELECT nullif(trim(phone), '') FROM public.users WHERE id = v_other) ELSE NULL END
  );
END;
$fn$;

DROP FUNCTION IF EXISTS public.list_my_equipment_transfers();

CREATE OR REPLACE FUNCTION public.list_my_equipment_transfers()
RETURNS TABLE (
  id uuid, direction text, unit_id uuid, asset_tag text, item_id uuid, item_name text,
  other_name text, status text, note text, response_note text, created_at timestamptz, responded_at timestamptz,
  respond_by timestamptz, handover_by timestamptz, giver_confirmed boolean, receiver_confirmed boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN QUERY
  SELECT t.id, CASE WHEN t.to_user_id = auth.uid() THEN 'outgoing' ELSE 'incoming' END,
         t.unit_id, u.asset_tag, i.id, i.name,
         public.equipment_display_name(CASE WHEN t.to_user_id = auth.uid() THEN t.from_user_id ELSE t.to_user_id END),
         t.status, t.note, t.response_note, t.created_at, t.responded_at,
         t.respond_by, t.handover_by, t.giver_confirmed_at IS NOT NULL, t.receiver_confirmed_at IS NOT NULL
  FROM public.equipment_transfers t
  JOIN public.equipment_units u ON u.id = t.unit_id
  JOIN public.equipment_items i ON i.id = u.item_id
  JOIN public.equipment_loans l ON l.id = t.from_loan_id
  WHERE public.is_equipment_member(t.organization_id)
    AND (t.to_user_id = auth.uid() OR l.requester_id = auth.uid())
    AND (t.status IN ('requested', 'accepted') OR t.created_at > now() - interval '30 days')
  ORDER BY (t.status IN ('requested', 'accepted')) DESC, t.created_at DESC
  LIMIT 100;
END;
$fn$;

REVOKE ALL ON FUNCTION public.equipment_new_handover_code(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_new_handover_code(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.equipment_finish_handover(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_finish_handover(uuid, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.equipment_abort_handover(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_abort_handover(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.request_equipment_transfer(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_equipment_transfer(uuid, text, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.respond_equipment_transfer(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_equipment_transfer(uuid, boolean, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_equipment_handover_giver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_equipment_handover_giver(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_equipment_handover_receiver(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_equipment_handover_receiver(uuid, text, text, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.regenerate_equipment_handover_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerate_equipment_handover_code(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_equipment_transfer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_equipment_transfer(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.force_complete_equipment_transfer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.force_complete_equipment_transfer(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_equipment_handover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_equipment_handover(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_my_equipment_transfers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_equipment_transfers() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.equipment_apply_write_off(p_unit uuid, p_issue uuid, p_note text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  u public.equipment_units%ROWTYPE;
  w public.equipment_write_offs%ROWTYPE;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO u FROM public.equipment_units WHERE id = p_unit FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_equipment(u.organization_id) THEN RAISE EXCEPTION 'unit not found'; END IF;
  IF u.status = 'retired' THEN RETURN 'retired'; END IF;
  IF NOT public.equipment_transition_allowed(u.status, 'retired') THEN
    RAISE EXCEPTION 'a % unit cannot be written off', u.status;
  END IF;
  SELECT * INTO w FROM public.equipment_write_offs WHERE unit_id = u.id AND status = 'pending' FOR UPDATE;
  IF coalesce(u.purchase_price_cents, 0) >= 200000 THEN
    IF NOT FOUND THEN
      INSERT INTO public.equipment_write_offs (organization_id, unit_id, issue_id, value_cents, note, proposed_by)
      VALUES (u.organization_id, u.id, p_issue, u.purchase_price_cents, left(v_note, 500), uid);
      PERFORM public.equipment_ledger_append(u.organization_id, 'write_off_proposed', u.id, u.item_id, u.status, NULL, NULL,
        jsonb_build_object('value_cents', u.purchase_price_cents, 'issue_id', p_issue));
      PERFORM public.write_staff_activity('equipment_write_off_proposed',
        jsonb_build_object('unit_id', u.id, 'value_cents', u.purchase_price_cents, 'no_charge', true), uid, u.organization_id);
      RETURN 'pending';
    END IF;
    IF w.proposed_by = uid THEN
      RAISE EXCEPTION 'a different admin must approve a write-off of R2,000 or more';
    END IF;
    UPDATE public.equipment_write_offs
       SET status = 'approved', approved_by = uid, approved_at = now(), issue_id = coalesce(issue_id, p_issue)
     WHERE id = w.id;
  ELSE
    INSERT INTO public.equipment_write_offs (
      organization_id, unit_id, issue_id, value_cents, note, proposed_by, approved_by, approved_at, status)
    VALUES (u.organization_id, u.id, p_issue, u.purchase_price_cents, left(v_note, 500), uid, uid, now(), 'approved');
  END IF;
  PERFORM public.equipment_set_unit_status_ex(u.id, 'retired', NULL, coalesce(v_note, 'written off'),
    jsonb_build_object('action', 'write_off', 'issue_id', p_issue, 'value_cents', u.purchase_price_cents));
  PERFORM public.equipment_ledger_append(u.organization_id, 'write_off_approved', u.id, u.item_id, u.status, 'retired', NULL,
    jsonb_build_object('value_cents', u.purchase_price_cents, 'no_charge', true));
  PERFORM public.write_staff_activity('equipment_write_off_approved',
    jsonb_build_object('unit_id', u.id, 'value_cents', u.purchase_price_cents, 'no_charge', true), uid, u.organization_id);
  RETURN 'retired';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.equipment_normalize_cas(p_case text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
  v text := upper(trim(regexp_replace(coalesce(p_case, ''), '\s+', ' ', 'g')));
  m text[];
BEGIN
  IF v = '' THEN RETURN NULL; END IF;
  IF v !~ '^CAS\s?[0-9]{1,6}/[0-9]{1,2}/[0-9]{4}$' THEN
    RAISE EXCEPTION 'enter a SAPS case number like CAS 123/10/2026';
  END IF;
  m := regexp_match(v, '^CAS\s?([0-9]{1,6})/([0-9]{1,2})/([0-9]{4})$');
  RETURN 'CAS ' || m[1] || '/' || m[2] || '/' || m[3];
END;
$fn$;

DROP FUNCTION IF EXISTS public.report_equipment_issue(uuid, text, text);

CREATE OR REPLACE FUNCTION public.report_equipment_issue(
  p_unit_id uuid, p_kind text, p_note text,
  p_saps_case text DEFAULT NULL, p_saps_station text DEFAULT NULL, p_location text DEFAULT NULL
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
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO u FROM public.equipment_units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_equipment_member(u.organization_id) THEN RAISE EXCEPTION 'unit not found'; END IF;
  IF v_kind NOT IN ('damage', 'theft', 'malfunction') THEN RAISE EXCEPTION 'unknown issue type'; END IF;
  IF char_length(v_note) < 3 OR char_length(v_note) > 1000 THEN RAISE EXCEPTION 'describe what happened (3 to 1000 characters)'; END IF;
  IF p_location IS NOT NULL AND char_length(trim(p_location)) > 120 THEN RAISE EXCEPTION 'location is too long'; END IF;
  IF p_saps_station IS NOT NULL AND char_length(trim(p_saps_station)) > 80 THEN RAISE EXCEPTION 'police station name is too long'; END IF;
  v_case := CASE WHEN v_kind = 'theft' THEN public.equipment_normalize_cas(p_saps_case) ELSE NULL END;
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
      'cas_pending', v_kind = 'theft' AND v_case IS NULL));
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
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.add_equipment_issue_case_number(
  p_issue_id uuid, p_case text, p_station text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  r public.equipment_issue_reports%ROWTYPE;
  v_case text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO r FROM public.equipment_issue_reports WHERE id = p_issue_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_equipment_member(r.organization_id) THEN RAISE EXCEPTION 'issue not found'; END IF;
  IF uid IS DISTINCT FROM r.reporter_id AND NOT public.can_manage_equipment(r.organization_id) THEN
    RAISE EXCEPTION 'issue not found';
  END IF;
  IF r.kind <> 'theft' THEN RAISE EXCEPTION 'only a theft report takes a SAPS case number'; END IF;
  v_case := public.equipment_normalize_cas(p_case);
  IF v_case IS NULL THEN RAISE EXCEPTION 'enter a SAPS case number like CAS 123/10/2026'; END IF;
  UPDATE public.equipment_issue_reports
     SET saps_case_number = v_case, saps_station = coalesce(nullif(trim(p_station), ''), saps_station), cas_reminder_at = NULL
   WHERE id = r.id;
  PERFORM public.equipment_ledger_append(r.organization_id, 'incident_updated', r.unit_id, NULL, NULL, NULL, uid,
    jsonb_build_object('issue_id', r.id, 'saps_case_number', v_case));
END;
$fn$;

DROP FUNCTION IF EXISTS public.clear_equipment_issue(uuid, text, text);

CREATE OR REPLACE FUNCTION public.clear_equipment_issue(
  p_issue_id uuid, p_outcome text DEFAULT 'available', p_note text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r public.equipment_issue_reports%ROWTYPE;
  v_status text;
  v_out text := lower(trim(coalesce(p_outcome, 'available')));
  v_result text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO r FROM public.equipment_issue_reports WHERE id = p_issue_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_equipment(r.organization_id) THEN RAISE EXCEPTION 'issue not found'; END IF;
  IF r.cleared_at IS NOT NULL THEN RAISE EXCEPTION 'issue already cleared'; END IF;
  IF v_out NOT IN ('available', 'under_repair', 'retired') THEN RAISE EXCEPTION 'invalid outcome'; END IF;
  IF v_out = 'retired' THEN
    v_result := public.equipment_apply_write_off(r.unit_id, r.id, p_note);
    IF v_result = 'pending' THEN RETURN 'pending'; END IF;
  ELSE
    UPDATE public.equipment_write_offs SET status = 'cancelled'
     WHERE unit_id = r.unit_id AND status = 'pending';
    SELECT status INTO v_status FROM public.equipment_units WHERE id = r.unit_id;
    IF v_status <> v_out THEN
      IF NOT public.equipment_transition_allowed(v_status, v_out) THEN
        RAISE EXCEPTION 'a % unit cannot go to %', v_status, v_out;
      END IF;
      PERFORM public.equipment_set_unit_status_ex(r.unit_id, v_out, NULL,
        coalesce(nullif(trim(p_note), ''), 'issue cleared'),
        jsonb_build_object('issue_id', r.id, 'action', 'clear_issue'));
    END IF;
  END IF;
  UPDATE public.equipment_issue_reports
     SET cleared_at = now(), cleared_by = auth.uid(), resolution = v_out,
         resolution_note = nullif(trim(left(p_note, 500)), '')
   WHERE id = r.id;
  RETURN 'cleared';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.approve_equipment_write_off(p_unit_id uuid, p_note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_result text;
  v_org uuid;
  v_issue uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT organization_id INTO v_org FROM public.equipment_units WHERE id = p_unit_id;
  IF v_org IS NULL OR NOT public.can_manage_equipment(v_org) THEN RAISE EXCEPTION 'unit not found'; END IF;
  v_result := public.equipment_apply_write_off(p_unit_id, NULL, p_note);
  IF v_result = 'retired' THEN
    SELECT id INTO v_issue FROM public.equipment_issue_reports
     WHERE unit_id = p_unit_id AND cleared_at IS NULL ORDER BY created_at DESC LIMIT 1;
    IF v_issue IS NOT NULL THEN
      UPDATE public.equipment_issue_reports
         SET cleared_at = now(), cleared_by = auth.uid(), resolution = 'retired',
             resolution_note = nullif(trim(left(p_note, 500)), '')
       WHERE id = v_issue;
    END IF;
  END IF;
  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.decide_equipment_liability(
  p_issue_id uuid, p_decision text, p_amount_cents bigint DEFAULT NULL, p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  r public.equipment_issue_reports%ROWTYPE;
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_amount bigint := p_amount_cents;
  v_label text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO r FROM public.equipment_issue_reports WHERE id = p_issue_id FOR UPDATE;
  IF NOT FOUND OR NOT (r.organization_id IN (SELECT public.current_org_ids())) THEN
    RAISE EXCEPTION 'issue not found';
  END IF;
  IF NOT public.is_org_nw_admin(r.organization_id) THEN
    RAISE EXCEPTION 'only an NW admin can decide liability';
  END IF;
  IF v_decision NOT IN ('no_fault', 'negligence_warning', 'contribution_requested') THEN
    RAISE EXCEPTION 'invalid liability decision';
  END IF;
  IF v_amount IS NOT NULL AND v_amount < 0 THEN RAISE EXCEPTION 'amount cannot be negative'; END IF;
  IF v_decision <> 'contribution_requested' THEN v_amount := NULL; END IF;
  UPDATE public.equipment_issue_reports
     SET liability_decision = v_decision, liability_amount_cents = v_amount,
         liability_note = nullif(trim(left(p_note, 500)), ''),
         liability_decided_by = uid, liability_decided_at = now()
   WHERE id = r.id;
  v_label := replace(v_decision, '_', ' ');
  PERFORM public.equipment_ledger_append(r.organization_id, 'liability_decided', r.unit_id, NULL, NULL, NULL, r.reporter_id,
    jsonb_build_object('issue_id', r.id, 'decision', v_decision, 'amount_cents', v_amount, 'no_charge', true));
  PERFORM public.write_staff_activity('equipment_liability_decided',
    jsonb_build_object('issue_id', r.id, 'decision', v_decision, 'amount_cents', v_amount, 'no_charge', true),
    uid, r.organization_id);
  PERFORM public.equipment_notify_user(r.reporter_id, 'Liability recorded',
    'An NW admin recorded ' || v_label || ' for this equipment issue. This is a record only. No charge was created.',
    '/equipment/units/' || r.unit_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.log_equipment_maintenance(
  p_unit_id uuid, p_kind text, p_note text DEFAULT NULL, p_vendor text DEFAULT NULL,
  p_cost_cents bigint DEFAULT NULL, p_next_due date DEFAULT NULL, p_performed_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  u public.equipment_units%ROWTYPE;
  v_kind text := lower(trim(coalesce(p_kind, '')));
  v_id uuid;
  v_when timestamptz := coalesce(p_performed_at, now());
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO u FROM public.equipment_units WHERE id = p_unit_id;
  IF NOT FOUND OR NOT public.can_manage_equipment(u.organization_id) THEN RAISE EXCEPTION 'unit not found'; END IF;
  IF v_kind NOT IN ('inspection', 'repair', 'service', 'battery_replaced', 'cleaning', 'calibration', 'other') THEN
    RAISE EXCEPTION 'unknown maintenance type';
  END IF;
  IF p_note IS NOT NULL AND char_length(trim(p_note)) > 1000 THEN RAISE EXCEPTION 'note is too long'; END IF;
  IF p_cost_cents IS NOT NULL AND p_cost_cents < 0 THEN RAISE EXCEPTION 'cost cannot be negative'; END IF;
  IF v_when > now() + interval '1 day' THEN RAISE EXCEPTION 'service date cannot be in the future'; END IF;
  INSERT INTO public.equipment_maintenance_logs (
    organization_id, unit_id, kind, note, vendor, cost_cents, performed_at, performed_by, next_due)
  VALUES (
    u.organization_id, u.id, v_kind, nullif(trim(p_note), ''), nullif(trim(p_vendor), ''),
    p_cost_cents, v_when, uid, p_next_due)
  RETURNING id INTO v_id;
  PERFORM public.equipment_ledger_append(u.organization_id, 'maintenance_logged', u.id, u.item_id, NULL, NULL, NULL,
    jsonb_build_object('maintenance_id', v_id, 'kind', v_kind, 'cost_cents', p_cost_cents));
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.list_equipment_maintenance(p_unit_id uuid)
RETURNS TABLE (
  id uuid, kind text, note text, vendor text, cost_cents bigint, performed_at timestamptz,
  performed_by_name text, next_due date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT organization_id INTO v_org FROM public.equipment_units WHERE equipment_units.id = p_unit_id;
  IF v_org IS NULL OR NOT public.is_equipment_member(v_org) THEN RAISE EXCEPTION 'unit not found'; END IF;
  RETURN QUERY
  SELECT m.id, m.kind, m.note, m.vendor, m.cost_cents, m.performed_at,
         public.equipment_display_name(m.performed_by), m.next_due
  FROM public.equipment_maintenance_logs m
  WHERE m.unit_id = p_unit_id AND m.organization_id = v_org
  ORDER BY m.performed_at DESC
  LIMIT 100;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.list_equipment_maintenance_recent()
RETURNS TABLE (
  id uuid, unit_id uuid, asset_tag text, item_name text, kind text, note text, vendor text,
  cost_cents bigint, performed_at timestamptz, performed_by_name text, next_due date
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
  SELECT m.id, m.unit_id, u.asset_tag, i.name, m.kind, m.note, m.vendor, m.cost_cents, m.performed_at,
         coalesce(pu.full_name, 'Admin'), m.next_due
  FROM public.equipment_maintenance_logs m
  JOIN public.equipment_units u ON u.id = m.unit_id
  JOIN public.equipment_items i ON i.id = u.item_id
  LEFT JOIN public.users pu ON pu.id = m.performed_by
  WHERE m.organization_id = v_org
  ORDER BY m.performed_at DESC
  LIMIT 40;
END;
$fn$;

REVOKE ALL ON FUNCTION public.equipment_apply_write_off(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_apply_write_off(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.equipment_normalize_cas(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_normalize_cas(text) TO service_role;
REVOKE ALL ON FUNCTION public.report_equipment_issue(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_equipment_issue(uuid, text, text, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.add_equipment_issue_case_number(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_equipment_issue_case_number(uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.clear_equipment_issue(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_equipment_issue(uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.approve_equipment_write_off(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_equipment_write_off(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.decide_equipment_liability(uuid, text, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_equipment_liability(uuid, text, bigint, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.log_equipment_maintenance(uuid, text, text, text, bigint, date, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_equipment_maintenance(uuid, text, text, text, bigint, date, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_equipment_maintenance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_equipment_maintenance(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_equipment_maintenance_recent() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_equipment_maintenance_recent() TO authenticated, service_role;

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

CREATE OR REPLACE FUNCTION public.get_equipment_item(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  i public.equipment_items%ROWTYPE;
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO i FROM public.equipment_items WHERE id = p_item_id;
  IF NOT FOUND OR NOT public.is_equipment_member(i.organization_id) THEN RAISE EXCEPTION 'item not found'; END IF;
  RETURN jsonb_build_object(
    'id', i.id, 'name', i.name, 'description', i.description, 'photo_path', i.photo_path,
    'photo_paths', to_jsonb(i.photo_paths), 'kit_contents', i.kit_contents, 'max_loan_hours', i.max_loan_hours,
    'requires_certification', i.requires_certification, 'is_archived', i.is_archived,
    'category_id', i.category_id,
    'category_name', (SELECT c.name FROM public.equipment_categories c WHERE c.id = i.category_id),
    'wishlist_item_id', i.wishlist_item_id,
    'can_manage', public.can_manage_equipment(i.organization_id),
    'can_borrow', public.equipment_user_can_borrow(uid, i.organization_id),
    'has_certification', public.equipment_has_certification(uid, i.id),
    'my_open_loan', (SELECT jsonb_build_object('id', l.id, 'status', l.status, 'unit_id', l.unit_id, 'due_at', l.due_at)
                     FROM public.equipment_loans l
                     WHERE l.item_id = i.id AND l.requester_id = uid AND l.status IN ('requested', 'approved', 'active')
                     LIMIT 1),
    'units', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'asset_tag', u.asset_tag, 'status', u.status, 'condition', u.condition,
        'holder_name', public.equipment_display_name(u.current_holder_id),
        'is_mine', coalesce(u.current_holder_id = uid, false), 'location_note', u.location_note,
        'due_at', (SELECT l.due_at FROM public.equipment_loans l WHERE l.unit_id = u.id AND l.status = 'active' LIMIT 1),
        'my_transfer_id', (SELECT t.id FROM public.equipment_transfers t
                           WHERE t.unit_id = u.id AND t.to_user_id = uid AND t.status = 'requested' LIMIT 1),
        'my_handover_id', (SELECT t.id FROM public.equipment_transfers t
                           WHERE t.unit_id = u.id AND t.status = 'accepted'
                             AND (t.from_user_id = uid OR t.to_user_id = uid) LIMIT 1),
        'issue', (SELECT jsonb_build_object('id', r.id, 'kind', r.kind, 'note', r.note, 'reported_at', r.created_at,
                                            'holder_name', public.equipment_display_name(r.reporter_id),
                                            'case_number', r.saps_case_number,
                                            'cas_pending', r.kind = 'theft' AND r.saps_case_number IS NULL)
                  FROM public.equipment_issue_reports r WHERE r.unit_id = u.id AND r.cleared_at IS NULL LIMIT 1),
        'last_holder_name', (SELECT public.equipment_display_name(l.requester_id) FROM public.equipment_loans l
                             WHERE l.unit_id = u.id AND l.collected_at IS NOT NULL
                             ORDER BY l.collected_at DESC LIMIT 1),
        'i_am_latest_holder', coalesce((SELECT l.requester_id = uid FROM public.equipment_loans l
                             WHERE l.unit_id = u.id AND l.collected_at IS NOT NULL
                             ORDER BY l.collected_at DESC LIMIT 1), false)
      ) ORDER BY u.asset_tag)
      FROM public.equipment_units u WHERE u.item_id = i.id AND u.status <> 'retired'), '[]'::jsonb)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.get_equipment_unit(p_unit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  u public.equipment_units%ROWTYPE;
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO u FROM public.equipment_units WHERE id = p_unit_id;
  IF NOT FOUND OR NOT public.is_equipment_member(u.organization_id) THEN RAISE EXCEPTION 'unit not found'; END IF;
  RETURN (
    SELECT jsonb_build_object(
      'id', u.id, 'item_id', u.item_id, 'item_name', i.name, 'item_photo_path', i.photo_path,
      'item_photo_paths', to_jsonb(i.photo_paths), 'kit_contents', i.kit_contents,
      'max_loan_hours', i.max_loan_hours,
      'category_name', c.name, 'requires_certification', i.requires_certification,
      'asset_tag', u.asset_tag, 'status', u.status, 'condition', u.condition,
      'holder_name', public.equipment_display_name(u.current_holder_id),
      'is_mine', coalesce(u.current_holder_id = uid, false),
      'location_note', u.location_note, 'photo_path', u.photo_path, 'updated_at', u.updated_at,
      'can_manage', public.can_manage_equipment(u.organization_id),
      'can_borrow', public.equipment_user_can_borrow(uid, u.organization_id),
      'has_certification', public.equipment_has_certification(uid, i.id),
      'due_at', (SELECT l.due_at FROM public.equipment_loans l WHERE l.unit_id = u.id AND l.status = 'active' LIMIT 1),
      'my_transfer_id', (SELECT t.id FROM public.equipment_transfers t
                         WHERE t.unit_id = u.id AND t.to_user_id = uid AND t.status = 'requested' LIMIT 1),
      'my_handover_id', (SELECT t.id FROM public.equipment_transfers t
                         WHERE t.unit_id = u.id AND t.status = 'accepted'
                           AND (t.from_user_id = uid OR t.to_user_id = uid) LIMIT 1),
      'issue', (SELECT jsonb_build_object('id', r.id, 'kind', r.kind, 'note', r.note, 'reported_at', r.created_at,
                                          'holder_name', public.equipment_display_name(r.reporter_id),
                                          'case_number', r.saps_case_number,
                                          'cas_pending', r.kind = 'theft' AND r.saps_case_number IS NULL)
                FROM public.equipment_issue_reports r WHERE r.unit_id = u.id AND r.cleared_at IS NULL LIMIT 1),
      'last_holder_name', (SELECT public.equipment_display_name(l.requester_id) FROM public.equipment_loans l
                           WHERE l.unit_id = u.id AND l.collected_at IS NOT NULL ORDER BY l.collected_at DESC LIMIT 1),
      'i_am_latest_holder', coalesce((SELECT l.requester_id = uid FROM public.equipment_loans l
                           WHERE l.unit_id = u.id AND l.collected_at IS NOT NULL ORDER BY l.collected_at DESC LIMIT 1), false))
    FROM public.equipment_items i
    LEFT JOIN public.equipment_categories c ON c.id = i.category_id
    WHERE i.id = u.item_id
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_equipment_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_equipment_item(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_equipment_unit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_equipment_unit(uuid) TO authenticated, service_role;

DO $p3c_present$
DECLARE
  missing text;
  names text[] := ARRAY[
    'equipment_new_handover_code', 'equipment_finish_handover', 'equipment_abort_handover',
    'request_equipment_transfer', 'respond_equipment_transfer', 'confirm_equipment_handover_giver',
    'confirm_equipment_handover_receiver', 'regenerate_equipment_handover_code',
    'cancel_equipment_transfer', 'force_complete_equipment_transfer', 'get_equipment_handover',
    'list_my_equipment_transfers', 'equipment_apply_write_off', 'equipment_normalize_cas',
    'report_equipment_issue', 'add_equipment_issue_case_number', 'clear_equipment_issue',
    'approve_equipment_write_off', 'decide_equipment_liability', 'log_equipment_maintenance',
    'list_equipment_maintenance', 'list_equipment_maintenance_recent',
    'equipment_notify_custodians', 'equipment_notify_nw_admins', 'equipment_housekeeping_org',
    'equipment_sweep', 'run_equipment_housekeeping', 'confirm_equipment_return',
    'extend_equipment_loan', 'set_equipment_unit_status_admin', 'list_equipment_issues_admin',
    'equipment_pending_counts', 'get_equipment_item', 'get_equipment_unit'
  ];
BEGIN
  SELECT string_agg(u.name, ', ' ORDER BY u.name) INTO missing
  FROM unnest(names) AS u(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = u.name
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'P3c functions still missing: %', missing;
  END IF;
  IF to_regclass('public.equipment_write_offs') IS NULL
     OR to_regclass('public.equipment_maintenance_logs') IS NULL THEN
    RAISE EXCEPTION 'P3c tables equipment_write_offs or equipment_maintenance_logs are missing';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_policy pol
       JOIN pg_class c ON c.oid = pol.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND pol.polname = 'equipment_write_offs_select')
     OR NOT EXISTS (
       SELECT 1 FROM pg_policy pol
       JOIN pg_class c ON c.oid = pol.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND pol.polname = 'equipment_maintenance_select') THEN
    RAISE EXCEPTION 'P3c policies equipment_write_offs_select or equipment_maintenance_select are missing';
  END IF;
END
$p3c_present$;
