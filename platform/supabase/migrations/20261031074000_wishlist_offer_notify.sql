-- P2.5: alert managers about new Needs offers like new incidents.
-- Root cause fixed here: create_wishlist_offer only notified wishlist_manager_ids
-- (org nw_admins + equipment custodians). Global admins / technical support who
-- run the org's admin panel (and can manage Needs) got no in-app row, and no
-- push was ever sent. Additive: 070000..073000 are applied and not edited.

-- 1) One push per offer (claimed by the notify-resident-event edge function).
ALTER TABLE public.equipment_wishlist_offers
  ADD COLUMN IF NOT EXISTS push_notified_at timestamptz;

-- 2) Recipients: wishlist managers + global staff who belong to the org.
CREATE OR REPLACE FUNCTION public.wishlist_offer_notify_ids(p_org_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT x FROM public.wishlist_manager_ids(p_org_id) x
  UNION
  SELECT u.id FROM public.users u
  WHERE lower(trim(u.role::text)) IN ('admin', 'technical_support')
    AND public.user_in_org(u.id, p_org_id);
$$;

REVOKE ALL ON FUNCTION public.wishlist_offer_notify_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wishlist_offer_notify_ids(uuid) TO service_role;

-- 3) 'R 1 000' style rands (whole rands; cents dropped).
CREATE OR REPLACE FUNCTION public.format_rands(p_cents bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT 'R ' || replace(to_char(coalesce(p_cents, 0) / 100, 'FM999,999,999,990'), ',', ' ');
$$;

REVOKE ALL ON FUNCTION public.format_rands(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.format_rands(bigint) TO authenticated, service_role;

-- 4) create_wishlist_offer: latest body (20261031073000), new recipients + titles.
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
  -- Same people who can open /admin/needs for this org (NW admins, custodians,
  -- and global admins / tech support who belong to the org). notify_app_user
  -- applies the G6 in-app preference ('wishlist' is mutable).
  FOR m IN SELECT x FROM public.wishlist_offer_notify_ids(it.organization_id) x WHERE x <> uid LOOP
    PERFORM public.notify_app_user(m, 'wishlist',
      CASE WHEN v_kind = 'contribute_cost' AND p_pledge_cents IS NOT NULL
        THEN left('New pledge: ' || public.format_rands(p_pledge_cents) || ' towards ' || it.title, 160)
        WHEN v_kind = 'contribute_cost' THEN left('New cost contribution offer: ' || it.title, 160)
        ELSE left('New offer to help: ' || it.title, 160) END,
      coalesce(who, 'A neighbour') || CASE WHEN v_kind = 'contribute_cost' THEN ' offered to contribute towards the cost of: ' ELSE ' offered to help with: ' END || it.title,
      '/admin/needs?tab=offers');
  END LOOP;
  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_wishlist_offer(uuid, text, integer, text, boolean, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_wishlist_offer(uuid, text, integer, text, boolean, bigint) TO authenticated, service_role;
