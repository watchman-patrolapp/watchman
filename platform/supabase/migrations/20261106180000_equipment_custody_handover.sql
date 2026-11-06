-- =============================================================================
-- P3c - Equipment hand-over codes. Additive on 20261101040000. Idempotent.
-- A transfer stays with the current holder until BOTH patrollers confirm.
-- The holder has 12 hours to accept. After accept, both have 6 hours to
-- finish the hand-over (a 6-digit code, shown once to the holder). Otherwise
-- it expires and the unit stays with the original holder.
-- Does not write charges. Do not apply this file to production from CI.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $drop$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.equipment_transfers'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.equipment_transfers DROP CONSTRAINT %I', r.conname);
  END LOOP;
END
$drop$;

ALTER TABLE public.equipment_transfers
  ADD CONSTRAINT equipment_transfers_status_check
  CHECK (status IN ('requested', 'accepted', 'completed', 'declined', 'cancelled', 'expired', 'forced'));

-- Finished P3b rows used status 'accepted' for a completed hand-over.
UPDATE public.equipment_transfers
   SET status = 'completed'
 WHERE status = 'accepted' AND to_loan_id IS NOT NULL;

ALTER TABLE public.equipment_transfers
  ADD COLUMN IF NOT EXISTS requested_for timestamptz,
  ADD COLUMN IF NOT EXISTS respond_by timestamptz,
  ADD COLUMN IF NOT EXISTS handover_by timestamptz,
  ADD COLUMN IF NOT EXISTS code_hash text,
  ADD COLUMN IF NOT EXISTS code_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS giver_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS receiver_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS receiver_condition text,
  ADD COLUMN IF NOT EXISTS receiver_ack boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS forced_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS forced_reason text;

ALTER TABLE public.equipment_transfers DROP CONSTRAINT IF EXISTS equipment_transfers_receiver_condition_check;
ALTER TABLE public.equipment_transfers
  ADD CONSTRAINT equipment_transfers_receiver_condition_check
  CHECK (receiver_condition IS NULL OR receiver_condition IN ('new', 'good', 'fair', 'poor'));

ALTER TABLE public.equipment_transfers DROP CONSTRAINT IF EXISTS equipment_transfers_forced_reason_check;
ALTER TABLE public.equipment_transfers
  ADD CONSTRAINT equipment_transfers_forced_reason_check
  CHECK (forced_reason IS NULL OR char_length(forced_reason) <= 500);

UPDATE public.equipment_transfers
   SET respond_by = created_at + interval '12 hours'
 WHERE respond_by IS NULL AND status = 'requested';

CREATE UNIQUE INDEX IF NOT EXISTS equipment_transfers_one_handover
  ON public.equipment_transfers (unit_id) WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS equipment_transfers_respond_by_idx
  ON public.equipment_transfers (respond_by) WHERE status = 'requested';
CREATE INDEX IF NOT EXISTS equipment_transfers_handover_by_idx
  ON public.equipment_transfers (handover_by) WHERE status = 'accepted';

DO $drop$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.equipment_ledger'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%event%'
  LOOP
    EXECUTE format('ALTER TABLE public.equipment_ledger DROP CONSTRAINT %I', r.conname);
  END LOOP;
END
$drop$;

ALTER TABLE public.equipment_ledger
  ADD CONSTRAINT equipment_ledger_event_check
  CHECK (event IN (
    'item_created', 'item_updated', 'unit_added', 'unit_updated', 'qr_rotated',
    'status_changed', 'certification_granted', 'certification_revoked',
    'transfer_requested', 'transfer_accepted', 'transfer_declined', 'transfer_expired',
    'transfer_cancelled', 'handover_giver_confirmed', 'handover_receiver_confirmed',
    'transfer_forced', 'maintenance_logged', 'incident_updated',
    'write_off_proposed', 'write_off_approved', 'liability_decided', 'overdue_escalated'
  ));

-- -----------------------------------------------------------------------------
-- Internal helpers (service_role only)
-- -----------------------------------------------------------------------------
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
