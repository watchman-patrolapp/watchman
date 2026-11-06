-- =============================================================================
-- P3c - Member reads for hand-over and open theft reports. Additive.
-- Same JSON shape as 20261101030000, plus hand-over id and case-number fields.
-- =============================================================================

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
