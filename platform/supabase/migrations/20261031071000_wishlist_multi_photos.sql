-- P2.1: up to 5 photos per needs item (gallery; first = cover).
-- Additive on top of 20261031070000_equipment_wishlist.sql (already applied).
-- * photo_paths text[] is the source of truth; photo_path stays as the cover
--   (= photo_paths[1]) so older clients keep working.
-- * New RPC set_wishlist_item_photos(id, paths[]) validates every path server-side.
-- * list_wishlist_items is recreated (DROP + CREATE, return type gains photo_paths).
-- No data loss: existing photo_path values are backfilled into photo_paths.

-- ---------------------------------------------------------------------------
-- 1) Column + row-level path check (org prefix; per-item prefix is enforced by the RPC)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wishlist_photo_paths_ok(p_org_id uuid, p_paths text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(cardinality(p_paths), 0) <= 5
    AND NOT EXISTS (
      SELECT 1 FROM unnest(coalesce(p_paths, ARRAY[]::text[])) AS p(path)
      WHERE p.path IS NULL
         OR char_length(p.path) > 300
         OR position('..' IN p.path) > 0
         OR left(p.path, char_length(p_org_id::text || '/needs/')) <> p_org_id::text || '/needs/'
    );
$$;
REVOKE ALL ON FUNCTION public.wishlist_photo_paths_ok(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wishlist_photo_paths_ok(uuid, text[]) TO authenticated, service_role;

ALTER TABLE public.equipment_wishlist_items
  ADD COLUMN IF NOT EXISTS photo_paths text[] NOT NULL DEFAULT '{}';

UPDATE public.equipment_wishlist_items
SET photo_paths = ARRAY[photo_path]
WHERE photo_path IS NOT NULL AND cardinality(photo_paths) = 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'equipment_wishlist_items_photo_paths_ok'
  ) THEN
    ALTER TABLE public.equipment_wishlist_items
      ADD CONSTRAINT equipment_wishlist_items_photo_paths_ok
      CHECK (cardinality(photo_paths) <= 5 AND public.wishlist_photo_paths_ok(organization_id, photo_paths));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Keep photo_path (cover) and photo_paths coherent.
--    photo_paths changed -> cover = photo_paths[1].
--    Only photo_path changed (older client via upsert_wishlist_item):
--      new non-null cover -> moved/prepended to the front (max 5);
--      cleared -> old cover removed from the gallery.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_wishlist_items_sync_photos()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.photo_paths := coalesce(NEW.photo_paths, ARRAY[]::text[]);
  IF TG_OP = 'INSERT' THEN
    IF cardinality(NEW.photo_paths) = 0 AND NEW.photo_path IS NOT NULL THEN
      NEW.photo_paths := ARRAY[NEW.photo_path];
    END IF;
  ELSIF NEW.photo_paths IS DISTINCT FROM OLD.photo_paths THEN
    NULL; -- gallery is authoritative
  ELSIF NEW.photo_path IS DISTINCT FROM OLD.photo_path THEN
    IF NEW.photo_path IS NULL THEN
      NEW.photo_paths := array_remove(NEW.photo_paths, OLD.photo_path);
    ELSE
      NEW.photo_paths := (array_prepend(NEW.photo_path, array_remove(NEW.photo_paths, NEW.photo_path)))[1:5];
    END IF;
  END IF;
  NEW.photo_path := NEW.photo_paths[1];
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_wishlist_items_sync_photos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_wishlist_items_sync_photos() TO service_role;

DROP TRIGGER IF EXISTS wishlist_items_sync_photos ON public.equipment_wishlist_items;
CREATE TRIGGER wishlist_items_sync_photos
  BEFORE INSERT OR UPDATE ON public.equipment_wishlist_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_wishlist_items_sync_photos();

-- ---------------------------------------------------------------------------
-- 3) set_wishlist_item_photos: replace the gallery (order = display order).
--    Managers only; every path must be {org}/needs/{item id}/..., max 5, no dupes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_wishlist_item_photos(p_id uuid, p_paths text[])
RETURNS public.equipment_wishlist_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  existing public.equipment_wishlist_items;
  saved public.equipment_wishlist_items;
  v_paths text[];
  v_prefix text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO existing FROM public.equipment_wishlist_items WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR existing.organization_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'item not found';
  END IF;
  IF NOT public.can_manage_wishlist(existing.organization_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT coalesce(array_agg(t.p ORDER BY t.ord), ARRAY[]::text[]) INTO v_paths
  FROM (
    SELECT nullif(trim(x.p), '') AS p, x.ord
    FROM unnest(coalesce(p_paths, ARRAY[]::text[])) WITH ORDINALITY AS x(p, ord)
  ) t
  WHERE t.p IS NOT NULL;

  IF cardinality(v_paths) > 5 THEN
    RAISE EXCEPTION 'up to 5 photos per item';
  END IF;
  IF cardinality(v_paths) <> (SELECT count(DISTINCT u) FROM unnest(v_paths) u) THEN
    RAISE EXCEPTION 'duplicate photo';
  END IF;
  v_prefix := existing.organization_id::text || '/needs/' || existing.id::text || '/';
  IF EXISTS (
    SELECT 1 FROM unnest(v_paths) u(p)
    WHERE position('..' IN u.p) > 0
       OR char_length(u.p) > 300
       OR left(u.p, char_length(v_prefix)) <> v_prefix
  ) THEN
    RAISE EXCEPTION 'invalid photo path';
  END IF;

  UPDATE public.equipment_wishlist_items
  SET photo_paths = v_paths, updated_at = now()
  WHERE id = existing.id
  RETURNING * INTO saved;

  PERFORM public.write_staff_activity(
    'wishlist_item_photos',
    jsonb_build_object('item_id', saved.id, 'count', cardinality(v_paths)),
    uid,
    saved.organization_id
  );
  RETURN saved;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) list_wishlist_items: body from 20261031070000 + photo_paths.
