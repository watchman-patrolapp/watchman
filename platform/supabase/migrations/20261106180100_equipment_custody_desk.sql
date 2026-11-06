-- =============================================================================
-- P3c - Theft case numbers, write-offs, liability, maintenance, overdue
-- reminders. Additive on 20261106180000. Idempotent.
-- Write-offs of R2,000 or more need a second admin. Only an NW admin records
-- liability. This file never inserts a charge, invoice or payment.
-- Overdue reminders: borrower, custodians after 2 hours, NW admins after 24 h.
-- =============================================================================

ALTER TABLE public.equipment_loans
  ADD COLUMN IF NOT EXISTS escalation_level smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custodian_escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_escalated_at timestamptz;
ALTER TABLE public.equipment_loans DROP CONSTRAINT IF EXISTS equipment_loans_escalation_level_check;
ALTER TABLE public.equipment_loans
  ADD CONSTRAINT equipment_loans_escalation_level_check CHECK (escalation_level BETWEEN 0 AND 3);

ALTER TABLE public.equipment_issue_reports
  ADD COLUMN IF NOT EXISTS saps_case_number text,
  ADD COLUMN IF NOT EXISTS saps_station text,
  ADD COLUMN IF NOT EXISTS cas_reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS location_label text,
  ADD COLUMN IF NOT EXISTS liability_decision text NOT NULL DEFAULT 'undecided',
  ADD COLUMN IF NOT EXISTS liability_amount_cents bigint,
  ADD COLUMN IF NOT EXISTS liability_note text,
  ADD COLUMN IF NOT EXISTS liability_decided_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS liability_decided_at timestamptz;
ALTER TABLE public.equipment_issue_reports DROP CONSTRAINT IF EXISTS equipment_issue_reports_cas_check;
ALTER TABLE public.equipment_issue_reports
  ADD CONSTRAINT equipment_issue_reports_cas_check
  CHECK (saps_case_number IS NULL OR saps_case_number ~ '^CAS [0-9]{1,6}/[0-9]{1,2}/[0-9]{4}$');
ALTER TABLE public.equipment_issue_reports DROP CONSTRAINT IF EXISTS equipment_issue_reports_liability_check;
ALTER TABLE public.equipment_issue_reports
  ADD CONSTRAINT equipment_issue_reports_liability_check
  CHECK (liability_decision IN ('undecided', 'no_fault', 'negligence_warning', 'contribution_requested'));
ALTER TABLE public.equipment_issue_reports DROP CONSTRAINT IF EXISTS equipment_issue_reports_liability_amount_check;
ALTER TABLE public.equipment_issue_reports
  ADD CONSTRAINT equipment_issue_reports_liability_amount_check
  CHECK (liability_amount_cents IS NULL OR liability_amount_cents >= 0);
CREATE INDEX IF NOT EXISTS equipment_issue_cas_reminder_idx
  ON public.equipment_issue_reports (cas_reminder_at)
  WHERE kind = 'theft' AND saps_case_number IS NULL AND cleared_at IS NULL;

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

-- R2,000 in cents. At or above this, a second admin must approve the write-off.
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
