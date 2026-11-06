-- =============================================================================
-- P3c repair. Additive. Do not edit 20261106180000–20261106180300.
-- Those files declare handover_by, respond_by and the other custody columns,
-- but the transfer columns were added in one ALTER that also created a
-- foreign key. On the applied database equipment_transfers still has no
-- handover_by (isolation script 42703). Each column is added on its own.
-- Safe to re-run: IF NOT EXISTS / DROP CONSTRAINT IF EXISTS.
-- =============================================================================

ALTER TABLE public.equipment_transfers ADD COLUMN IF NOT EXISTS requested_for timestamptz;
ALTER TABLE public.equipment_transfers ADD COLUMN IF NOT EXISTS respond_by timestamptz;
ALTER TABLE public.equipment_transfers ADD COLUMN IF NOT EXISTS handover_by timestamptz;
ALTER TABLE public.equipment_transfers ADD COLUMN IF NOT EXISTS code_hash text;
ALTER TABLE public.equipment_transfers ADD COLUMN IF NOT EXISTS code_attempts smallint NOT NULL DEFAULT 0;
ALTER TABLE public.equipment_transfers ADD COLUMN IF NOT EXISTS giver_confirmed_at timestamptz;
ALTER TABLE public.equipment_transfers ADD COLUMN IF NOT EXISTS receiver_confirmed_at timestamptz;
ALTER TABLE public.equipment_transfers ADD COLUMN IF NOT EXISTS receiver_condition text;
ALTER TABLE public.equipment_transfers ADD COLUMN IF NOT EXISTS receiver_ack boolean NOT NULL DEFAULT false;
ALTER TABLE public.equipment_transfers ADD COLUMN IF NOT EXISTS forced_by uuid;
ALTER TABLE public.equipment_transfers ADD COLUMN IF NOT EXISTS forced_reason text;

DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.equipment_transfers'::regclass
      AND conname = 'equipment_transfers_forced_by_fkey'
  ) THEN
    ALTER TABLE public.equipment_transfers
      ADD CONSTRAINT equipment_transfers_forced_by_fkey
      FOREIGN KEY (forced_by) REFERENCES public.users (id) ON DELETE SET NULL;
  END IF;
END
$fk$;

DO $status$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.equipment_transfers'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%forced_reason%'
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%receiver_condition%'
  LOOP
    EXECUTE format('ALTER TABLE public.equipment_transfers DROP CONSTRAINT %I', r.conname);
  END LOOP;
END
$status$;

ALTER TABLE public.equipment_transfers DROP CONSTRAINT IF EXISTS equipment_transfers_status_check;
ALTER TABLE public.equipment_transfers
  ADD CONSTRAINT equipment_transfers_status_check
  CHECK (status IN ('requested', 'accepted', 'completed', 'declined', 'cancelled', 'expired', 'forced'));

ALTER TABLE public.equipment_transfers DROP CONSTRAINT IF EXISTS equipment_transfers_receiver_condition_check;
ALTER TABLE public.equipment_transfers
  ADD CONSTRAINT equipment_transfers_receiver_condition_check
  CHECK (receiver_condition IS NULL OR receiver_condition IN ('new', 'good', 'fair', 'poor'));

ALTER TABLE public.equipment_transfers DROP CONSTRAINT IF EXISTS equipment_transfers_forced_reason_check;
ALTER TABLE public.equipment_transfers
  ADD CONSTRAINT equipment_transfers_forced_reason_check
  CHECK (forced_reason IS NULL OR char_length(forced_reason) <= 500);

UPDATE public.equipment_transfers
   SET status = 'completed'
 WHERE status = 'accepted' AND to_loan_id IS NOT NULL;

UPDATE public.equipment_transfers
   SET respond_by = created_at + interval '12 hours'
 WHERE respond_by IS NULL AND status = 'requested';

CREATE UNIQUE INDEX IF NOT EXISTS equipment_transfers_one_handover
  ON public.equipment_transfers (unit_id) WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS equipment_transfers_respond_by_idx
  ON public.equipment_transfers (respond_by) WHERE status = 'requested';
CREATE INDEX IF NOT EXISTS equipment_transfers_handover_by_idx
  ON public.equipment_transfers (handover_by) WHERE status = 'accepted';

ALTER TABLE public.equipment_loans ADD COLUMN IF NOT EXISTS escalation_level smallint NOT NULL DEFAULT 0;
ALTER TABLE public.equipment_loans ADD COLUMN IF NOT EXISTS custodian_escalated_at timestamptz;
ALTER TABLE public.equipment_loans ADD COLUMN IF NOT EXISTS admin_escalated_at timestamptz;
ALTER TABLE public.equipment_loans DROP CONSTRAINT IF EXISTS equipment_loans_escalation_level_check;
ALTER TABLE public.equipment_loans
  ADD CONSTRAINT equipment_loans_escalation_level_check
  CHECK (escalation_level BETWEEN 0 AND 3);

ALTER TABLE public.equipment_issue_reports ADD COLUMN IF NOT EXISTS saps_case_number text;
ALTER TABLE public.equipment_issue_reports ADD COLUMN IF NOT EXISTS saps_station text;
ALTER TABLE public.equipment_issue_reports ADD COLUMN IF NOT EXISTS cas_reminder_at timestamptz;
ALTER TABLE public.equipment_issue_reports ADD COLUMN IF NOT EXISTS location_label text;
ALTER TABLE public.equipment_issue_reports ADD COLUMN IF NOT EXISTS liability_decision text NOT NULL DEFAULT 'undecided';
ALTER TABLE public.equipment_issue_reports ADD COLUMN IF NOT EXISTS liability_amount_cents bigint;
ALTER TABLE public.equipment_issue_reports ADD COLUMN IF NOT EXISTS liability_note text;
ALTER TABLE public.equipment_issue_reports ADD COLUMN IF NOT EXISTS liability_decided_by uuid;
ALTER TABLE public.equipment_issue_reports ADD COLUMN IF NOT EXISTS liability_decided_at timestamptz;

DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.equipment_issue_reports'::regclass
      AND conname = 'equipment_issue_reports_liability_decided_by_fkey'
  ) THEN
    ALTER TABLE public.equipment_issue_reports
      ADD CONSTRAINT equipment_issue_reports_liability_decided_by_fkey
      FOREIGN KEY (liability_decided_by) REFERENCES public.users (id) ON DELETE SET NULL;
  END IF;
END
$fk$;

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

DO $events$
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
$events$;

ALTER TABLE public.equipment_ledger DROP CONSTRAINT IF EXISTS equipment_ledger_event_check;
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