--    Return type changes, so DROP + CREATE (same args, same grants re-applied).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_wishlist_items(text, uuid);
CREATE FUNCTION public.list_wishlist_items(p_status text DEFAULT NULL, p_item_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  title text,
  reason text,
  photo_path text,
  photo_paths text[],
  quantity_needed integer,
  quantity_acquired integer,
  est_unit_price_cents bigint,
  store_url text,
  product_code text,
  priority text,
  category_hint text,
  status text,
  status_note text,
  acquired_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  my_offer_id uuid,
  my_offer_status text,
  open_offer_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  org_id uuid := public.working_organization_id();
  is_manager boolean;
  st text := nullif(lower(trim(coalesce(p_status, ''))), '');
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF org_id IS NULL OR org_id NOT IN (SELECT public.current_org_ids()) THEN
    RETURN;
  END IF;
  IF st IS NOT NULL AND st NOT IN ('needed', 'acquired', 'cancelled') THEN
    RAISE EXCEPTION 'unknown status';
  END IF;
  is_manager := public.can_manage_wishlist(org_id);

  RETURN QUERY
  SELECT i.id, i.title, i.reason, i.photo_path, i.photo_paths, i.quantity_needed, i.quantity_acquired,
         i.est_unit_price_cents, i.store_url, i.product_code, i.priority, i.category_hint,
         i.status, i.status_note, i.acquired_at, i.created_at, i.updated_at,
         mo.id, mo.status,
         CASE WHEN is_manager THEN (
           SELECT count(*)::integer FROM public.equipment_wishlist_offers f
           WHERE f.wishlist_item_id = i.id AND f.status IN ('new', 'acknowledged', 'accepted')
         ) END
  FROM public.equipment_wishlist_items i
  LEFT JOIN LATERAL (
    SELECT f.id, f.status FROM public.equipment_wishlist_offers f
    WHERE f.wishlist_item_id = i.id AND f.user_id = uid
    ORDER BY (f.status IN ('new', 'acknowledged', 'accepted')) DESC, f.created_at DESC
    LIMIT 1
  ) mo ON true
  WHERE i.organization_id = org_id
    AND (p_item_id IS NULL OR i.id = p_item_id)
    AND (i.status <> 'cancelled' OR is_manager)
    AND (st IS NULL OR i.status = st)
  ORDER BY (i.status = 'needed') DESC,
           CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
           i.created_at DESC;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4b) set_wishlist_item_acquired: partial acquisition (0..quantity_needed).
--     set_wishlist_item_status already stores quantity_acquired and flips
--     needed -> acquired, but does not flip acquired -> needed when the count
--     is lowered. This wrapper picks the status from the count and delegates
--     (same checks, notifications and wishlist_item_status audit row).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_wishlist_item_acquired(p_item_id uuid, p_qty integer)
RETURNS public.equipment_wishlist_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it public.equipment_wishlist_items;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO it FROM public.equipment_wishlist_items WHERE id = p_item_id;
  IF NOT FOUND OR it.organization_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'item not found';
  END IF;
  IF NOT public.can_manage_wishlist(it.organization_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF it.status = 'cancelled' THEN
    RAISE EXCEPTION 'reopen the item first';
  END IF;
  IF p_qty IS NULL OR p_qty < 0 OR p_qty > it.quantity_needed THEN
    RAISE EXCEPTION 'quantity acquired must be 0 to %', it.quantity_needed;
  END IF;
  RETURN public.set_wishlist_item_status(
    p_item_id,
    CASE WHEN p_qty >= it.quantity_needed THEN 'acquired' ELSE 'needed' END,
    p_qty,
    NULL
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.set_wishlist_item_photos(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_wishlist_item_photos(uuid, text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_wishlist_items(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_wishlist_items(text, uuid) TO authenticated, service_role;REVOKE ALL ON FUNCTION public.set_wishlist_item_acquired(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_wishlist_item_acquired(uuid, integer) TO authenticated, service_role;
