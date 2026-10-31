-- P2 - Equipment wishlist / needs board (no money).
-- NEW_FEATURES_BLUEPRINT section 7 (D4-D9, D16) + 12.7 definer checklist.
--
-- Purely additive: two new tables, new functions, and a CREATE OR REPLACE of the
-- two P1 move/leave trigger functions (latest bodies from 20261031060000) so they
-- also withdraw the mover's open offers in the old neighbourhood. No existing rows
-- are changed or deleted by applying this file.
--
-- No money moves through the app: est_unit_price_cents is informational only and
-- offer notes are screened for payment details.

-- ---------------------------------------------------------------------------
-- 1) Who manages the board (D4): NW admin of the org, equipment custodians,
--    global / platform staff (working org). Committee is not included.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_manage_wishlist(p_org_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND COALESCE(p_org_id, public.working_organization_id()) IS NOT NULL
    AND COALESCE(p_org_id, public.working_organization_id()) IN (SELECT public.current_org_ids())
    AND (
      public.is_global_app_staff() OR public.is_platform_staff()
      OR public.is_org_nw_admin(COALESCE(p_org_id, public.working_organization_id()))
      OR public.has_org_capability('equipment_custodian', COALESCE(p_org_id, public.working_organization_id()))
    );
$$;

-- ---------------------------------------------------------------------------
-- 2) Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.equipment_wishlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 1000),
  photo_path text CHECK (photo_path IS NULL OR char_length(photo_path) <= 300),
  quantity_needed integer NOT NULL DEFAULT 1 CHECK (quantity_needed BETWEEN 1 AND 500),
  quantity_acquired integer NOT NULL DEFAULT 0 CHECK (quantity_acquired BETWEEN 0 AND 500),
  est_unit_price_cents bigint CHECK (est_unit_price_cents IS NULL OR est_unit_price_cents BETWEEN 0 AND 100000000),
  store_url text CHECK (store_url IS NULL OR (store_url ~* '^https://' AND char_length(store_url) <= 500)),
  product_code text CHECK (product_code IS NULL OR char_length(product_code) <= 80),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  category_hint text CHECK (category_hint IS NULL OR char_length(category_hint) <= 80),
  status text NOT NULL DEFAULT 'needed' CHECK (status IN ('needed', 'acquired', 'cancelled')),
  status_note text CHECK (status_note IS NULL OR char_length(status_note) <= 500),
  acquired_at timestamptz,
  created_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS equipment_wishlist_org_idx
  ON public.equipment_wishlist_items (organization_id, status, priority);

CREATE TABLE IF NOT EXISTS public.equipment_wishlist_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  wishlist_item_id uuid NOT NULL REFERENCES public.equipment_wishlist_items (id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'contribute_item'
    CHECK (kind IN ('contribute_item', 'source_at_cost', 'lend_item', 'other_help')),
  quantity integer CHECK (quantity IS NULL OR quantity BETWEEN 1 AND 500),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'acknowledged', 'accepted', 'declined', 'withdrawn', 'fulfilled')),
  handled_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  handled_at timestamptz,
  handled_note text CHECK (handled_note IS NULL OR char_length(handled_note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_wishlist_one_open_offer
  ON public.equipment_wishlist_offers (wishlist_item_id, user_id)
  WHERE status IN ('new', 'acknowledged', 'accepted');
CREATE INDEX IF NOT EXISTS equipment_wishlist_offers_user_idx
  ON public.equipment_wishlist_offers (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS equipment_wishlist_offers_item_idx
  ON public.equipment_wishlist_offers (wishlist_item_id, status);

ALTER TABLE public.equipment_wishlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_wishlist_offers ENABLE ROW LEVEL SECURITY;

-- Items: any member of the org reads needed/acquired; managers also see cancelled.
DROP POLICY IF EXISTS wishlist_items_select ON public.equipment_wishlist_items;
CREATE POLICY wishlist_items_select ON public.equipment_wishlist_items FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.current_org_ids())
         AND (status <> 'cancelled' OR public.can_manage_wishlist(organization_id)));

-- Offers (D5): own offers, or managers of that org. Others never see who offered.
DROP POLICY IF EXISTS wishlist_offers_select ON public.equipment_wishlist_offers;
CREATE POLICY wishlist_offers_select ON public.equipment_wishlist_offers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_manage_wishlist(organization_id));

