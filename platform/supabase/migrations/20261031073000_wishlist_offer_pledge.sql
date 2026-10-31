-- P2.4: optional pledge on a 'contribute_cost' offer (whole rands, R1..R1,000,000).
-- Visible only to the offerer (own-offer RLS) and managers (list_wishlist_offers).
-- NOT counted in covered / ledger totals: only manager-recorded ledger entries count.
-- Additive: 20261031070000 / 072000 are applied on live and are not edited.

ALTER TABLE public.equipment_wishlist_offers
  ADD COLUMN IF NOT EXISTS pledged_amount_cents bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_wishlist_offers_pledge_ok'
                 AND conrelid = 'public.equipment_wishlist_offers'::regclass) THEN
    ALTER TABLE public.equipment_wishlist_offers
      ADD CONSTRAINT equipment_wishlist_offers_pledge_ok CHECK (
        pledged_amount_cents IS NULL
        OR (kind = 'contribute_cost'
            AND pledged_amount_cents BETWEEN 100 AND 100000000
            AND pledged_amount_cents % 100 = 0)
      );
  END IF;
END;
$$;

-- create_wishlist_offer: latest body (20261031072000) + p_pledge_cents.
-- Drop the 5-arg version so PostgREST never sees two overloads.
DROP FUNCTION IF EXISTS public.create_wishlist_offer(uuid, text, integer, text, boolean);
CREATE OR REPLACE FUNCTION public.create_wishlist_offer(
  p_item_id uuid,
  p_kind text DEFAULT 'contribute_item',
  p_quantity integer DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_show_name boolean DEFAULT false,
  p_pledge_cents bigint DEFAULT NULL
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
  v_qty integer := p_quantity;
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
  IF v_kind NOT IN ('contribute_item', 'source_at_cost', 'lend_item', 'other_help', 'contribute_cost') THEN
    RAISE EXCEPTION 'unknown offer type';
  END IF;
  -- A cost contribution is money arranged privately, never an item quantity.
  IF v_kind = 'contribute_cost' THEN
    v_qty := NULL;
  END IF;
  IF v_qty IS NOT NULL AND (v_qty < 1 OR v_qty > 500) THEN
    RAISE EXCEPTION 'quantity must be 1 to 500';
  END IF;
  -- Optional pledge (whole rands, R1..R1,000,000), only on a cost contribution.
  -- Never counted anywhere until a manager records the money on the ledger.
  IF p_pledge_cents IS NOT NULL THEN
    IF v_kind <> 'contribute_cost' THEN
      RAISE EXCEPTION 'a pledge is only allowed on a cost contribution';
    END IF;
    IF p_pledge_cents < 100 OR p_pledge_cents > 100000000 OR p_pledge_cents % 100 <> 0 THEN
      RAISE EXCEPTION 'pledge must be whole rands from R1 to R1,000,000';
    END IF;
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

  INSERT INTO public.equipment_wishlist_offers (organization_id, wishlist_item_id, user_id, kind, quantity, note, show_name_publicly, pledged_amount_cents)
  VALUES (it.organization_id, p_item_id, uid, v_kind, v_qty, v_note, coalesce(p_show_name, false) AND v_kind = 'contribute_cost', p_pledge_cents)
  RETURNING id INTO new_id;

  SELECT coalesce(nullif(trim(full_name), ''), 'A neighbour') INTO who FROM public.users WHERE id = uid;
  FOR m IN SELECT x FROM public.wishlist_manager_ids(it.organization_id) x WHERE x <> uid LOOP
    PERFORM public.notify_app_user(m, 'wishlist', 'New offer to help',
      coalesce(who, 'A neighbour') || CASE WHEN v_kind = 'contribute_cost' THEN ' offered to contribute towards the cost of: ' ELSE ' offered to help with: ' END || it.title, '/admin/needs');
  END LOOP;
  RETURN new_id;
END;
$$;

-- list_wishlist_offers (managers only): latest body (20261031070000) + pledged_amount_cents.
-- Return type changes, so drop first.
DROP FUNCTION IF EXISTS public.list_wishlist_offers(uuid, boolean);
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
  created_at timestamptz,
  pledged_amount_cents bigint
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
         f.kind, f.quantity, f.note, f.status, hb.full_name, f.handled_at, f.handled_note, f.created_at,
         f.pledged_amount_cents
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

REVOKE ALL ON FUNCTION public.create_wishlist_offer(uuid, text, integer, text, boolean, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_wishlist_offer(uuid, text, integer, text, boolean, bigint) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_wishlist_offers(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_wishlist_offers(uuid, boolean) TO authenticated, service_role;
