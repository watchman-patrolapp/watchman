-- =============================================================================
-- P3d - Custodian dashboard and org-scoped ledger export.
-- equipment_dashboard is admin/custodian only. equipment_patroller_overview
-- is the member view: counts and the caller's own units, no prices.
-- export_equipment_ledger returns the same rows the ledger holds for the
-- period, for this neighbourhood only. Idempotent.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.equipment_dashboard(
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public.equipment_require_org();
  v_from timestamptz;
  v_to timestamptz;
  v_seconds numeric;
BEGIN
  IF NOT public.can_manage_equipment(v_org) THEN RAISE EXCEPTION 'forbidden'; END IF;
  v_to := least(coalesce(p_to, now()), now() + interval '1 day');
  v_from := coalesce(p_from, v_to - interval '365 days');
  IF v_from > v_to THEN RAISE EXCEPTION 'the start date is after the end date'; END IF;
  IF v_to - v_from > interval '5 years' THEN RAISE EXCEPTION 'pick a period of 5 years or less'; END IF;
  v_seconds := greatest(extract(epoch FROM (v_to - v_from)), 1);
  RETURN jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'units_by_status', (
      SELECT coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
      FROM (
        SELECT status, count(*)::int AS n
        FROM public.equipment_units WHERE organization_id = v_org GROUP BY status
      ) s),
    'unit_total', (SELECT count(*)::int FROM public.equipment_units WHERE organization_id = v_org),
    'on_loan', (SELECT count(*)::int FROM public.equipment_units
                WHERE organization_id = v_org AND status IN ('checked_out', 'overdue', 'in_transfer')),
    'overdue_count', (SELECT count(*)::int FROM public.equipment_units
                      WHERE organization_id = v_org AND status = 'overdue'),
    'open_issues', (SELECT count(*)::int FROM public.equipment_issue_reports
                    WHERE organization_id = v_org AND cleared_at IS NULL),
    'write_offs_pending', (SELECT count(*)::int FROM public.equipment_write_offs
                           WHERE organization_id = v_org AND status = 'pending'),
    'maintenance_due', (
      SELECT count(*)::int FROM (
        SELECT DISTINCT ON (m.unit_id) m.next_due
        FROM public.equipment_maintenance_logs m
        WHERE m.organization_id = v_org
        ORDER BY m.unit_id, m.performed_at DESC
      ) latest
      WHERE latest.next_due IS NOT NULL
        AND latest.next_due <= (timezone('Africa/Johannesburg', now()))::date + 7),
    'loss_rate_percent', (
      SELECT CASE WHEN count(*) = 0 THEN 0
        ELSE round(100.0 * count(*) FILTER (WHERE status IN ('lost', 'stolen')) / count(*), 1) END
      FROM public.equipment_units WHERE organization_id = v_org),
    'holders', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'unit_id', u.id, 'asset_tag', u.asset_tag, 'item_name', i.name, 'status', u.status,
        'holder_name', public.equipment_display_name(u.current_holder_id), 'due_at', l.due_at)
        ORDER BY u.asset_tag), '[]'::jsonb)
      FROM public.equipment_units u
      JOIN public.equipment_items i ON i.id = u.item_id
      LEFT JOIN public.equipment_loans l ON l.unit_id = u.id AND l.status = 'active'
      WHERE u.organization_id = v_org AND u.status IN ('checked_out', 'overdue', 'in_transfer', 'reserved')),
    'overdue', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'unit_id', u.id, 'asset_tag', u.asset_tag, 'item_name', i.name,
        'holder_name', public.equipment_display_name(u.current_holder_id), 'due_at', l.due_at)
        ORDER BY l.due_at), '[]'::jsonb)
      FROM public.equipment_units u
      JOIN public.equipment_items i ON i.id = u.item_id
      LEFT JOIN public.equipment_loans l ON l.unit_id = u.id AND l.status = 'active'
      WHERE u.organization_id = v_org AND u.status = 'overdue'),
    'issues', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'unit_id', r.unit_id, 'asset_tag', u.asset_tag, 'item_name', i.name,
        'kind', r.kind, 'created_at', r.created_at,
        'reporter_name', public.equipment_display_name(r.reporter_id))
        ORDER BY r.created_at DESC), '[]'::jsonb)
      FROM public.equipment_issue_reports r
      JOIN public.equipment_units u ON u.id = r.unit_id
      JOIN public.equipment_items i ON i.id = u.item_id
      WHERE r.organization_id = v_org AND r.cleared_at IS NULL),
    'write_offs', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', w.id, 'unit_id', w.unit_id, 'asset_tag', u.asset_tag, 'item_name', i.name,
        'value_cents', w.value_cents, 'proposed_at', w.proposed_at)
        ORDER BY w.proposed_at), '[]'::jsonb)
      FROM public.equipment_write_offs w
      JOIN public.equipment_units u ON u.id = w.unit_id
      JOIN public.equipment_items i ON i.id = u.item_id
      WHERE w.organization_id = v_org AND w.status = 'pending'),
    'maintenance', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'unit_id', latest.unit_id, 'asset_tag', latest.asset_tag, 'item_name', latest.item_name,
        'kind', latest.kind, 'next_due', latest.next_due)
        ORDER BY latest.next_due), '[]'::jsonb)
      FROM (
        SELECT DISTINCT ON (m.unit_id) m.unit_id, u.asset_tag, i.name AS item_name, m.kind, m.next_due
        FROM public.equipment_maintenance_logs m
        JOIN public.equipment_units u ON u.id = m.unit_id
        JOIN public.equipment_items i ON i.id = u.item_id
        WHERE m.organization_id = v_org
        ORDER BY m.unit_id, m.performed_at DESC
      ) latest
      WHERE latest.next_due IS NOT NULL
        AND latest.next_due <= (timezone('Africa/Johannesburg', now()))::date + 7),
    'utilisation', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'item_id', i.id, 'item_name', i.name, 'percent', least(100, greatest(0, round(
          100.0 * coalesce(ov.seconds, 0) / (greatest(uc.n, 1) * v_seconds), 1))))
        ORDER BY i.name), '[]'::jsonb)
      FROM public.equipment_items i
      JOIN (SELECT item_id, count(*)::numeric AS n FROM public.equipment_units
            WHERE organization_id = v_org AND status <> 'retired' GROUP BY item_id) uc ON uc.item_id = i.id
      LEFT JOIN (
        SELECT l.item_id, sum(greatest(0, extract(epoch FROM (
          least(coalesce(l.ended_at, now()), v_to) - greatest(l.collected_at, v_from)
        )))) AS seconds
        FROM public.equipment_loans l
        WHERE l.organization_id = v_org AND l.collected_at IS NOT NULL
          AND l.collected_at < v_to AND coalesce(l.ended_at, now()) > v_from
        GROUP BY l.item_id
      ) ov ON ov.item_id = i.id
      WHERE i.organization_id = v_org)
  );