-- All writes go through the RPCs below. Not added to supabase_realtime (12.7 #13).
REVOKE ALL ON public.equipment_wishlist_items, public.equipment_wishlist_offers FROM anon, authenticated;
GRANT SELECT ON public.equipment_wishlist_items, public.equipment_wishlist_offers TO authenticated;
GRANT ALL ON public.equipment_wishlist_items, public.equipment_wishlist_offers TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Internal: managers of an org (NW admins + active custodians) for notices.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wishlist_manager_ids(p_org_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id FROM public.users u
  WHERE replace(lower(trim(u.role::text)), '-', '_') = 'nw_admin'
    AND (u.organization_id = p_org_id
         OR EXISTS (SELECT 1 FROM public.organization_members om
                    WHERE om.user_id = u.id AND om.organization_id = p_org_id
                      AND om.status = 'active' AND om.member_role = 'nw_admin'))
  UNION
  SELECT g.user_id FROM public.org_capability_grants g
  WHERE g.organization_id = p_org_id
    AND g.capability = 'equipment_custodian'
    AND g.revoked_at IS NULL
    AND (g.expires_at IS NULL OR g.expires_at > now())
    AND public.user_in_org(g.user_id, p_org_id);
$$;

-- ---------------------------------------------------------------------------
-- 4) upsert_wishlist_item
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_wishlist_item(
  p_id uuid,
  p_title text,
  p_reason text DEFAULT NULL,
  p_photo_path text DEFAULT NULL,
  p_quantity_needed integer DEFAULT 1,
  p_est_unit_price_cents bigint DEFAULT NULL,
  p_store_url text DEFAULT NULL,
  p_product_code text DEFAULT NULL,
  p_priority text DEFAULT 'normal',
  p_category_hint text DEFAULT NULL
)
RETURNS public.equipment_wishlist_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  org_id uuid;
  existing public.equipment_wishlist_items;
  saved public.equipment_wishlist_items;
  v_title text := trim(coalesce(p_title, ''));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_photo text := nullif(trim(coalesce(p_photo_path, '')), '');
  v_url text := nullif(trim(coalesce(p_store_url, '')), '');
  v_code text := nullif(trim(coalesce(p_product_code, '')), '');
  v_hint text := nullif(trim(coalesce(p_category_hint, '')), '');
  v_priority text := lower(trim(coalesce(p_priority, 'normal')));
  v_qty integer := coalesce(p_quantity_needed, 1);
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_id IS NULL THEN
    org_id := public.working_organization_id();
    IF org_id IS NULL THEN
      RAISE EXCEPTION 'no neighbourhood selected';
    END IF;
    IF NOT public.can_manage_wishlist(org_id) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  ELSE
    SELECT * INTO existing FROM public.equipment_wishlist_items WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR existing.organization_id NOT IN (SELECT public.current_org_ids()) THEN
      RAISE EXCEPTION 'item not found';
    END IF;
    org_id := existing.organization_id;
    IF NOT public.can_manage_wishlist(org_id) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;

  IF char_length(v_title) < 2 OR char_length(v_title) > 120 THEN
    RAISE EXCEPTION 'title must be 2 to 120 characters';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'reason is too long';
  END IF;
  IF v_qty < 1 OR v_qty > 500 THEN
    RAISE EXCEPTION 'quantity must be 1 to 500';
  END IF;
  IF p_est_unit_price_cents IS NOT NULL AND (p_est_unit_price_cents < 0 OR p_est_unit_price_cents > 100000000) THEN
    RAISE EXCEPTION 'estimated price is out of range';
  END IF;
  IF v_url IS NOT NULL AND (v_url !~* '^https://[^[:space:]]+$' OR char_length(v_url) > 500) THEN
    RAISE EXCEPTION 'store link must start with https://';
  END IF;
  IF v_code IS NOT NULL AND char_length(v_code) > 80 THEN
    RAISE EXCEPTION 'product code is too long';
  END IF;
  IF v_hint IS NOT NULL AND char_length(v_hint) > 80 THEN
    RAISE EXCEPTION 'category is too long';
  END IF;
  IF v_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'unknown priority';
  END IF;
  -- 12.7 #4: photos must live under this org's needs folder (and this item's, once it exists).
  IF v_photo IS NOT NULL AND (
       position('..' IN v_photo) > 0
       OR char_length(v_photo) > 300
       OR (p_id IS NULL AND v_photo NOT LIKE org_id::text || '/needs/%')
       OR (p_id IS NOT NULL AND v_photo NOT LIKE org_id::text || '/needs/' || p_id::text || '/%')
     ) THEN
    RAISE EXCEPTION 'invalid photo path';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.equipment_wishlist_items (
      organization_id, title, reason, photo_path, quantity_needed, est_unit_price_cents,
      store_url, product_code, priority, category_hint, created_by
    ) VALUES (
      org_id, v_title, v_reason, v_photo, v_qty, p_est_unit_price_cents,
      v_url, v_code, v_priority, v_hint, uid
    )
    RETURNING * INTO saved;
  ELSE
    UPDATE public.equipment_wishlist_items
    SET title = v_title,
        reason = v_reason,
        photo_path = v_photo,
        quantity_needed = v_qty,
        quantity_acquired = least(quantity_acquired, 500),
        est_unit_price_cents = p_est_unit_price_cents,
        store_url = v_url,
        product_code = v_code,
        priority = v_priority,
        category_hint = v_hint,
        updated_at = now()
    WHERE id = p_id
    RETURNING * INTO saved;
  END IF;

  PERFORM public.write_staff_activity(
    'wishlist_item_saved',
    jsonb_build_object('item_id', saved.id, 'title', saved.title, 'created', p_id IS NULL)
      || CASE WHEN public.has_org_capability('equipment_custodian', org_id)
                   AND NOT (public.is_org_nw_admin(org_id) OR public.is_global_app_staff() OR public.is_platform_staff())
              THEN jsonb_build_object('capability', 'equipment_custodian') ELSE '{}'::jsonb END,
    uid,
    org_id
  );
  RETURN saved;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) set_wishlist_item_status
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_wishlist_item_status(
  p_id uuid,
  p_status text DEFAULT NULL,
  p_quantity_acquired integer DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS public.equipment_wishlist_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  it public.equipment_wishlist_items;
  saved public.equipment_wishlist_items;
  v_status text;
  v_qa integer;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  o record;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO it FROM public.equipment_wishlist_items WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR it.organization_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'item not found';
  END IF;
  IF NOT public.can_manage_wishlist(it.organization_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_status := lower(trim(coalesce(p_status, it.status)));
  IF v_status NOT IN ('needed', 'acquired', 'cancelled') THEN
    RAISE EXCEPTION 'unknown status';
  END IF;
  v_qa := coalesce(p_quantity_acquired, it.quantity_acquired);
  IF v_qa < 0 OR v_qa > 500 THEN
    RAISE EXCEPTION 'quantity acquired must be 0 to 500';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'note is too long';
  END IF;
  -- Auto-flip: everything needed is in.
  IF v_status = 'needed' AND v_qa >= it.quantity_needed THEN
    v_status := 'acquired';
  END IF;

  UPDATE public.equipment_wishlist_items
  SET status = v_status,
      quantity_acquired = v_qa,
      status_note = coalesce(v_note, CASE WHEN v_status = it.status THEN status_note END),
      acquired_at = CASE WHEN v_status = 'acquired' THEN coalesce(it.acquired_at, now()) END,
      updated_at = now()
  WHERE id = p_id
  RETURNING * INTO saved;

  IF v_status IN ('acquired', 'cancelled') AND it.status IS DISTINCT FROM v_status THEN
    FOR o IN
      SELECT DISTINCT f.user_id FROM public.equipment_wishlist_offers f
      WHERE f.wishlist_item_id = p_id AND f.status IN ('new', 'acknowledged', 'accepted')
        AND f.user_id IS NOT NULL AND f.user_id <> uid
    LOOP
      PERFORM public.notify_app_user(
        o.user_id, 'wishlist',
        CASE WHEN v_status = 'acquired' THEN 'Thanks, this item has been acquired'
             ELSE 'This item is no longer needed' END,
        saved.title,
        '/resident/needs/' || p_id::text
      );
    END LOOP;
  END IF;

  PERFORM public.write_staff_activity(
    'wishlist_item_status',
    jsonb_build_object('item_id', p_id, 'title', saved.title, 'from', it.status, 'to', v_status,
                       'quantity_acquired', v_qa, 'quantity_needed', saved.quantity_needed)
      || CASE WHEN public.has_org_capability('equipment_custodian', it.organization_id)
                   AND NOT (public.is_org_nw_admin(it.organization_id) OR public.is_global_app_staff() OR public.is_platform_staff())
              THEN jsonb_build_object('capability', 'equipment_custodian') ELSE '{}'::jsonb END,
    uid,
    it.organization_id
  );
  RETURN saved;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) create_wishlist_offer (D7: unverified residents may offer; D8: 5 / 24 h)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_wishlist_offer(
  p_item_id uuid,
  p_kind text DEFAULT 'contribute_item',
  p_quantity integer DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  it public.equipment_wishlist_items;
  v_kind text := lower(trim(coalesce(p_kind, 'contribute_item')));
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_recent integer;
  new_id uuid;
  m uuid;
  who text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO it FROM public.equipment_wishlist_items WHERE id = p_item_id;
  IF NOT FOUND OR it.organization_id NOT IN (SELECT public.current_org_ids())
     OR (it.status = 'cancelled' AND NOT public.can_manage_wishlist(it.organization_id)) THEN
    RAISE EXCEPTION 'item not found';
  END IF;
  IF it.status <> 'needed' THEN
    RAISE EXCEPTION 'this item is no longer needed';
  END IF;
  IF v_kind NOT IN ('contribute_item', 'source_at_cost', 'lend_item', 'other_help') THEN
    RAISE EXCEPTION 'unknown offer type';
  END IF;
  IF p_quantity IS NOT NULL AND (p_quantity < 1 OR p_quantity > 500) THEN
    RAISE EXCEPTION 'quantity must be 1 to 500';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'note is too long';
  END IF;
  -- No payment or ID details: 9+ digit runs (account / ID / card numbers) or payment wording.
  IF v_note IS NOT NULL AND (
       v_note ~ '[0-9]{9,}'
       OR v_note ~* '(account[[:space:]]*(number|no\.?|#)|\miban\M|\mcard\M|\mswift\M|\mbranch[[:space:]]+code\M)'
     ) THEN
    RAISE EXCEPTION 'please don''t share payment details; the committee will contact you';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.equipment_wishlist_offers
    WHERE wishlist_item_id = p_item_id AND user_id = uid AND status IN ('new', 'acknowledged', 'accepted')
  ) THEN
    RAISE EXCEPTION 'you already offered on this item';
  END IF;
  SELECT count(*) INTO v_recent FROM public.equipment_wishlist_offers
  WHERE user_id = uid AND created_at > now() - interval '24 hours';
  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'offer limit reached (5 per 24 hours)';
  END IF;

  INSERT INTO public.equipment_wishlist_offers (organization_id, wishlist_item_id, user_id, kind, quantity, note)
  VALUES (it.organization_id, p_item_id, uid, v_kind, p_quantity, v_note)
  RETURNING id INTO new_id;

  SELECT coalesce(nullif(trim(full_name), ''), 'A neighbour') INTO who FROM public.users WHERE id = uid;
  FOR m IN SELECT x FROM public.wishlist_manager_ids(it.organization_id) x WHERE x <> uid LOOP
    PERFORM public.notify_app_user(m, 'wishlist', 'New offer to help',
      coalesce(who, 'A neighbour') || ' offered to help with: ' || it.title, '/admin/needs');
  END LOOP;
  RETURN new_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7) withdraw_wishlist_offer (offer owner)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.withdraw_wishlist_offer(p_offer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  o public.equipment_wishlist_offers;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO o FROM public.equipment_wishlist_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND OR o.user_id IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'offer not found';
  END IF;
  IF o.status NOT IN ('new', 'acknowledged', 'accepted') THEN
    RAISE EXCEPTION 'offer already closed';
  END IF;
  UPDATE public.equipment_wishlist_offers
  SET status = 'withdrawn', handled_at = now()
  WHERE id = p_offer_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8) respond_wishlist_offer (manager; notifies the offerer)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_wishlist_offer(p_offer_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  o public.equipment_wishlist_offers;
  v_status text := lower(trim(coalesce(p_status, '')));
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_title text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO o FROM public.equipment_wishlist_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND OR o.organization_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'offer not found';
  END IF;
  IF NOT public.can_manage_wishlist(o.organization_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v_status NOT IN ('acknowledged', 'accepted', 'declined', 'fulfilled') THEN
    RAISE EXCEPTION 'unknown status';
  END IF;
  IF o.status IN ('declined', 'withdrawn', 'fulfilled') THEN
    RAISE EXCEPTION 'offer already closed';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'note is too long';
  END IF;

  UPDATE public.equipment_wishlist_offers
  SET status = v_status, handled_by = uid, handled_at = now(), handled_note = coalesce(v_note, handled_note)
  WHERE id = p_offer_id;

  SELECT title INTO v_title FROM public.equipment_wishlist_items WHERE id = o.wishlist_item_id;
  IF o.user_id IS NOT NULL AND o.user_id <> uid THEN
    PERFORM public.notify_app_user(
      o.user_id, 'wishlist',
      CASE v_status
        WHEN 'acknowledged' THEN 'The committee saw your offer'
        WHEN 'accepted' THEN 'Your offer was accepted'
        WHEN 'declined' THEN 'Thanks - your offer is not needed right now'
        ELSE 'Thanks for your contribution'
      END,
      coalesce(v_title, 'Watch needs') || coalesce(' - ' || v_note, ''),
      '/resident/needs/' || o.wishlist_item_id::text
    );
  END IF;

  PERFORM public.write_staff_activity(
    'wishlist_offer_responded',
    jsonb_build_object('offer_id', p_offer_id, 'item_id', o.wishlist_item_id, 'from', o.status, 'to', v_status)
      || CASE WHEN public.has_org_capability('equipment_custodian', o.organization_id)
                   AND NOT (public.is_org_nw_admin(o.organization_id) OR public.is_global_app_staff() OR public.is_platform_staff())
              THEN jsonb_build_object('capability', 'equipment_custodian') ELSE '{}'::jsonb END,
    uid,
    o.organization_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 9) list_wishlist_items (working org; members: + my offer; managers: + open offer count)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_wishlist_items(p_status text DEFAULT NULL, p_item_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  title text,
  reason text,
  photo_path text,
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
  SELECT i.id, i.title, i.reason, i.photo_path, i.quantity_needed, i.quantity_acquired,
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
-- 10) list_wishlist_offers (managers; offerer contact for follow-up)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_wishlist_offers(p_item_id uuid DEFAULT NULL, p_include_closed boolean DEFAULT false)
RETURNS TABLE (
  id uuid,
  wishlist_item_id uuid,
  item_title text,
  user_id uuid,
  full_name text,
  phone text,
  street_label text,
  verified boolean,
  kind text,
  quantity integer,
  note text,
  status text,
  handled_by_name text,
  handled_at timestamptz,
  handled_note text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  org_id uuid := public.working_organization_id();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF org_id IS NULL THEN
    RAISE EXCEPTION 'no neighbourhood selected';
  END IF;
  IF p_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.equipment_wishlist_items i
    WHERE i.id = p_item_id AND i.organization_id = org_id AND i.organization_id IN (SELECT public.current_org_ids())
  ) THEN
    RAISE EXCEPTION 'item not found';
  END IF;
  IF NOT public.can_manage_wishlist(org_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT f.id, f.wishlist_item_id, i.title, f.user_id, u.full_name,
         nullif(trim(u.phone), ''),
         public.resident_street_label(coalesce(nullif(trim(rp.home_address), ''), u.address)),
         CASE WHEN f.user_id IS NULL THEN false ELSE public.is_verified_household(f.user_id) END,
         f.kind, f.quantity, f.note, f.status, hb.full_name, f.handled_at, f.handled_note, f.created_at
  FROM public.equipment_wishlist_offers f
  JOIN public.equipment_wishlist_items i ON i.id = f.wishlist_item_id
  LEFT JOIN public.users u ON u.id = f.user_id
  LEFT JOIN public.resident_profiles rp ON rp.user_id = f.user_id
  LEFT JOIN public.users hb ON hb.id = f.handled_by
  WHERE f.organization_id = org_id
    AND (p_item_id IS NULL OR f.wishlist_item_id = p_item_id)
    AND (p_include_closed OR f.status IN ('new', 'acknowledged', 'accepted'))
  ORDER BY (f.status = 'new') DESC, f.created_at DESC;
END;
$$;

-- ---------------------------------------------------------------------------
-- 11) Move / leave: withdraw open offers in an org the user has left (7.9).
--     Replaces the P1 trigger functions (latest bodies: 20261031060000) and only
--     adds the withdraw call. Triggers themselves are unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.withdraw_wishlist_offers_outside_org(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE public.equipment_wishlist_offers f
  SET status = 'withdrawn', handled_at = now(), handled_note = 'moved neighbourhood'
  WHERE f.user_id = p_user_id
    AND f.status IN ('new', 'acknowledged', 'accepted')
    AND NOT public.user_in_org(p_user_id, f.organization_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_users_capability_auto_revoke()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
    PERFORM public.revoke_capabilities_outside_org(NEW.id, 'moved neighbourhood');
    PERFORM public.withdraw_wishlist_offers_outside_org(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_org_members_capability_auto_revoke()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.revoke_capabilities_outside_org(OLD.user_id, 'moved neighbourhood');
    PERFORM public.withdraw_wishlist_offers_outside_org(OLD.user_id);
    RETURN OLD;
  END IF;
  IF OLD.status = 'active' AND NEW.status IS DISTINCT FROM 'active' THEN
    PERFORM public.revoke_capabilities_outside_org(NEW.user_id, 'moved neighbourhood');
    PERFORM public.withdraw_wishlist_offers_outside_org(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 12) Grants (4.5 convention)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.can_manage_wishlist(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_wishlist(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.upsert_wishlist_item(uuid, text, text, text, integer, bigint, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_wishlist_item(uuid, text, text, text, integer, bigint, text, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_wishlist_item_status(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_wishlist_item_status(uuid, text, integer, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_wishlist_offer(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_wishlist_offer(uuid, text, integer, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.withdraw_wishlist_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_wishlist_offer(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.respond_wishlist_offer(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_wishlist_offer(uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_wishlist_items(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_wishlist_items(text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_wishlist_offers(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_wishlist_offers(uuid, boolean) TO authenticated, service_role;

-- Internal only.
REVOKE ALL ON FUNCTION public.wishlist_manager_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wishlist_manager_ids(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.withdraw_wishlist_offers_outside_org(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_wishlist_offers_outside_org(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.trg_users_capability_auto_revoke() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_users_capability_auto_revoke() TO service_role;
REVOKE ALL ON FUNCTION public.trg_org_members_capability_auto_revoke() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_org_members_capability_auto_revoke() TO service_role;

-- Verification (read-only):
--   SELECT count(*) FROM public.equipment_wishlist_items;   -- 0 right after applying
--   SELECT proname FROM pg_proc WHERE proname LIKE '%wishlist%' ORDER BY 1;