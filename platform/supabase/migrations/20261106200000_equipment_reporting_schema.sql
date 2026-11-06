-- =============================================================================
-- P3d - Equipment reporting schema: stocktake, paper hand-over claims,
-- offline idempotency, and the ledger events those actions write.
-- Additive on 20261106191000. Idempotent. One new column per ALTER.
-- Does not change the hash chain: client_event_id and client_occurred_at are
-- stored beside the existing hash columns and are not part of the digest.
-- =============================================================================

ALTER TABLE public.equipment_ledger ADD COLUMN IF NOT EXISTS client_event_id uuid;
ALTER TABLE public.equipment_ledger ADD COLUMN IF NOT EXISTS client_occurred_at timestamptz;
ALTER TABLE public.equipment_loans ADD COLUMN IF NOT EXISTS return_requested_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS equipment_ledger_client_event_uidx
  ON public.equipment_ledger (organization_id, client_event_id)
  WHERE client_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS equipment_loans_return_requested_idx
  ON public.equipment_loans (organization_id, return_requested_at)
  WHERE return_requested_at IS NOT NULL AND status = 'active';

-- Replace the event check in place. Drop every event check first so a
-- half-applied editor run cannot leave two conflicting checks behind.
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
    'write_off_proposed', 'write_off_approved', 'liability_decided', 'overdue_escalated',
    'stocktake_counted', 'stocktake_missing', 'paper_handover_recorded', 'return_requested'
  ));

CREATE TABLE IF NOT EXISTS public.equipment_stocktakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(trim(label)) BETWEEN 1 AND 80),
  started_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finalised_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  finalised_at timestamptz,
  summary jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_one_open_stocktake
  ON public.equipment_stocktakes (organization_id) WHERE finalised_at IS NULL;
CREATE INDEX IF NOT EXISTS equipment_stocktakes_org_idx
  ON public.equipment_stocktakes (organization_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.equipment_stocktake_counts (
  stocktake_id uuid NOT NULL REFERENCES public.equipment_stocktakes (id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.equipment_units (id) ON DELETE CASCADE,
  result text NOT NULL CHECK (result IN ('present', 'with_holder_confirmed', 'missing', 'damaged')),
  condition_grade text CHECK (condition_grade IS NULL OR condition_grade IN ('new', 'good', 'fair', 'poor')),
  counted_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  counted_at timestamptz NOT NULL DEFAULT now(),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  client_event_id uuid,
  PRIMARY KEY (stocktake_id, unit_id)
);
CREATE INDEX IF NOT EXISTS equipment_stocktake_counts_unit_idx
  ON public.equipment_stocktake_counts (unit_id);

CREATE TABLE IF NOT EXISTS public.equipment_paper_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.equipment_units (id) ON DELETE RESTRICT,
  from_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  to_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  photo_path text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'recorded', 'rejected')),
  submitted_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  recorded_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  recorded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS equipment_paper_handovers_org_idx
  ON public.equipment_paper_handovers (organization_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_paper_one_pending
  ON public.equipment_paper_handovers (unit_id, to_user_id) WHERE status = 'pending';

-- Replay table for offline retries. The ledger unique index is the backstop.
CREATE TABLE IF NOT EXISTS public.equipment_client_events (
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  client_event_id uuid NOT NULL,
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 40),
  actor_id uuid,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, client_event_id)
);

ALTER TABLE public.equipment_stocktakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_stocktake_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_paper_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_client_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.equipment_stocktakes, public.equipment_stocktake_counts,
  public.equipment_paper_handovers, public.equipment_client_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.equipment_stocktakes, public.equipment_stocktake_counts,
  public.equipment_paper_handovers TO authenticated;
GRANT ALL ON public.equipment_stocktakes, public.equipment_stocktake_counts,
  public.equipment_paper_handovers, public.equipment_client_events TO service_role;

DROP POLICY IF EXISTS equipment_stocktakes_select ON public.equipment_stocktakes;
CREATE POLICY equipment_stocktakes_select ON public.equipment_stocktakes
  FOR SELECT TO authenticated
  USING (public.is_equipment_member(organization_id));

DROP POLICY IF EXISTS equipment_stocktake_counts_select ON public.equipment_stocktake_counts;
CREATE POLICY equipment_stocktake_counts_select ON public.equipment_stocktake_counts
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.equipment_stocktakes s
    WHERE s.id = stocktake_id AND public.is_equipment_member(s.organization_id)
  ));

DROP POLICY IF EXISTS equipment_paper_handovers_select ON public.equipment_paper_handovers;
CREATE POLICY equipment_paper_handovers_select ON public.equipment_paper_handovers
  FOR SELECT TO authenticated
  USING (public.can_manage_equipment(organization_id) OR submitted_by = (SELECT auth.uid()));

