-- =============================================================================
-- P3d - Stocktake. An admin opens one count per neighbourhood, marks each unit
-- found (present), missing, or damaged, and holders can confirm they still
-- have a unit. Finalising records every discrepancy. Missing units can be
-- marked lost when the state machine allows it. Idempotent.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.equipment_stocktake_org(p_stocktake uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.equipment_stocktakes WHERE id = p_stocktake;
  RETURN v_org;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.start_equipment_stocktake(p_label text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  v_org uuid := public.equipment_require_org();
  v_label text := trim(coalesce(p_label, ''));
  v_id uuid;
  h record;
  v_name text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.can_manage_equipment(v_org) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF char_length(v_label) < 1 OR char_length(v_label) > 80 THEN
    RAISE EXCEPTION 'give this stocktake a name of 1 to 80 characters';
  END IF;
  BEGIN
    INSERT INTO public.equipment_stocktakes (organization_id, label, started_by)
    VALUES (v_org, v_label, uid)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a stocktake is already open';
  END;
  FOR h IN
    SELECT DISTINCT u.current_holder_id AS holder_id, i.name AS item_name, u.asset_tag
    FROM public.equipment_units u
    JOIN public.equipment_items i ON i.id = u.item_id
    WHERE u.organization_id = v_org
      AND u.status IN ('checked_out', 'overdue', 'in_transfer')
      AND u.current_holder_id IS NOT NULL
  LOOP
    v_name := h.item_name || ' ' || h.asset_tag;
    PERFORM public.equipment_notify_user(h.holder_id, 'Stocktake: confirm ' || v_name,
      'A count is open. Confirm you still have ' || v_name || '.',
      '/equipment/mine');
  END LOOP;
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.count_equipment_unit(
  p_stocktake_id uuid,
  p_unit_id uuid DEFAULT NULL,
  p_qr_token text DEFAULT NULL,
  p_asset_tag text DEFAULT NULL,
  p_result text DEFAULT NULL,
  p_condition text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_client_event_id uuid DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  s public.equipment_stocktakes%ROWTYPE;
  u public.equipment_units%ROWTYPE;
  v_result text := lower(trim(coalesce(p_result, '')));
  v_cond text := nullif(lower(trim(coalesce(p_condition, ''))), '');
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_when timestamptz;
  v_replay jsonb;
  v_event text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO s FROM public.equipment_stocktakes WHERE id = p_stocktake_id;
  IF NOT FOUND OR NOT public.can_manage_equipment(s.organization_id) THEN
    RAISE EXCEPTION 'stocktake not found';
  END IF;
  v_replay := public.equipment_client_begin(s.organization_id, p_client_event_id, 'stocktake_count');
  IF v_replay IS NOT NULL THEN RETURN (v_replay->>'unit_id')::uuid; END IF;
  IF s.finalised_at IS NOT NULL THEN RAISE EXCEPTION 'this stocktake is already closed'; END IF;
  IF v_result NOT IN ('present', 'with_holder_confirmed', 'missing', 'damaged') THEN
    RAISE EXCEPTION 'mark the unit found, missing, or damaged';
  END IF;
  IF v_cond IS NOT NULL AND v_cond NOT IN ('new', 'good', 'fair', 'poor') THEN
    RAISE EXCEPTION 'invalid condition';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN RAISE EXCEPTION 'note is too long'; END IF;
  IF p_unit_id IS NOT NULL THEN
    SELECT * INTO u FROM public.equipment_units WHERE id = p_unit_id;
  ELSIF nullif(trim(coalesce(p_qr_token, '')), '') IS NOT NULL THEN
    SELECT * INTO u FROM public.equipment_units WHERE qr_token = trim(p_qr_token);
  ELSIF nullif(trim(coalesce(p_asset_tag, '')), '') IS NOT NULL THEN
    SELECT * INTO u FROM public.equipment_units
     WHERE organization_id = s.organization_id AND asset_tag = upper(trim(p_asset_tag));
  ELSE
    RAISE EXCEPTION 'say which unit you counted';
  END IF;
  IF NOT FOUND OR u.organization_id IS DISTINCT FROM s.organization_id OR u.status = 'retired' THEN
    RAISE EXCEPTION 'unit not found';
  END IF;
  v_when := public.equipment_clamp_occurred_at(p_occurred_at);
  INSERT INTO public.equipment_stocktake_counts (
    stocktake_id, unit_id, result, condition_grade, counted_by, counted_at, note, client_event_id)
  VALUES (s.id, u.id, v_result, v_cond, uid, v_when, v_note, p_client_event_id)
  ON CONFLICT (stocktake_id, unit_id) DO UPDATE
    SET result = EXCLUDED.result,
        condition_grade = EXCLUDED.condition_grade,
        counted_by = EXCLUDED.counted_by,
        counted_at = EXCLUDED.counted_at,
        note = EXCLUDED.note;
  IF v_cond IS NOT NULL AND v_result <> 'missing' THEN
    UPDATE public.equipment_units SET condition = v_cond WHERE id = u.id;
  END IF;
  v_event := CASE WHEN v_result = 'missing' THEN 'stocktake_missing' ELSE 'stocktake_counted' END;
  PERFORM public.equipment_ledger_append_client(
    u.organization_id, v_event, u.id, u.item_id, NULL, NULL, u.current_holder_id,
    jsonb_build_object('stocktake_id', s.id, 'result', v_result, 'condition', v_cond, 'note', v_note, 'recorded_later', p_occurred_at IS NOT NULL),
    p_client_event_id, v_when);
  PERFORM public.equipment_client_finish(s.organization_id, p_client_event_id, 'stocktake_count',
    jsonb_build_object('unit_id', u.id, 'result', v_result));
  RETURN u.id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.confirm_equipment_still_held(
  p_unit_id uuid, p_client_event_id uuid DEFAULT NULL, p_occurred_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  u public.equipment_units%ROWTYPE;
  s public.equipment_stocktakes%ROWTYPE;
  v_when timestamptz;
  v_replay jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO u FROM public.equipment_units WHERE id = p_unit_id;
  IF NOT FOUND OR NOT public.is_equipment_member(u.organization_id) THEN RAISE EXCEPTION 'unit not found'; END IF;
  v_replay := public.equipment_client_begin(u.organization_id, p_client_event_id, 'still_held');
  IF v_replay IS NOT NULL THEN RETURN (v_replay->>'stocktake_id')::uuid; END IF;
  IF u.current_holder_id IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'only the current holder can confirm this unit';
  END IF;
  SELECT * INTO s FROM public.equipment_stocktakes
   WHERE organization_id = u.organization_id AND finalised_at IS NULL
   ORDER BY started_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'no stocktake is open'; END IF;
  v_when := public.equipment_clamp_occurred_at(p_occurred_at);
  INSERT INTO public.equipment_stocktake_counts (
    stocktake_id, unit_id, result, counted_by, counted_at, client_event_id)
  VALUES (s.id, u.id, 'with_holder_confirmed', uid, v_when, p_client_event_id)
  ON CONFLICT (stocktake_id, unit_id) DO UPDATE
    SET result = 'with_holder_confirmed', counted_by = EXCLUDED.counted_by, counted_at = EXCLUDED.counted_at;
  PERFORM public.equipment_ledger_append_client(
    u.organization_id, 'stocktake_counted', u.id, u.item_id, NULL, NULL, uid,
    jsonb_build_object('stocktake_id', s.id, 'result', 'with_holder_confirmed', 'recorded_later', p_occurred_at IS NOT NULL),
    p_client_event_id, v_when);
  PERFORM public.equipment_client_finish(u.organization_id, p_client_event_id, 'still_held',
    jsonb_build_object('stocktake_id', s.id, 'unit_id', u.id));
  RETURN s.id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finalise_equipment_stocktake(
  p_stocktake_id uuid, p_mark_missing_as_lost boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid uuid := auth.uid();
  s public.equipment_stocktakes%ROWTYPE;
  u public.equipment_units%ROWTYPE;
  c public.equipment_stocktake_counts%ROWTYPE;
  l public.equipment_loans%ROWTYPE;
  v_present int := 0;
  v_missing int := 0;
  v_damaged int := 0;
  v_held int := 0;
  v_lost jsonb := '[]'::jsonb;
  v_left jsonb := '[]'::jsonb;
  v_summary jsonb;
  v_reason text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO s FROM public.equipment_stocktakes WHERE id = p_stocktake_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_equipment(s.organization_id) THEN
    RAISE EXCEPTION 'stocktake not found';
  END IF;
  IF s.finalised_at IS NOT NULL THEN RETURN s.summary; END IF;
  FOR u IN
    SELECT * FROM public.equipment_units
     WHERE organization_id = s.organization_id AND status <> 'retired'
     ORDER BY asset_tag
  LOOP
    SELECT * INTO c FROM public.equipment_stocktake_counts
     WHERE stocktake_id = s.id AND unit_id = u.id;
    IF FOUND AND c.result <> 'missing' THEN
      v_present := v_present + CASE WHEN c.result = 'present' THEN 1 ELSE 0 END;
      v_damaged := v_damaged + CASE WHEN c.result = 'damaged' THEN 1 ELSE 0 END;
      v_held := v_held + CASE WHEN c.result = 'with_holder_confirmed' THEN 1 ELSE 0 END;
      CONTINUE;
    END IF;
    v_missing := v_missing + 1;
    IF NOT FOUND THEN
      INSERT INTO public.equipment_stocktake_counts (stocktake_id, unit_id, result, counted_by, note)
      VALUES (s.id, u.id, 'missing', uid, 'Not seen when the count was closed');
      PERFORM public.equipment_ledger_append_client(
        u.organization_id, 'stocktake_missing', u.id, u.item_id, u.status, NULL, u.current_holder_id,
        jsonb_build_object('stocktake_id', s.id, 'result', 'missing', 'reason', 'not seen'));
    END IF;
    v_reason := NULL;
    IF NOT coalesce(p_mark_missing_as_lost, false) THEN
      v_reason := 'left as ' || replace(u.status, '_', ' ');
    ELSIF u.status IN ('lost', 'stolen') THEN
      v_reason := 'already ' || u.status;
    ELSIF EXISTS (SELECT 1 FROM public.equipment_issue_reports r WHERE r.unit_id = u.id AND r.cleared_at IS NULL) THEN
      v_reason := 'an issue is already open';
    ELSIF NOT public.equipment_transition_allowed(u.status, 'lost') THEN
      v_reason := 'a ' || replace(u.status, '_', ' ') || ' unit cannot be marked lost';
    END IF;
    IF v_reason IS NOT NULL THEN
      v_left := v_left || jsonb_build_array(jsonb_build_object('asset_tag', u.asset_tag, 'reason', v_reason));
      CONTINUE;
    END IF;
    SELECT * INTO l FROM public.equipment_loans WHERE unit_id = u.id AND status = 'active' FOR UPDATE;
    PERFORM public.equipment_set_unit_status_ex(u.id, 'lost', NULL, 'missing at stocktake',
      jsonb_build_object('stocktake_id', s.id, 'action', 'stocktake_missing'));
    IF l.id IS NOT NULL THEN
      UPDATE public.equipment_loans
         SET status = 'issue_reported', ended_at = now(), ended_by = uid, updated_at = now()
       WHERE id = l.id;
    END IF;
    v_lost := v_lost || jsonb_build_array(u.asset_tag);
  END LOOP;
  v_summary := jsonb_build_object(
    'present', v_present, 'with_holder_confirmed', v_held, 'damaged', v_damaged,
    'missing', v_missing, 'marked_lost', v_lost, 'left_unchanged', v_left);
  UPDATE public.equipment_stocktakes
     SET finalised_at = now(), finalised_by = uid, summary = v_summary
   WHERE id = s.id;
  PERFORM public.write_staff_activity('equipment_stocktake_finalised', v_summary, uid, s.organization_id);
  PERFORM public.equipment_notify_managers(s.organization_id, 'Stocktake closed: ' || s.label,
    format('%s missing, %s marked lost.', v_missing, jsonb_array_length(v_lost)),
    '/equipment/admin/stocktake');
  RETURN v_summary;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.get_equipment_stocktake(p_stocktake_id uuid DEFAULT NULL)
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
  v_mgr boolean;
  v_units jsonb;
  v_total int;
  v_counted int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_equipment_member(v_org) THEN RAISE EXCEPTION 'not found'; END IF;
  v_mgr := public.can_manage_equipment(v_org);
  IF p_stocktake_id IS NOT NULL THEN
    SELECT * INTO s FROM public.equipment_stocktakes WHERE id = p_stocktake_id AND organization_id = v_org;
  ELSE
    SELECT * INTO s FROM public.equipment_stocktakes
     WHERE organization_id = v_org AND finalised_at IS NULL
     ORDER BY started_at DESC LIMIT 1;
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*)::int INTO v_total FROM public.equipment_units
   WHERE organization_id = v_org AND status <> 'retired';
  SELECT count(*)::int INTO v_counted FROM public.equipment_stocktake_counts WHERE stocktake_id = s.id;
  SELECT coalesce(jsonb_agg(row_to_json(q)::jsonb ORDER BY q.sort_missing DESC, q.asset_tag), '[]'::jsonb)
    INTO v_units
  FROM (
    SELECT u.id AS unit_id, u.asset_tag, i.name AS item_name, u.status,
           public.equipment_display_name(u.current_holder_id) AS holder_name,
           c.result, c.condition_grade, c.note,
           (c.unit_id IS NULL) AS sort_missing
    FROM public.equipment_units u
    JOIN public.equipment_items i ON i.id = u.item_id
    LEFT JOIN public.equipment_stocktake_counts c ON c.stocktake_id = s.id AND c.unit_id = u.id
    WHERE u.organization_id = v_org AND u.status <> 'retired'
      AND (v_mgr OR u.current_holder_id = uid)
  ) q;
  RETURN jsonb_build_object(
    'id', s.id, 'label', s.label, 'started_at', s.started_at, 'finalised_at', s.finalised_at,
    'summary', s.summary, 'can_manage', v_mgr, 'total', v_total, 'counted', v_counted,
    'units', v_units);
END;
$fn$;

REVOKE ALL ON FUNCTION public.equipment_stocktake_org(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_stocktake_org(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.start_equipment_stocktake(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_equipment_stocktake(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.count_equipment_unit(uuid, uuid, text, text, text, text, text, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_equipment_unit(uuid, uuid, text, text, text, text, text, uuid, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_equipment_still_held(uuid, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_equipment_still_held(uuid, uuid, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalise_equipment_stocktake(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalise_equipment_stocktake(uuid, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_equipment_stocktake(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_equipment_stocktake(uuid) TO authenticated, service_role;

DO $p3d_stocktake$
DECLARE
  missing text;
  names text[] := ARRAY[
    'start_equipment_stocktake', 'count_equipment_unit', 'confirm_equipment_still_held',
    'finalise_equipment_stocktake', 'get_equipment_stocktake', 'equipment_stocktake_org'
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
    RAISE EXCEPTION 'P3d stocktake functions still missing: %', missing;
  END IF;
END
$p3d_stocktake$;
