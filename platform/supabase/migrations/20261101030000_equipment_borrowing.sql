-- =============================================================================
-- P3b - Equipment borrowing: loan requests, admin approval, collection and
-- return, holder-approved transfers, issue reports, functional training
-- sign-offs, overdue/expiry sweep, in-app notifications.
-- Additive on top of 20261101020000 + 20261101021000. Idempotent (safe to run
-- twice). No existing rows are changed. Org-scoped; cross-org = "not found".
--
-- Rules:
--   * Every unit status/holder change goes through equipment_set_unit_status_ex
--     (same checks as equipment_set_unit_status, plus a richer ledger payload),
--     so each change is one hash-chained ledger row.
--   * Loans/transfers/issues tables have no client grants: RPCs only.
--   * An item with requires_certification can only be requested (or received
--     by transfer) by someone with an active sign-off for that item.
--   * Requests and transfers not acted on for 7 days expire (sweep).
--   * Overdue = active loan past its agreed return time (due_at).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.equipment_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.equipment_items(id) ON DELETE RESTRICT,
  unit_id uuid REFERENCES public.equipment_units(id) ON DELETE RESTRICT,
  requester_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN (
    'requested', 'approved', 'active', 'returned', 'rejected', 'cancelled',
    'expired', 'transferred', 'issue_reported')),
  source text NOT NULL DEFAULT 'request' CHECK (source IN ('request', 'transfer')),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  desired_due_at timestamptz,
  due_at timestamptz,
  decided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  collected_at timestamptz,
  collected_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ended_at timestamptz,
  ended_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  return_condition text CHECK (return_condition IS NULL OR return_condition IN ('new', 'good', 'fair', 'poor')),
  return_note text CHECK (return_note IS NULL OR char_length(return_note) <= 500),
  overdue_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS equipment_loans_org_status_idx ON public.equipment_loans (organization_id, status);
CREATE INDEX IF NOT EXISTS equipment_loans_requester_idx ON public.equipment_loans (requester_id, status);
CREATE INDEX IF NOT EXISTS equipment_loans_unit_idx ON public.equipment_loans (unit_id, created_at);
-- One open request/loan per person per item; one open loan per unit (race guards).
CREATE UNIQUE INDEX IF NOT EXISTS equipment_loans_one_open_per_user_item
  ON public.equipment_loans (item_id, requester_id) WHERE status IN ('requested', 'approved', 'active');
CREATE UNIQUE INDEX IF NOT EXISTS equipment_loans_one_open_per_unit
  ON public.equipment_loans (unit_id) WHERE status IN ('approved', 'active');