-- Clock skew window from the plan: [now - 72 hours, now + 5 minutes].
CREATE OR REPLACE FUNCTION public.equipment_clamp_occurred_at(p_at timestamptz)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN p_at IS NULL THEN now()
    WHEN p_at < now() - interval '72 hours' THEN now() - interval '72 hours'
    WHEN p_at > now() + interval '5 minutes' THEN now() + interval '5 minutes'
    ELSE p_at
  END;
$fn$;

-- NULL when this client id is new. The previous result when the same person
-- retries the same action. Raises when the id was already used for something else.
CREATE OR REPLACE FUNCTION public.equipment_client_begin(p_org uuid, p_client uuid, p_action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  row public.equipment_client_events%ROWTYPE;
BEGIN
  IF p_client IS NULL OR p_org IS NULL THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('eq-client:' || p_org::text || ':' || p_client::text, 0));
  SELECT * INTO row FROM public.equipment_client_events
   WHERE organization_id = p_org AND client_event_id = p_client;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF row.action <> p_action OR row.actor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'this offline action was already used';
  END IF;
  RETURN row.result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.equipment_client_finish(
  p_org uuid, p_client uuid, p_action text, p_result jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF p_client IS NULL OR p_org IS NULL THEN RETURN; END IF;
  INSERT INTO public.equipment_client_events (organization_id, client_event_id, action, actor_id, result)
  VALUES (p_org, p_client, p_action, auth.uid(), coalesce(p_result, '{}'::jsonb))
  ON CONFLICT (organization_id, client_event_id) DO NOTHING;
END;
$fn$;

-- Same chain as equipment_ledger_append, plus the offline columns.
CREATE OR REPLACE FUNCTION public.equipment_ledger_append_client(
  p_org uuid, p_event text, p_unit uuid DEFAULT NULL, p_item uuid DEFAULT NULL,
  p_from text DEFAULT NULL, p_to text DEFAULT NULL, p_holder uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb, p_client uuid DEFAULT NULL, p_client_at timestamptz DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id bigint;
BEGIN
  IF p_client IS NOT NULL THEN
    SELECT id INTO v_id FROM public.equipment_ledger
     WHERE organization_id = p_org AND client_event_id = p_client;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  INSERT INTO public.equipment_ledger (
    organization_id, unit_id, item_id, event, from_status, to_status, actor_id, holder_id,
    payload, client_event_id, client_occurred_at)
  VALUES (
    p_org, p_unit, p_item, p_event, p_from, p_to, auth.uid(), p_holder,
    coalesce(p_payload, '{}'::jsonb), p_client, p_client_at)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.equipment_clamp_occurred_at(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_clamp_occurred_at(timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.equipment_client_begin(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_client_begin(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.equipment_client_finish(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_client_finish(uuid, uuid, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.equipment_ledger_append_client(uuid, text, uuid, uuid, text, text, uuid, jsonb, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_ledger_append_client(uuid, text, uuid, uuid, text, text, uuid, jsonb, uuid, timestamptz)
  TO service_role;

DO $p3d_schema$
DECLARE
  missing text;
  names text[] := ARRAY[
    'equipment_clamp_occurred_at', 'equipment_client_begin', 'equipment_client_finish',
    'equipment_ledger_append_client'
  ];
  cols text[] := ARRAY[
    'equipment_ledger.client_event_id',
    'equipment_ledger.client_occurred_at',
    'equipment_loans.return_requested_at',
    'equipment_stocktakes.label',
    'equipment_stocktakes.summary',
    'equipment_stocktake_counts.result',
    'equipment_stocktake_counts.client_event_id',
    'equipment_paper_handovers.status',
    'equipment_paper_handovers.photo_path',
    'equipment_client_events.client_event_id',
    'equipment_client_events.result'
  ];
  pol text;
  pols text[] := ARRAY[
    'equipment_stocktakes_select',
    'equipment_stocktake_counts_select',
    'equipment_paper_handovers_select'
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
    RAISE EXCEPTION 'P3d schema functions still missing: %', missing;
  END IF;
  FOREACH pol IN ARRAY ARRAY[
    'equipment_stocktakes', 'equipment_stocktake_counts',
    'equipment_paper_handovers', 'equipment_client_events'
  ]
  LOOP
    IF to_regclass('public.' || pol) IS NULL THEN
      RAISE EXCEPTION 'P3d table % is missing', pol;
    END IF;
  END LOOP;
  FOREACH pol IN ARRAY cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = split_part(pol, '.', 1)
        AND column_name = split_part(pol, '.', 2)
    ) THEN
      RAISE EXCEPTION 'P3d column % is missing', pol;
    END IF;
  END LOOP;
  FOREACH pol IN ARRAY pols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND p.polname = pol
    ) THEN
      RAISE EXCEPTION 'P3d policy % is missing', pol;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.equipment_ledger'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%stocktake_counted%'
      AND pg_get_constraintdef(oid) LIKE '%paper_handover_recorded%'
      AND pg_get_constraintdef(oid) LIKE '%return_requested%'
  ) THEN
    RAISE EXCEPTION 'P3d ledger event check is missing the new events';
  END IF;
END
$p3d_schema$;