END;
$fn$;

-- Member view. No prices, no write-off amounts, no other people's issue notes.
CREATE OR REPLACE FUNCTION public.equipment_patroller_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  v_org uuid := public.equipment_require_org();
  s public.equipment_stocktakes%ROWTYPE;
  v_mine jsonb := '[]'::jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_equipment_member(v_org) THEN RAISE EXCEPTION 'not found'; END IF;
  SELECT * INTO s FROM public.equipment_stocktakes
   WHERE organization_id = v_org AND finalised_at IS NULL
   ORDER BY started_at DESC LIMIT 1;
  IF FOUND THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'unit_id', u.id, 'asset_tag', u.asset_tag, 'item_name', i.name,
      'confirmed', c.result = 'with_holder_confirmed') ORDER BY u.asset_tag), '[]'::jsonb)
      INTO v_mine
    FROM public.equipment_units u
    JOIN public.equipment_items i ON i.id = u.item_id
    LEFT JOIN public.equipment_stocktake_counts c ON c.stocktake_id = s.id AND c.unit_id = u.id
    WHERE u.organization_id = v_org AND u.current_holder_id = uid AND u.status <> 'retired';
  END IF;
  RETURN jsonb_build_object(
    'units_by_status', (
      SELECT coalesce(jsonb_object_agg(st.status, st.n), '{}'::jsonb) FROM (
        SELECT status, count(*)::int AS n FROM public.equipment_units
        WHERE organization_id = v_org GROUP BY status) st),
    'on_loan', (SELECT count(*)::int FROM public.equipment_units
                WHERE organization_id = v_org AND status IN ('checked_out', 'overdue', 'in_transfer')),
    'overdue', (SELECT count(*)::int FROM public.equipment_units
                WHERE organization_id = v_org AND status = 'overdue'),
    'open_issues', (SELECT count(*)::int FROM public.equipment_issue_reports
                    WHERE organization_id = v_org AND cleared_at IS NULL),
    'my_holding', (SELECT count(*)::int FROM public.equipment_loans
                   WHERE organization_id = v_org AND requester_id = uid AND status = 'active'),
    'my_overdue', (SELECT count(*)::int FROM public.equipment_units
                   WHERE organization_id = v_org AND current_holder_id = uid AND status = 'overdue'),
    'open_stocktake', CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', s.id, 'label', s.label, 'started_at', s.started_at, 'mine', v_mine) END
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.export_equipment_ledger(
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id bigint, occurred_at timestamptz, event text, asset_tag text, item_name text,
  from_status text, to_status text, actor_name text, holder_name text, details text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public.equipment_require_org();
  v_from timestamptz := coalesce(p_from, now() - interval '365 days');
  v_to timestamptz := coalesce(p_to, now() + interval '1 day');
BEGIN
  IF NOT public.can_manage_equipment(v_org) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_from > v_to THEN RAISE EXCEPTION 'the start date is after the end date'; END IF;
  RETURN QUERY
  SELECT l.id, l.occurred_at, l.event, u.asset_tag, i.name, l.from_status, l.to_status,
         public.equipment_display_name(l.actor_id), public.equipment_display_name(l.holder_id),
         l.payload::text
  FROM public.equipment_ledger l
  LEFT JOIN public.equipment_units u ON u.id = l.unit_id
  LEFT JOIN public.equipment_items i ON i.id = coalesce(l.item_id, u.item_id)
  WHERE l.organization_id = v_org AND l.occurred_at >= v_from AND l.occurred_at <= v_to
  ORDER BY l.id
  LIMIT 8000;
END;
$fn$;

REVOKE ALL ON FUNCTION public.equipment_dashboard(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipment_dashboard(timestamptz, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.equipment_patroller_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipment_patroller_overview() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.export_equipment_ledger(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_equipment_ledger(timestamptz, timestamptz) TO authenticated, service_role;

DO $p3d_dash$
DECLARE
  missing text;
  names text[] := ARRAY['equipment_dashboard', 'equipment_patroller_overview', 'export_equipment_ledger'];
BEGIN
  SELECT string_agg(u.name, ', ' ORDER BY u.name) INTO missing
  FROM unnest(names) AS u(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = u.name
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'P3d dashboard functions still missing: %', missing;
  END IF;
END
$p3d_dash$;