CREATE TABLE IF NOT EXISTS public.equipment_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.equipment_units(id) ON DELETE RESTRICT,
  from_loan_id uuid NOT NULL REFERENCES public.equipment_loans(id) ON DELETE CASCADE,
  to_loan_id uuid REFERENCES public.equipment_loans(id) ON DELETE SET NULL,
  from_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  to_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN (
    'requested', 'accepted', 'declined', 'cancelled', 'expired')),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  response_note text CHECK (response_note IS NULL OR char_length(response_note) <= 500),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS equipment_transfers_org_status_idx ON public.equipment_transfers (organization_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_transfers_one_open
  ON public.equipment_transfers (unit_id, to_user_id) WHERE status = 'requested';

CREATE TABLE IF NOT EXISTS public.equipment_issue_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.equipment_units(id) ON DELETE RESTRICT,
  loan_id uuid REFERENCES public.equipment_loans(id) ON DELETE SET NULL,
  reporter_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('damage', 'theft', 'malfunction')),
  note text NOT NULL CHECK (char_length(trim(note)) BETWEEN 3 AND 1000),
  from_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz,
  cleared_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolution text CHECK (resolution IS NULL OR resolution IN ('available', 'under_repair', 'retired')),
  resolution_note text CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 500)
);
CREATE INDEX IF NOT EXISTS equipment_issue_reports_unit_idx ON public.equipment_issue_reports (unit_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_issue_reports_one_open
  ON public.equipment_issue_reports (unit_id) WHERE cleared_at IS NULL;

ALTER TABLE public.equipment_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_issue_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.equipment_loans, public.equipment_transfers, public.equipment_issue_reports
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.equipment_loans, public.equipment_transfers, public.equipment_issue_reports TO service_role;

-- -----------------------------------------------------------------------------
-- Internal helpers (service_role only)
-- -----------------------------------------------------------------------------
-- Same checks as equipment_set_unit_status; payload is merged into the ledger row.
CREATE OR REPLACE FUNCTION public.equipment_set_unit_status_ex(
  p_unit uuid, p_to text, p_holder uuid, p_reason text, p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  u public.equipment_units%ROWTYPE;
BEGIN
  SELECT * INTO u FROM public.equipment_units WHERE id = p_unit FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unit not found'; END IF;
  IF NOT public.equipment_transition_allowed(u.status, p_to) THEN
    RAISE EXCEPTION 'invalid status change % -> %', u.status, p_to;
  END IF;
  PERFORM set_config('app.equipment_status_write', 'on', true);
  UPDATE public.equipment_units
     SET status = p_to,
         current_holder_id = CASE WHEN p_to IN ('checked_out', 'overdue', 'in_transfer', 'reserved') THEN p_holder ELSE NULL END
   WHERE id = p_unit;
  PERFORM set_config('app.equipment_status_write', 'off', true);
  PERFORM public.equipment_ledger_append(u.organization_id, 'status_changed', u.id, u.item_id,
    u.status, p_to, p_holder,
    jsonb_build_object('reason', left(p_reason, 500)) || coalesce(p_payload, '{}'::jsonb));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.equipment_has_certification(p_user uuid, p_item uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.equipment_certifications c
    WHERE c.user_id = p_user AND c.item_id = p_item AND c.revoked_at IS NULL
      AND (c.expires_at IS NULL OR c.expires_at > now()));
$fn$;

-- p_user may borrow from p_org: patrol role and belongs to the org (no staff bypass).
CREATE OR REPLACE FUNCTION public.equipment_user_can_borrow(p_user uuid, p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT p_user IS NOT NULL AND p_org IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.users u
            WHERE u.id = p_user AND u.organization_id = p_org AND public.is_patrol_role(u.role::text))
    OR EXISTS (SELECT 1 FROM public.organization_members om
               WHERE om.user_id = p_user AND om.organization_id = p_org AND om.status = 'active'
                 AND public.is_patrol_role(om.member_role::text))
    OR EXISTS (SELECT 1 FROM public.users u
               JOIN public.organization_members om ON om.user_id = u.id
               WHERE u.id = p_user AND om.organization_id = p_org AND om.status = 'active'
                 AND public.is_patrol_role(u.role::text)));
$fn$;

-- NW admins of the org + global staff who belong to it.
CREATE OR REPLACE FUNCTION public.equipment_manager_notify_ids(p_org uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT u.id FROM public.users u
  WHERE lower(trim(u.role::text)) IN ('nw_admin', 'admin', 'technical_support')
    AND public.user_in_org(u.id, p_org)
    AND (lower(trim(u.role::text)) <> 'nw_admin' OR u.organization_id = p_org);
$fn$;

CREATE OR REPLACE FUNCTION public.equipment_notify_managers(p_org uuid, p_title text, p_body text, p_href text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  m uuid;
BEGIN
  FOR m IN SELECT DISTINCT x FROM public.equipment_manager_notify_ids(p_org) x
           WHERE x IS DISTINCT FROM auth.uid() LOOP
    PERFORM public.notify_app_user(m, 'equipment', left(p_title, 160), left(p_body, 500), p_href);
  END LOOP;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.equipment_notify_user(p_user uuid, p_title text, p_body text, p_href text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF p_user IS NULL OR p_user = auth.uid() THEN RETURN; END IF;
  PERFORM public.notify_app_user(p_user, 'equipment', left(p_title, 160), left(p_body, 500), p_href);
END;
$fn$;

-- Load a loan for a manager action (locks it). Cross-org = not found.
CREATE OR REPLACE FUNCTION public.equipment_manager_loan(p_loan_id uuid)
RETURNS public.equipment_loans
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  l public.equipment_loans%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO l FROM public.equipment_loans WHERE id = p_loan_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_equipment(l.organization_id) THEN RAISE EXCEPTION 'loan not found'; END IF;
  RETURN l;
END;
$fn$;

-- -----------------------------------------------------------------------------
-- Patroller: request / cancel
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_equipment_loan(
  p_item_id uuid, p_note text DEFAULT NULL, p_desired_due_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  i public.equipment_items%ROWTYPE;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_id uuid;
  v_recent int;
  who text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO i FROM public.equipment_items WHERE id = p_item_id FOR SHARE;
  IF NOT FOUND OR NOT public.is_equipment_member(i.organization_id) THEN RAISE EXCEPTION 'item not found'; END IF;
  IF NOT public.equipment_user_can_borrow(uid, i.organization_id) THEN
    RAISE EXCEPTION 'only patrol members of this neighbourhood can borrow equipment';
  END IF;
  IF i.is_archived THEN RAISE EXCEPTION 'this item is archived'; END IF;
  IF i.requires_certification AND NOT public.equipment_has_certification(uid, i.id) THEN
    RAISE EXCEPTION 'training sign-off required for this item';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN RAISE EXCEPTION 'note is too long'; END IF;
  IF p_desired_due_at IS NOT NULL THEN
    IF p_desired_due_at <= now() THEN RAISE EXCEPTION 'return time must be in the future'; END IF;
    IF p_desired_due_at > now() + make_interval(hours => coalesce(i.max_loan_hours, 720)) + interval '7 days' THEN
      RAISE EXCEPTION 'return time is beyond the maximum loan of % hours', coalesce(i.max_loan_hours, 720);
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.equipment_loans
             WHERE item_id = i.id AND requester_id = uid AND status IN ('requested', 'approved', 'active')) THEN
    RAISE EXCEPTION 'you already have an open request or loan for this item';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.equipment_units WHERE item_id = i.id AND status = 'available') THEN
    RAISE EXCEPTION 'no unit is available right now';
  END IF;
  SELECT count(*) INTO v_recent FROM public.equipment_loans
   WHERE requester_id = uid AND created_at > now() - interval '24 hours';
  IF v_recent >= 10 THEN RAISE EXCEPTION 'request limit reached (10 per 24 hours)'; END IF;

  BEGIN
    INSERT INTO public.equipment_loans (organization_id, item_id, requester_id, note, desired_due_at)
    VALUES (i.organization_id, i.id, uid, v_note, p_desired_due_at)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'you already have an open request or loan for this item';
  END;

  who := public.equipment_display_name(uid);
  PERFORM public.equipment_notify_managers(i.organization_id,
    'Borrow request: ' || i.name,
    coalesce(who, 'A patroller') || ' asked to borrow ' || i.name || coalesce(' - "' || left(v_note, 120) || '"', ''),
    '/equipment/admin/requests');
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cancel_equipment_loan_request(p_loan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  l public.equipment_loans%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO l FROM public.equipment_loans WHERE id = p_loan_id FOR UPDATE;
  IF NOT FOUND OR l.requester_id <> auth.uid() THEN RAISE EXCEPTION 'loan not found'; END IF;
  IF l.status NOT IN ('requested', 'approved') THEN RAISE EXCEPTION 'only open requests can be cancelled'; END IF;
  IF l.status = 'approved' AND l.unit_id IS NOT NULL THEN
    PERFORM public.equipment_set_unit_status_ex(l.unit_id, 'available', NULL, 'request cancelled by borrower',
      jsonb_build_object('loan_id', l.id, 'action', 'cancel'));
  END IF;
  UPDATE public.equipment_loans SET status = 'cancelled', ended_at = now(), ended_by = auth.uid(), updated_at = now()
   WHERE id = l.id;
END;
$fn$;

-- -----------------------------------------------------------------------------
-- Manager: approve / reject / collect / return
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_equipment_loan(p_loan_id uuid, p_unit_id uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  l public.equipment_loans%ROWTYPE := public.equipment_manager_loan(p_loan_id);
  i public.equipment_items%ROWTYPE;
  v_unit uuid := p_unit_id;
BEGIN
  IF l.status <> 'requested' THEN RAISE EXCEPTION 'request is no longer open (%)', l.status; END IF;
  SELECT * INTO i FROM public.equipment_items WHERE id = l.item_id;
  IF i.requires_certification AND NOT public.equipment_has_certification(l.requester_id, i.id) THEN
    RAISE EXCEPTION 'requester has no training sign-off for this item';
  END IF;
  IF NOT public.equipment_user_can_borrow(l.requester_id, l.organization_id) THEN
    RAISE EXCEPTION 'requester is no longer a patrol member here';
  END IF;
  IF v_unit IS NULL THEN
    SELECT u.id INTO v_unit FROM public.equipment_units u
     WHERE u.item_id = l.item_id AND u.status = 'available'
     ORDER BY u.asset_tag LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF v_unit IS NULL THEN RAISE EXCEPTION 'no unit is available'; END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.equipment_units u WHERE u.id = v_unit AND u.item_id = l.item_id) THEN
    RAISE EXCEPTION 'unit not found';
  END IF;
  IF (SELECT status FROM public.equipment_units WHERE id = v_unit FOR UPDATE) <> 'available' THEN
    RAISE EXCEPTION 'unit is not available';
  END IF;
  PERFORM public.equipment_set_unit_status_ex(v_unit, 'reserved', l.requester_id, 'loan approved',
    jsonb_build_object('loan_id', l.id, 'action', 'approve'));
  UPDATE public.equipment_loans
     SET status = 'approved', unit_id = v_unit, decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(trim(left(p_note, 500)), ''), updated_at = now()
   WHERE id = l.id;
  PERFORM public.equipment_notify_user(l.requester_id, 'Approved: ' || i.name,
    'Your request to borrow ' || i.name || ' (' || (SELECT asset_tag FROM public.equipment_units WHERE id = v_unit)
      || ') was approved. Collect it from an admin.',
    '/equipment/mine');
  RETURN v_unit;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.reject_equipment_loan(p_loan_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  l public.equipment_loans%ROWTYPE := public.equipment_manager_loan(p_loan_id);
  v_name text;
BEGIN
  IF l.status NOT IN ('requested', 'approved') THEN RAISE EXCEPTION 'request is no longer open (%)', l.status; END IF;
  IF l.status = 'approved' AND l.unit_id IS NOT NULL THEN
    PERFORM public.equipment_set_unit_status_ex(l.unit_id, 'available', NULL, 'approval withdrawn',
      jsonb_build_object('loan_id', l.id, 'action', 'reject'));
  END IF;
  UPDATE public.equipment_loans
     SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), ended_at = now(), ended_by = auth.uid(),
         decision_note = nullif(trim(left(p_note, 500)), ''), updated_at = now()
   WHERE id = l.id;
  SELECT name INTO v_name FROM public.equipment_items WHERE id = l.item_id;
  PERFORM public.equipment_notify_user(l.requester_id, 'Not approved: ' || v_name,
    'Your request to borrow ' || v_name || ' was declined' || coalesce(': ' || nullif(trim(p_note), ''), '.'),
    '/equipment/mine');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.confirm_equipment_collection(p_loan_id uuid, p_due_at timestamptz DEFAULT NULL)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  l public.equipment_loans%ROWTYPE := public.equipment_manager_loan(p_loan_id);
  i public.equipment_items%ROWTYPE;
  v_max interval;
  v_due timestamptz;
BEGIN
  IF l.status <> 'approved' THEN RAISE EXCEPTION 'loan is not waiting for collection (%)', l.status; END IF;
  SELECT * INTO i FROM public.equipment_items WHERE id = l.item_id;
  v_max := make_interval(hours => coalesce(i.max_loan_hours, 168));
  v_due := coalesce(p_due_at, l.desired_due_at, now() + v_max);
  IF v_due <= now() THEN v_due := now() + v_max; END IF;
  IF i.max_loan_hours IS NOT NULL AND v_due > now() + v_max THEN v_due := now() + v_max; END IF;
  PERFORM public.equipment_set_unit_status_ex(l.unit_id, 'checked_out', l.requester_id, 'collected',
    jsonb_build_object('loan_id', l.id, 'action', 'collect', 'due_at', v_due));
  UPDATE public.equipment_loans
     SET status = 'active', collected_at = clock_timestamp(), collected_by = auth.uid(), due_at = v_due, updated_at = now()
   WHERE id = l.id;
  PERFORM public.equipment_notify_user(l.requester_id, 'Collected: ' || i.name,
    'You now hold ' || i.name || '. Please return it by '
      || to_char(v_due AT TIME ZONE 'Africa/Johannesburg', 'DD Mon HH24:MI') || '.',
    '/equipment/mine');
  RETURN v_due;
END;
$fn$;

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
  SELECT name INTO v_name FROM public.equipment_items WHERE id = l.item_id;
  PERFORM public.equipment_notify_user(l.requester_id, 'Returned: ' || v_name,
    'Thanks - ' || v_name || ' is checked back in.', '/equipment/mine');
END;
$fn$;

-- -----------------------------------------------------------------------------
-- Transfers (holder approves)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_equipment_transfer(p_unit_id uuid, p_note text DEFAULT NULL)
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
  IF EXISTS (SELECT 1 FROM public.equipment_loans
             WHERE item_id = i.id AND requester_id = uid AND status IN ('requested', 'approved', 'active')) THEN
    RAISE EXCEPTION 'you already have an open request or loan for this item';
  END IF;
  BEGIN
    INSERT INTO public.equipment_transfers (organization_id, unit_id, from_loan_id, from_user_id, to_user_id, note)
    VALUES (u.organization_id, u.id, l.id, l.requester_id, uid, v_note)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'you already asked for this unit';
  END;
  PERFORM public.equipment_notify_user(l.requester_id, 'Transfer request: ' || i.name,
    coalesce(public.equipment_display_name(uid), 'A patroller') || ' asked you to hand over ' || i.name
      || ' (' || u.asset_tag || ')' || coalesce(' - "' || left(v_note, 120) || '"', ''),
    '/equipment/mine');
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.respond_equipment_transfer(p_transfer_id uuid, p_accept boolean, p_note text DEFAULT NULL)
RETURNS uuid
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
  v_new uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO t FROM public.equipment_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer not found'; END IF;
  SELECT * INTO l FROM public.equipment_loans WHERE id = t.from_loan_id FOR UPDATE;
  -- Only the current holder (borrower of the active loan) may answer.
  IF l.requester_id IS DISTINCT FROM uid OR NOT public.is_equipment_member(t.organization_id) THEN
    RAISE EXCEPTION 'transfer not found';
  END IF;
  IF t.status <> 'requested' THEN RAISE EXCEPTION 'transfer is no longer open (%)', t.status; END IF;
  SELECT * INTO u FROM public.equipment_units WHERE id = t.unit_id FOR UPDATE;
  SELECT * INTO i FROM public.equipment_items WHERE id = u.item_id;
  IF NOT coalesce(p_accept, false) THEN
    UPDATE public.equipment_transfers SET status = 'declined', responded_at = now(),
           response_note = nullif(trim(left(p_note, 500)), '') WHERE id = t.id;
    PERFORM public.equipment_notify_user(t.to_user_id, 'Transfer declined: ' || i.name,
      coalesce(public.equipment_display_name(uid), 'The holder') || ' declined to hand over ' || i.name
        || coalesce(': ' || nullif(trim(p_note), ''), '.'), '/equipment/mine');
    RETURN NULL;
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
  -- Close the giver's loan first (frees the per-unit unique index).
  UPDATE public.equipment_loans SET status = 'transferred', ended_at = clock_timestamp(), ended_by = uid, updated_at = now()
   WHERE id = l.id;
  BEGIN
    INSERT INTO public.equipment_loans (organization_id, item_id, unit_id, requester_id, status, source, note,
      due_at, decided_by, decided_at, collected_at, collected_by)
    VALUES (l.organization_id, l.item_id, u.id, t.to_user_id, 'active', 'transfer', t.note,
      l.due_at, uid, now(), clock_timestamp(), uid)
    RETURNING id INTO v_new;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'the requester already has an open request or loan for this item';
  END;
  PERFORM public.equipment_set_unit_status_ex(u.id, 'in_transfer', t.to_user_id, 'handover',
    jsonb_build_object('transfer_id', t.id, 'from_loan_id', l.id, 'to_loan_id', v_new, 'from_user', uid, 'action', 'transfer'));
  PERFORM public.equipment_set_unit_status_ex(u.id, 'checked_out', t.to_user_id, 'transfer accepted',
    jsonb_build_object('transfer_id', t.id, 'loan_id', v_new, 'action', 'transfer'));
  UPDATE public.equipment_transfers SET status = 'accepted', responded_at = now(), to_loan_id = v_new,
         response_note = nullif(trim(left(p_note, 500)), '') WHERE id = t.id;
  UPDATE public.equipment_transfers SET status = 'expired', responded_at = now()
   WHERE unit_id = u.id AND status = 'requested' AND id <> t.id;
  PERFORM public.equipment_notify_user(t.to_user_id, 'Transfer accepted: ' || i.name,
    'You now hold ' || i.name || ' (' || u.asset_tag || ').', '/equipment/mine');
  PERFORM public.equipment_notify_managers(t.organization_id, 'Handed over: ' || i.name || ' ' || u.asset_tag,
    coalesce(public.equipment_display_name(uid), 'A patroller') || ' handed ' || u.asset_tag || ' to '
      || coalesce(public.equipment_display_name(t.to_user_id), 'a patroller') || '.',
    '/equipment/units/' || u.id);
  RETURN v_new;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cancel_equipment_transfer(p_transfer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  t public.equipment_transfers%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO t FROM public.equipment_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR t.to_user_id <> auth.uid() THEN RAISE EXCEPTION 'transfer not found'; END IF;
  IF t.status <> 'requested' THEN RAISE EXCEPTION 'transfer is no longer open (%)', t.status; END IF;
  UPDATE public.equipment_transfers SET status = 'cancelled', responded_at = now() WHERE id = t.id;
END;
$fn$;

-- -----------------------------------------------------------------------------
-- Issues: the latest holder reports; managers clear.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_equipment_issue(p_unit_id uuid, p_kind text, p_note text)
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
  v_to text;
  v_id uuid;
  v_name text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO u FROM public.equipment_units WHERE id = p_unit_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_equipment_member(u.organization_id) THEN RAISE EXCEPTION 'unit not found'; END IF;
  IF v_kind NOT IN ('damage', 'theft', 'malfunction') THEN RAISE EXCEPTION 'unknown issue type'; END IF;
  IF char_length(v_note) < 3 OR char_length(v_note) > 1000 THEN RAISE EXCEPTION 'describe what happened (3 to 1000 characters)'; END IF;
  -- Latest holder = borrower of the most recent collected loan on this unit.
  SELECT * INTO l FROM public.equipment_loans
   WHERE unit_id = u.id AND collected_at IS NOT NULL
   ORDER BY collected_at DESC, created_at DESC LIMIT 1;
  IF NOT FOUND OR l.requester_id <> uid THEN
    RAISE EXCEPTION 'only the latest holder can report an issue';
  END IF;
  IF u.status NOT IN ('available', 'checked_out', 'overdue') THEN
    RAISE EXCEPTION 'an issue cannot be reported while the unit is %', u.status;
  END IF;
  IF u.status = 'available' AND l.ended_at < now() - interval '7 days' THEN
    RAISE EXCEPTION 'issues must be reported within 7 days of returning the unit';
  END IF;
  v_to := CASE v_kind WHEN 'theft' THEN 'stolen' ELSE 'damaged' END;
  BEGIN
    INSERT INTO public.equipment_issue_reports (organization_id, unit_id, loan_id, reporter_id, kind, note, from_status)
    VALUES (u.organization_id, u.id, l.id, uid, v_kind, v_note, u.status)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'an issue is already open for this unit';
  END;
  PERFORM public.equipment_set_unit_status_ex(u.id, v_to, NULL, v_kind || ': ' || left(v_note, 400),
    jsonb_build_object('issue_id', v_id, 'kind', v_kind, 'loan_id', l.id, 'reported_by', uid, 'action', 'issue'));
  IF l.status = 'active' THEN
    UPDATE public.equipment_loans SET status = 'issue_reported', ended_at = now(), ended_by = uid, updated_at = now()
     WHERE id = l.id;
  END IF;
  UPDATE public.equipment_transfers SET status = 'expired', responded_at = now()
   WHERE unit_id = u.id AND status = 'requested';
  SELECT name INTO v_name FROM public.equipment_items WHERE id = u.item_id;
  PERFORM public.equipment_notify_managers(u.organization_id,
    initcap(v_kind) || ' reported: ' || v_name || ' ' || u.asset_tag,
    coalesce(public.equipment_display_name(uid), 'A patroller') || ': ' || left(v_note, 200),
    '/equipment/admin/requests');
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.clear_equipment_issue(p_issue_id uuid, p_outcome text DEFAULT 'available', p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r public.equipment_issue_reports%ROWTYPE;
  v_status text;
  v_out text := lower(trim(coalesce(p_outcome, 'available')));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO r FROM public.equipment_issue_reports WHERE id = p_issue_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_equipment(r.organization_id) THEN RAISE EXCEPTION 'issue not found'; END IF;
  IF r.cleared_at IS NOT NULL THEN RAISE EXCEPTION 'issue already cleared'; END IF;
  IF v_out NOT IN ('available', 'under_repair', 'retired') THEN RAISE EXCEPTION 'invalid outcome'; END IF;
  SELECT status INTO v_status FROM public.equipment_units WHERE id = r.unit_id;
  IF v_status <> v_out THEN
    IF NOT public.equipment_transition_allowed(v_status, v_out) THEN
      RAISE EXCEPTION 'a % unit cannot go to %', v_status, v_out;
    END IF;
    PERFORM public.equipment_set_unit_status_ex(r.unit_id, v_out, NULL,
      coalesce(nullif(trim(p_note), ''), 'issue cleared'),
      jsonb_build_object('issue_id', r.id, 'action', 'clear_issue'));
  END IF;
  UPDATE public.equipment_issue_reports
     SET cleared_at = now(), cleared_by = auth.uid(), resolution = v_out,
         resolution_note = nullif(trim(left(p_note, 500)), '')
   WHERE id = r.id;
END;
$fn$;

-- -----------------------------------------------------------------------------
-- Training sign-offs (functional from P3b)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_equipment_certification(
  p_user_id uuid, p_item_id uuid, p_expires_at timestamptz DEFAULT NULL, p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid;
  v_name text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT organization_id, name INTO v_org, v_name FROM public.equipment_items WHERE id = p_item_id;
  IF v_org IS NULL OR NOT public.can_manage_equipment(v_org) THEN RAISE EXCEPTION 'item not found'; END IF;
  IF NOT public.equipment_user_can_borrow(p_user_id, v_org) THEN RAISE EXCEPTION 'patroller not found'; END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN RAISE EXCEPTION 'expiry must be in the future'; END IF;
  INSERT INTO public.equipment_certifications (organization_id, user_id, item_id, granted_by, granted_at, expires_at, revoked_at, note)
  VALUES (v_org, p_user_id, p_item_id, auth.uid(), now(), p_expires_at, NULL, nullif(trim(left(p_note, 500)), ''))
  ON CONFLICT (organization_id, user_id, item_id) DO UPDATE
    SET granted_by = EXCLUDED.granted_by, granted_at = EXCLUDED.granted_at, expires_at = EXCLUDED.expires_at,
        revoked_at = NULL, note = EXCLUDED.note
  RETURNING id INTO v_id;
  PERFORM public.equipment_ledger_append(v_org, 'certification_granted', NULL, p_item_id, NULL, NULL, p_user_id,
    jsonb_build_object('expires_at', p_expires_at));
  PERFORM public.equipment_notify_user(p_user_id, 'Training sign-off: ' || v_name,
    'You are now signed off to borrow ' || v_name || '.', '/equipment/items/' || p_item_id);
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.revoke_equipment_certification(p_user_id uuid, p_item_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT organization_id INTO v_org FROM public.equipment_items WHERE id = p_item_id;
  IF v_org IS NULL OR NOT public.can_manage_equipment(v_org) THEN RAISE EXCEPTION 'item not found'; END IF;
  UPDATE public.equipment_certifications SET revoked_at = now()
   WHERE organization_id = v_org AND user_id = p_user_id AND item_id = p_item_id AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'sign-off not found'; END IF;
  PERFORM public.equipment_ledger_append(v_org, 'certification_revoked', NULL, p_item_id, NULL, NULL, p_user_id,
    jsonb_build_object('note', nullif(trim(left(p_note, 500)), '')));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.list_equipment_certifications_admin()
RETURNS TABLE (user_id uuid, full_name text, role text, item_id uuid, item_name text,
               granted_at timestamptz, expires_at timestamptz, revoked_at timestamptz, is_active boolean)
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
  SELECT c.user_id, u.full_name, u.role::text, c.item_id, i.name, c.granted_at, c.expires_at, c.revoked_at,
         (c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > now()))
  FROM public.equipment_certifications c
  JOIN public.equipment_items i ON i.id = c.item_id
  LEFT JOIN public.users u ON u.id = c.user_id
  WHERE c.organization_id = v_org
  ORDER BY u.full_name, i.name;
END;
$fn$;

-- Patrol members of the caller's org (for the sign-off picker).
CREATE OR REPLACE FUNCTION public.list_equipment_patrollers()
RETURNS TABLE (user_id uuid, full_name text, role text)
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
  SELECT u.id, u.full_name, u.role::text FROM public.users u
  WHERE public.user_in_org(u.id, v_org) AND public.equipment_user_can_borrow(u.id, v_org)
  ORDER BY u.full_name;
END;
$fn$;

-- -----------------------------------------------------------------------------
-- Sweep: expire stale requests/transfers, flag overdue loans (idempotent).
-- Any member may run it for their own org (the pages call it on load).
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- Read RPCs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_equipment_loans()
RETURNS TABLE (
  id uuid, item_id uuid, item_name text, item_photo_path text, unit_id uuid, asset_tag text, status text,
  source text, note text, desired_due_at timestamptz, due_at timestamptz, is_overdue boolean,
  decision_note text, collected_at timestamptz, ended_at timestamptz, created_at timestamptz
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
         l.collected_at, l.ended_at, l.created_at
  FROM public.equipment_loans l
  JOIN public.equipment_items i ON i.id = l.item_id
  LEFT JOIN public.equipment_units u ON u.id = l.unit_id
  WHERE l.requester_id = auth.uid() AND public.is_equipment_member(l.organization_id)
    AND (l.status IN ('requested', 'approved', 'active') OR l.updated_at > now() - interval '60 days')
  ORDER BY (l.status IN ('requested', 'approved', 'active')) DESC, l.updated_at DESC
  LIMIT 100;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.list_my_equipment_transfers()
RETURNS TABLE (
  id uuid, direction text, unit_id uuid, asset_tag text, item_id uuid, item_name text,
  other_name text, status text, note text, response_note text, created_at timestamptz, responded_at timestamptz
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
         t.status, t.note, t.response_note, t.created_at, t.responded_at
  FROM public.equipment_transfers t
  JOIN public.equipment_units u ON u.id = t.unit_id
  JOIN public.equipment_items i ON i.id = u.item_id
  JOIN public.equipment_loans l ON l.id = t.from_loan_id
  WHERE public.is_equipment_member(t.organization_id)
    AND (t.to_user_id = auth.uid() OR l.requester_id = auth.uid())
    AND (t.status = 'requested' OR t.created_at > now() - interval '30 days')
  ORDER BY (t.status = 'requested') DESC, t.created_at DESC
  LIMIT 100;
END;
$fn$;

-- Manager queue: open loans (requested / approved / active), with full names.
CREATE OR REPLACE FUNCTION public.list_equipment_requests_admin()
RETURNS TABLE (
  id uuid, item_id uuid, item_name text, unit_id uuid, asset_tag text, requester_id uuid, requester_name text,
  status text, source text, note text, desired_due_at timestamptz, due_at timestamptz, is_overdue boolean,
  collected_at timestamptz, created_at timestamptz, requires_certification boolean, has_certification boolean,
  max_loan_hours int, available_units jsonb
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
  SELECT l.id, l.item_id, i.name, l.unit_id, u.asset_tag, l.requester_id, coalesce(ru.full_name, 'Member'),
         l.status, l.source, l.note, l.desired_due_at, l.due_at, (l.status = 'active' AND l.due_at < now()),
         l.collected_at, l.created_at, i.requires_certification,
         public.equipment_has_certification(l.requester_id, l.item_id), i.max_loan_hours,
         coalesce((SELECT jsonb_agg(jsonb_build_object('id', au.id, 'asset_tag', au.asset_tag) ORDER BY au.asset_tag)
                   FROM public.equipment_units au WHERE au.item_id = l.item_id AND au.status = 'available'), '[]'::jsonb)
  FROM public.equipment_loans l
  JOIN public.equipment_items i ON i.id = l.item_id
  LEFT JOIN public.equipment_units u ON u.id = l.unit_id
  LEFT JOIN public.users ru ON ru.id = l.requester_id
  WHERE l.organization_id = v_org AND l.status IN ('requested', 'approved', 'active')
  ORDER BY CASE l.status WHEN 'requested' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
           (l.status = 'active' AND l.due_at < now()) DESC, l.created_at;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.list_equipment_issues_admin()
RETURNS TABLE (
  id uuid, unit_id uuid, asset_tag text, item_id uuid, item_name text, unit_status text, kind text, note text,
  reporter_name text, created_at timestamptz
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
  SELECT r.id, r.unit_id, u.asset_tag, i.id, i.name, u.status, r.kind, r.note, coalesce(ru.full_name, 'Member'), r.created_at
  FROM public.equipment_issue_reports r
  JOIN public.equipment_units u ON u.id = r.unit_id
  JOIN public.equipment_items i ON i.id = u.item_id
  LEFT JOIN public.users ru ON ru.id = r.reporter_id
  WHERE r.organization_id = v_org AND r.cleared_at IS NULL
  ORDER BY r.created_at;
END;
$fn$;

-- Badge counts. Managers get queue counts; everyone gets their own items.
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
                              WHERE t.organization_id = v_org AND t.status = 'requested' AND l.requester_id = auth.uid()),
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

-- Custody history for one unit (members see "First I." names).
CREATE OR REPLACE FUNCTION public.list_equipment_unit_custody(p_unit_id uuid)
RETURNS TABLE (loan_id uuid, holder_name text, source text, status text, collected_at timestamptz,
               due_at timestamptz, ended_at timestamptz)
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
  SELECT l.id, public.equipment_display_name(l.requester_id), l.source, l.status, l.collected_at, l.due_at, l.ended_at
  FROM public.equipment_loans l
  WHERE l.unit_id = p_unit_id AND l.organization_id = v_org AND l.collected_at IS NOT NULL
  ORDER BY l.collected_at DESC
  LIMIT 200;
END;
$fn$;

-- Member item view: + borrowing state (same signature as 021000).
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
        'issue', (SELECT jsonb_build_object('kind', r.kind, 'note', r.note, 'reported_at', r.created_at,
                                            'holder_name', public.equipment_display_name(r.reporter_id))
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
      'issue', (SELECT jsonb_build_object('kind', r.kind, 'note', r.note, 'reported_at', r.created_at,
                                          'holder_name', public.equipment_display_name(r.reporter_id))
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

-- -----------------------------------------------------------------------------
-- Function grants
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.equipment_set_unit_status_ex(uuid, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_set_unit_status_ex(uuid, text, uuid, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.equipment_has_certification(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_has_certification(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.equipment_user_can_borrow(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_user_can_borrow(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.equipment_manager_notify_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_manager_notify_ids(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.equipment_notify_managers(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_notify_managers(uuid, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.equipment_notify_user(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_notify_user(uuid, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.equipment_manager_loan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_manager_loan(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.request_equipment_loan(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_equipment_loan(uuid, text, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_equipment_loan_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_equipment_loan_request(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.approve_equipment_loan(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_equipment_loan(uuid, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_equipment_loan(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_equipment_loan(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_equipment_collection(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_equipment_collection(uuid, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_equipment_return(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_equipment_return(uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.request_equipment_transfer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_equipment_transfer(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.respond_equipment_transfer(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_equipment_transfer(uuid, boolean, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_equipment_transfer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_equipment_transfer(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.report_equipment_issue(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_equipment_issue(uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.clear_equipment_issue(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_equipment_issue(uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.grant_equipment_certification(uuid, uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_equipment_certification(uuid, uuid, timestamptz, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.revoke_equipment_certification(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_equipment_certification(uuid, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_equipment_certifications_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_equipment_certifications_admin() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_equipment_patrollers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_equipment_patrollers() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.equipment_sweep() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipment_sweep() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_my_equipment_loans() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_equipment_loans() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_my_equipment_transfers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_equipment_transfers() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_equipment_requests_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_equipment_requests_admin() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_equipment_issues_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_equipment_issues_admin() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.equipment_pending_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipment_pending_counts() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_equipment_unit_custody(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_equipment_unit_custody(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_equipment_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_equipment_item(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_equipment_unit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_equipment_unit(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
