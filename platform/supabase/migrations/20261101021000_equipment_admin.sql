-- =============================================================================
-- P3a (admin) - item gallery, kit contents, loan limit, unit notes, admin unit
-- list (labels), next asset tag, richer member item/unit views.
-- Additive on top of 20261101020000_equipment_catalogue.sql. Org-scoped;
-- cross-org access reports "not found". Managers = can_manage_equipment.
-- =============================================================================

ALTER TABLE public.equipment_items
  ADD COLUMN IF NOT EXISTS photo_paths text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS kit_contents text,
  ADD COLUMN IF NOT EXISTS max_loan_hours int;

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_items_photo_paths_max') THEN
    ALTER TABLE public.equipment_items
      ADD CONSTRAINT equipment_items_photo_paths_max CHECK (cardinality(photo_paths) <= 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_items_kit_contents_len') THEN
    ALTER TABLE public.equipment_items
      ADD CONSTRAINT equipment_items_kit_contents_len CHECK (kit_contents IS NULL OR char_length(kit_contents) <= 1000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_items_max_loan_hours_range') THEN
    ALTER TABLE public.equipment_items
      ADD CONSTRAINT equipment_items_max_loan_hours_range CHECK (max_loan_hours IS NULL OR max_loan_hours BETWEEN 1 AND 720);
  END IF;
END
$chk$;

UPDATE public.equipment_items
   SET photo_paths = ARRAY[photo_path]
 WHERE photo_path IS NOT NULL AND cardinality(photo_paths) = 0;

ALTER TABLE public.equipment_units
  ADD COLUMN IF NOT EXISTS notes text;

DO $chk2$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_units_notes_len') THEN
    ALTER TABLE public.equipment_units
      ADD CONSTRAINT equipment_units_notes_len CHECK (notes IS NULL OR char_length(notes) <= 1000);
  END IF;
END
$chk2$;

-- notes stay manager-only (no column grant to authenticated).
GRANT SELECT (photo_paths, kit_contents, max_loan_hours) ON public.equipment_items TO authenticated;

-- -----------------------------------------------------------------------------
-- Item details beyond upsert_equipment_item (kit contents, loan limit).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_equipment_item_details(
  p_item_id uuid, p_kit_contents text DEFAULT NULL, p_max_loan_hours int DEFAULT NULL
)
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
  IF p_max_loan_hours IS NOT NULL AND (p_max_loan_hours < 1 OR p_max_loan_hours > 720) THEN
    RAISE EXCEPTION 'max loan hours must be 1 to 720';
  END IF;
  UPDATE public.equipment_items
     SET kit_contents = nullif(trim(p_kit_contents), ''), max_loan_hours = p_max_loan_hours, updated_at = now()
   WHERE id = p_item_id;
END;
$fn$;

-- Gallery: up to 5 paths, all inside {org}/equipment/{item}/ or {org}/needs/ (copied from a need).
CREATE OR REPLACE FUNCTION public.set_equipment_item_photos(p_item_id uuid, p_paths text[])
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid;
  v_paths text[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT organization_id INTO v_org FROM public.equipment_items WHERE id = p_item_id FOR UPDATE;
  IF v_org IS NULL OR NOT public.can_manage_equipment(v_org) THEN RAISE EXCEPTION 'item not found'; END IF;
  SELECT coalesce(array_agg(t.p ORDER BY t.ord), ARRAY[]::text[]) INTO v_paths
  FROM (SELECT nullif(trim(x.p), '') AS p, x.ord
        FROM unnest(coalesce(p_paths, ARRAY[]::text[])) WITH ORDINALITY AS x(p, ord)) t
  WHERE t.p IS NOT NULL;
  IF cardinality(v_paths) > 5 THEN RAISE EXCEPTION 'up to 5 photos per item'; END IF;
  IF cardinality(v_paths) <> (SELECT count(DISTINCT u) FROM unnest(v_paths) u) THEN
    RAISE EXCEPTION 'duplicate photo';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_paths) u(p)
    WHERE position('..' IN u.p) > 0
       OR NOT (u.p LIKE v_org::text || '/equipment/' || p_item_id::text || '/%'
               OR u.p LIKE v_org::text || '/needs/%')
  ) THEN
    RAISE EXCEPTION 'invalid photo path';
  END IF;
  UPDATE public.equipment_items
     SET photo_paths = v_paths, photo_path = v_paths[1], updated_at = now()
   WHERE id = p_item_id;
  RETURN v_paths;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.set_equipment_unit_notes(p_unit_id uuid, p_notes text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT organization_id INTO v_org FROM public.equipment_units WHERE id = p_unit_id;
  IF v_org IS NULL OR NOT public.can_manage_equipment(v_org) THEN RAISE EXCEPTION 'unit not found'; END IF;
  UPDATE public.equipment_units SET notes = nullif(trim(p_notes), '') WHERE id = p_unit_id;
END;
$fn$;

-- Next free tag: prefix from the item's latest tag (or its name), then the next number.
CREATE OR REPLACE FUNCTION public.suggest_equipment_asset_tag(p_item_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid;
  v_name text;
  v_last text;
  v_prefix text;
  v_n int;
  v_width int := 2;
  v_tag text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT organization_id, name INTO v_org, v_name FROM public.equipment_items WHERE id = p_item_id;
  IF v_org IS NULL OR NOT public.can_manage_equipment(v_org) THEN RAISE EXCEPTION 'item not found'; END IF;
  SELECT asset_tag INTO v_last FROM public.equipment_units
   WHERE item_id = p_item_id ORDER BY created_at DESC, asset_tag DESC LIMIT 1;
  IF v_last IS NOT NULL AND v_last ~ '[0-9]+$' THEN
    v_prefix := regexp_replace(v_last, '[0-9]+$', '');
    v_width := greatest(char_length(substring(v_last FROM '([0-9]+)$')), 2);
  ELSE
    v_prefix := left(regexp_replace(upper(coalesce(v_name, 'EQ')), '[^A-Z0-9]', '', 'g'), 3);
    IF char_length(v_prefix) < 2 THEN v_prefix := 'EQ'; END IF;
    v_prefix := v_prefix || '-';
  END IF;
  SELECT coalesce(max((substring(asset_tag FROM char_length(v_prefix) + 1))::int), 0) + 1 INTO v_n
    FROM public.equipment_units
   WHERE organization_id = v_org
     AND left(asset_tag, char_length(v_prefix)) = v_prefix
     AND substring(asset_tag FROM char_length(v_prefix) + 1) ~ '^[0-9]{1,6}$';
  LOOP
    v_tag := left(v_prefix || lpad(v_n::text, v_width, '0'), 24);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.equipment_units WHERE organization_id = v_org AND asset_tag = v_tag);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_tag;
END;
$fn$;

-- Manager list of units with restricted columns (editor + labels). p_item_id NULL = whole org.
CREATE OR REPLACE FUNCTION public.list_equipment_units_admin(p_item_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid, item_id uuid, item_name text, asset_tag text, status text, condition text,
  holder_name text, location_note text, serial_number text, purchase_price_cents bigint,
  purchase_date date, supplier text, invoice_path text, funding_source text, notes text,
  photo_path text, qr_token text, created_at timestamptz
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
  IF p_item_id IS NOT NULL THEN
    SELECT i.organization_id INTO v_org FROM public.equipment_items i WHERE i.id = p_item_id;
    IF v_org IS NULL OR NOT public.can_manage_equipment(v_org) THEN RAISE EXCEPTION 'item not found'; END IF;
  ELSE
    v_org := public.equipment_require_org();
    IF NOT public.can_manage_equipment(v_org) THEN RAISE EXCEPTION 'forbidden'; END IF;
  END IF;
  RETURN QUERY
  SELECT u.id, u.item_id, i.name, u.asset_tag, u.status, u.condition, public.equipment_display_name(u.current_holder_id), u.location_note,
         u.serial_number, u.purchase_price_cents, u.purchase_date, u.supplier, u.invoice_path,
         u.funding_source, u.notes, u.photo_path, u.qr_token, u.created_at
  FROM public.equipment_units u
  JOIN public.equipment_items i ON i.id = u.item_id
  WHERE u.organization_id = v_org AND (p_item_id IS NULL OR u.item_id = p_item_id)
  ORDER BY i.name, u.asset_tag;
END;
$fn$;

-- Member item view gains gallery, kit contents and loan limit (same signature).
CREATE OR REPLACE FUNCTION public.get_equipment_item(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  i public.equipment_items%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
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
    'units', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'asset_tag', u.asset_tag, 'status', u.status, 'condition', u.condition,
        'holder_name', public.equipment_display_name(u.current_holder_id),
        'is_mine', coalesce(u.current_holder_id = auth.uid(), false), 'location_note', u.location_note
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
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
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
      'is_mine', coalesce(u.current_holder_id = auth.uid(), false),
      'location_note', u.location_note, 'photo_path', u.photo_path, 'updated_at', u.updated_at,
      'can_manage', public.can_manage_equipment(u.organization_id))
    FROM public.equipment_items i
    LEFT JOIN public.equipment_categories c ON c.id = i.category_id
    WHERE i.id = u.item_id
  );
END;
$fn$;

-- From a need: also copies the need's photos (same signature as before).
CREATE OR REPLACE FUNCTION public.create_equipment_from_wishlist(p_wishlist_item_id uuid, p_category_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  w record;
  v_id uuid;
  v_paths text[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO w FROM public.equipment_wishlist_items WHERE id = p_wishlist_item_id;
  IF NOT FOUND OR NOT public.can_manage_equipment(w.organization_id) THEN RAISE EXCEPTION 'item not found'; END IF;
  SELECT id INTO v_id FROM public.equipment_items
   WHERE wishlist_item_id = p_wishlist_item_id AND organization_id = w.organization_id LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.equipment_categories c WHERE c.id = p_category_id AND c.organization_id = w.organization_id) THEN
    RAISE EXCEPTION 'category not found';
  END IF;
  v_paths := (coalesce(w.photo_paths, ARRAY[]::text[]))[1:5];
  INSERT INTO public.equipment_items (organization_id, category_id, name, description, wishlist_item_id,
    photo_paths, photo_path, created_by)
  VALUES (w.organization_id, p_category_id, left(w.title, 120), left(w.reason, 2000), w.id,
    v_paths, coalesce(v_paths[1], w.photo_path), auth.uid())
  RETURNING id INTO v_id;
  PERFORM public.equipment_ledger_append(w.organization_id, 'item_created', NULL, v_id, NULL, NULL, NULL,
    jsonb_build_object('name', left(w.title, 120), 'wishlist_item_id', w.id));
  RETURN v_id;
END;
$fn$;

-- Which needs are already in the inventory (for "Add to inventory" on /admin/needs).
CREATE OR REPLACE FUNCTION public.list_equipment_wishlist_links()
RETURNS TABLE (wishlist_item_id uuid, item_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public.equipment_require_org();
BEGIN
  IF NOT public.can_manage_equipment(v_org) THEN RETURN; END IF;
  RETURN QUERY
  SELECT i.wishlist_item_id, i.id FROM public.equipment_items i
  WHERE i.organization_id = v_org AND i.wishlist_item_id IS NOT NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.set_equipment_item_details(uuid, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_equipment_item_details(uuid, text, int) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_equipment_item_photos(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_equipment_item_photos(uuid, text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_equipment_unit_notes(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_equipment_unit_notes(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.suggest_equipment_asset_tag(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_equipment_asset_tag(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_equipment_units_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_equipment_units_admin(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_equipment_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_equipment_item(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_equipment_unit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_equipment_unit(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_equipment_from_wishlist(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_equipment_from_wishlist(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_equipment_wishlist_links() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_equipment_wishlist_links() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
