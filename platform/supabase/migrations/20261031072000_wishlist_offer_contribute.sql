-- P2.2: 5th offer type 'contribute_cost' (resident offers money; the committee
-- arranges and collects it privately OUTSIDE the app). No amount, no payment details:
-- the existing note screen (9+ digits / payment wording) still applies.
-- Additive: 20261031070000 is applied on live and is not edited.
-- A cost contribution never carries a quantity, so it can't be read as items.

-- 1) Offer kind CHECK: drop whatever kind check exists, re-add with the new value.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
    WHERE con.conrelid = 'public.equipment_wishlist_offers'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.equipment_wishlist_offers DROP CONSTRAINT %I', c.conname);
  END LOOP;
END;
$$;

ALTER TABLE public.equipment_wishlist_offers
  ADD CONSTRAINT equipment_wishlist_offers_kind_check
  CHECK (kind IN ('contribute_item', 'source_at_cost', 'lend_item', 'other_help', 'contribute_cost'));

ALTER TABLE public.equipment_wishlist_offers
  ADD CONSTRAINT equipment_wishlist_offers_cost_no_qty
  CHECK (kind <> 'contribute_cost' OR quantity IS NULL);

-- 1b) Contributor's choice at offer time: show my name on the ledger (default anonymous).
ALTER TABLE public.equipment_wishlist_offers
  ADD COLUMN IF NOT EXISTS show_name_publicly boolean NOT NULL DEFAULT false;

-- 2) create_wishlist_offer: latest body (20261031070000) + contribute_cost + p_show_name.
--    Signature changes (5th arg), so drop the 4-arg version to avoid an ambiguous overload.
DROP FUNCTION IF EXISTS public.create_wishlist_offer(uuid, text, integer, text);
CREATE OR REPLACE FUNCTION public.create_wishlist_offer(
  p_item_id uuid,
  p_kind text DEFAULT 'contribute_item',
  p_quantity integer DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_show_name boolean DEFAULT false
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

  INSERT INTO public.equipment_wishlist_offers (organization_id, wishlist_item_id, user_id, kind, quantity, note, show_name_publicly)
  VALUES (it.organization_id, p_item_id, uid, v_kind, v_qty, v_note, coalesce(p_show_name, false) AND v_kind = 'contribute_cost')
  RETURNING id INTO new_id;

  SELECT coalesce(nullif(trim(full_name), ''), 'A neighbour') INTO who FROM public.users WHERE id = uid;
  FOR m IN SELECT x FROM public.wishlist_manager_ids(it.organization_id) x WHERE x <> uid LOOP
    PERFORM public.notify_app_user(m, 'wishlist', 'New offer to help',
      coalesce(who, 'A neighbour') || CASE WHEN v_kind = 'contribute_cost' THEN ' offered to contribute towards the cost of: ' ELSE ' offered to help with: ' END || it.title, '/admin/needs');
  END LOOP;
  RETURN new_id;
END;
$$;

-- 3) list_org_contribution_contacts: names (only) of the active NW admins of the
--    item's org, so a resident can be told whom to contact about a cost
--    contribution. No phone numbers or emails. Cross-org -> 'item not found'.
CREATE OR REPLACE FUNCTION public.list_org_contribution_contacts(p_item_id uuid)
RETURNS TABLE (full_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it public.equipment_wishlist_items;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO it FROM public.equipment_wishlist_items i WHERE i.id = p_item_id;
  IF NOT FOUND OR it.organization_id NOT IN (SELECT public.current_org_ids())
     OR (it.status = 'cancelled' AND NOT public.can_manage_wishlist(it.organization_id)) THEN
    RAISE EXCEPTION 'item not found';
  END IF;
  RETURN QUERY
  SELECT DISTINCT trim(u.full_name)
  FROM public.users u
  WHERE replace(lower(trim(u.role::text)), '-', '_') = 'nw_admin'
    AND nullif(trim(u.full_name), '') IS NOT NULL
    AND (
      u.organization_id = it.organization_id
      OR EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.user_id = u.id AND om.organization_id = it.organization_id
          AND om.status = 'active' AND om.member_role = 'nw_admin'
      )
    )
  ORDER BY 1;
END;
$$;

REVOKE ALL ON FUNCTION public.list_org_contribution_contacts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_org_contribution_contacts(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_wishlist_offer(uuid, text, integer, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_wishlist_offer(uuid, text, integer, text, boolean) TO authenticated, service_role;

-- ===========================================================================
-- P2.3: transparent contributions ledger (append-only).
-- Money is still never collected in the app. Managers RECORD what the committee
-- received or spent outside the app so every member can see where it went.
-- ===========================================================================

-- 5) Ledger table. No FK actions that would UPDATE/DELETE rows (append-only):
--    contributor_user_id / recorded_by are plain uuids; items/orgs are RESTRICT.
CREATE TABLE IF NOT EXISTS public.wishlist_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES public.equipment_wishlist_items (id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('contribution_received', 'purchase', 'correction')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000),
  entry_date date NOT NULL DEFAULT current_date,
  contributor_user_id uuid,
  contributor_display text NOT NULL DEFAULT 'anonymous' CHECK (contributor_display IN ('anonymous', 'name')),
  offer_id uuid,
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  receipt_path text CHECK (receipt_path IS NULL OR (char_length(receipt_path) <= 300 AND position('..' IN receipt_path) = 0)),
  corrects_entry_id uuid REFERENCES public.wishlist_ledger_entries (id) ON DELETE RESTRICT,
  recorded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wishlist_ledger_correction_shape CHECK (
    (kind = 'correction' AND corrects_entry_id IS NOT NULL AND nullif(trim(coalesce(note, '')), '') IS NOT NULL)
    OR (kind <> 'correction' AND corrects_entry_id IS NULL)
  ),
  CONSTRAINT wishlist_ledger_contributor_only_on_contribution CHECK (
    kind = 'contribution_received' OR (contributor_user_id IS NULL AND contributor_display = 'anonymous')
  ),
  CONSTRAINT wishlist_ledger_receipt_only_on_purchase CHECK (kind = 'purchase' OR receipt_path IS NULL)
);
CREATE INDEX IF NOT EXISTS wishlist_ledger_item_idx ON public.wishlist_ledger_entries (item_id, created_at);
CREATE INDEX IF NOT EXISTS wishlist_ledger_org_idx ON public.wishlist_ledger_entries (organization_id, item_id);

-- Read only through list_wishlist_ledger (hides contributor ids). Writes only via RPCs.
ALTER TABLE public.wishlist_ledger_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wishlist_ledger_entries FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.wishlist_ledger_entries TO service_role;

-- Append-only, for everyone (including the table owner): block UPDATE / DELETE / TRUNCATE.
CREATE OR REPLACE FUNCTION public.trg_wishlist_ledger_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'wishlist ledger is append-only; record a correction instead';
END;
$$;

DROP TRIGGER IF EXISTS trg_wishlist_ledger_no_update_delete ON public.wishlist_ledger_entries;
CREATE TRIGGER trg_wishlist_ledger_no_update_delete
  BEFORE UPDATE OR DELETE ON public.wishlist_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.trg_wishlist_ledger_append_only();
DROP TRIGGER IF EXISTS trg_wishlist_ledger_no_truncate ON public.wishlist_ledger_entries;
CREATE TRIGGER trg_wishlist_ledger_no_truncate
  BEFORE TRUNCATE ON public.wishlist_ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_wishlist_ledger_append_only();

-- 6) Shared guard: manager of the item's org (cross-org -> 'item not found').
CREATE OR REPLACE FUNCTION public.wishlist_ledger_item_for_manager(p_item_id uuid)
RETURNS public.equipment_wishlist_items
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it public.equipment_wishlist_items;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO it FROM public.equipment_wishlist_items i WHERE i.id = p_item_id;
  IF NOT FOUND OR it.organization_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'item not found';
  END IF;
  IF NOT public.can_manage_wishlist(it.organization_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN it;
END;
$$;

-- 7) record_wishlist_contribution (manager). Optional link to a contribute_cost
--    offer: the contributor and their show-my-name choice come from the offer.
CREATE OR REPLACE FUNCTION public.record_wishlist_contribution(
  p_item_id uuid,
  p_amount_cents bigint,
  p_entry_date date DEFAULT NULL,
  p_offer_id uuid DEFAULT NULL,
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
  o public.equipment_wishlist_offers;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_user uuid;
  v_display text := 'anonymous';
  new_id uuid;
BEGIN
  it := public.wishlist_ledger_item_for_manager(p_item_id);
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_amount_cents > 100000000 THEN
    RAISE EXCEPTION 'amount must be more than 0';
  END IF;
  IF p_entry_date IS NOT NULL AND p_entry_date > current_date THEN
    RAISE EXCEPTION 'date cannot be in the future';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'note is too long';
  END IF;
  IF p_offer_id IS NOT NULL THEN
    SELECT * INTO o FROM public.equipment_wishlist_offers f WHERE f.id = p_offer_id;
    IF NOT FOUND OR o.wishlist_item_id <> it.id OR o.kind <> 'contribute_cost' THEN
      RAISE EXCEPTION 'offer not found';
    END IF;
    v_user := o.user_id;
    v_display := CASE WHEN o.show_name_publicly AND o.user_id IS NOT NULL THEN 'name' ELSE 'anonymous' END;
  END IF;

  INSERT INTO public.wishlist_ledger_entries
    (organization_id, item_id, kind, amount_cents, entry_date, contributor_user_id, contributor_display, offer_id, note, recorded_by)
  VALUES
    (it.organization_id, it.id, 'contribution_received', p_amount_cents, coalesce(p_entry_date, current_date),
     v_user, v_display, p_offer_id, v_note, uid)
  RETURNING id INTO new_id;

  PERFORM public.write_staff_activity(
    'wishlist_ledger_contribution',
    jsonb_build_object('entry_id', new_id, 'item_id', it.id, 'amount_cents', p_amount_cents,
                       'offer_id', p_offer_id, 'display', v_display),
    uid, it.organization_id);
  RETURN new_id;
END;
$$;

-- 8) record_wishlist_purchase (manager; receipt optional, under {org}/needs/{item}/receipts/).
CREATE OR REPLACE FUNCTION public.record_wishlist_purchase(
  p_item_id uuid,
  p_amount_cents bigint,
  p_entry_date date DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_receipt_path text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  it public.equipment_wishlist_items;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_receipt text := nullif(trim(coalesce(p_receipt_path, '')), '');
  new_id uuid;
BEGIN
  it := public.wishlist_ledger_item_for_manager(p_item_id);
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_amount_cents > 100000000 THEN
    RAISE EXCEPTION 'amount must be more than 0';
  END IF;
  IF p_entry_date IS NOT NULL AND p_entry_date > current_date THEN
    RAISE EXCEPTION 'date cannot be in the future';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'note is too long';
  END IF;
  IF v_receipt IS NOT NULL AND (
       left(v_receipt, char_length(it.organization_id::text || '/needs/' || it.id::text || '/receipts/'))
         <> it.organization_id::text || '/needs/' || it.id::text || '/receipts/'
       OR position('..' IN v_receipt) > 0
       OR char_length(v_receipt) > 300
     ) THEN
    RAISE EXCEPTION 'invalid receipt path';
  END IF;

  INSERT INTO public.wishlist_ledger_entries
    (organization_id, item_id, kind, amount_cents, entry_date, note, receipt_path, recorded_by)
  VALUES
    (it.organization_id, it.id, 'purchase', p_amount_cents, coalesce(p_entry_date, current_date), v_note, v_receipt, uid)
  RETURNING id INTO new_id;

  PERFORM public.write_staff_activity(
    'wishlist_ledger_purchase',
    jsonb_build_object('entry_id', new_id, 'item_id', it.id, 'amount_cents', p_amount_cents,
                       'has_receipt', v_receipt IS NOT NULL),
    uid, it.organization_id);
  RETURN new_id;
END;
$$;

-- 9) record_wishlist_correction (manager). Reverses part or all of one entry;
--    a reason is required and the total reversed can't exceed the original.
CREATE OR REPLACE FUNCTION public.record_wishlist_correction(
  p_entry_id uuid,
  p_amount_cents bigint,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  e public.wishlist_ledger_entries;
  it public.equipment_wishlist_items;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_left bigint;
  new_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO e FROM public.wishlist_ledger_entries l WHERE l.id = p_entry_id;
  IF NOT FOUND OR e.organization_id NOT IN (SELECT public.current_org_ids()) THEN
    RAISE EXCEPTION 'entry not found';
  END IF;
  it := public.wishlist_ledger_item_for_manager(e.item_id);
  IF e.kind = 'correction' THEN
    RAISE EXCEPTION 'cannot correct a correction';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'a reason is required';
  END IF;
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'note is too long';
  END IF;
  -- Serialise corrections of the same entry.
  PERFORM pg_advisory_xact_lock(hashtext('wishlist_ledger:' || e.id::text));
  SELECT e.amount_cents - coalesce(sum(c.amount_cents), 0) INTO v_left
  FROM public.wishlist_ledger_entries c
  WHERE c.corrects_entry_id = e.id;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'amount must be more than 0';
  END IF;
  IF p_amount_cents > v_left THEN
    RAISE EXCEPTION 'correction exceeds the remaining amount (% cents)', v_left;
  END IF;

  INSERT INTO public.wishlist_ledger_entries
    (organization_id, item_id, kind, amount_cents, note, corrects_entry_id, recorded_by)
  VALUES
    (e.organization_id, e.item_id, 'correction', p_amount_cents, v_reason, e.id, uid)
  RETURNING id INTO new_id;

  PERFORM public.write_staff_activity(
    'wishlist_ledger_correction',
    jsonb_build_object('entry_id', new_id, 'corrects_entry_id', e.id, 'corrects_kind', e.kind,
                       'item_id', e.item_id, 'amount_cents', p_amount_cents),
    uid, e.organization_id);
  RETURN new_id;
END;
$$;

-- 10) list_wishlist_ledger: every member of the item's org (cross-org -> not found).
--     Contributor shows as 'Anonymous' unless they chose to show their name.
CREATE OR REPLACE FUNCTION public.list_wishlist_ledger(p_item_id uuid)
RETURNS TABLE (
  id uuid,
  kind text,
  amount_cents bigint,
  entry_date date,
  contributor_name text,
  recorded_by_name text,
  note text,
  receipt_path text,
  corrects_entry_id uuid,
  corrects_kind text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it public.equipment_wishlist_items;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO it FROM public.equipment_wishlist_items i WHERE i.id = p_item_id;
  IF NOT FOUND OR it.organization_id NOT IN (SELECT public.current_org_ids())
     OR (it.status = 'cancelled' AND NOT public.can_manage_wishlist(it.organization_id)) THEN
    RAISE EXCEPTION 'item not found';
  END IF;
  RETURN QUERY
  SELECT l.id, l.kind, l.amount_cents, l.entry_date,
         CASE
           WHEN l.kind <> 'contribution_received' THEN NULL
           WHEN l.contributor_display = 'name' THEN coalesce(nullif(trim(cu.full_name), ''), 'Anonymous')
           ELSE 'Anonymous'
         END,
         coalesce(nullif(trim(ru.full_name), ''), 'Former member'),
         l.note, l.receipt_path, l.corrects_entry_id, c.kind, l.created_at
  FROM public.wishlist_ledger_entries l
  LEFT JOIN public.users cu ON cu.id = l.contributor_user_id
  LEFT JOIN public.users ru ON ru.id = l.recorded_by
  LEFT JOIN public.wishlist_ledger_entries c ON c.id = l.corrects_entry_id
  WHERE l.item_id = it.id
  ORDER BY l.entry_date DESC, l.created_at DESC;
END;
$$;

-- 11) list_wishlist_ledger_totals: per-item totals for the caller's orgs.
--     received = contributions - corrections of contributions (clamped >= 0)
--     spent    = purchases - corrections of purchases (clamped >= 0)
--     covered  = received; balance = received - spent.
CREATE OR REPLACE FUNCTION public.list_wishlist_ledger_totals()
RETURNS TABLE (item_id uuid, received_cents bigint, spent_cents bigint, covered_cents bigint, balance_cents bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT l.item_id,
           sum(CASE WHEN l.kind = 'contribution_received' THEN l.amount_cents
                    WHEN l.kind = 'correction' AND c.kind = 'contribution_received' THEN -l.amount_cents
                    ELSE 0 END)::bigint AS rec,
           sum(CASE WHEN l.kind = 'purchase' THEN l.amount_cents
                    WHEN l.kind = 'correction' AND c.kind = 'purchase' THEN -l.amount_cents
                    ELSE 0 END)::bigint AS spe
    FROM public.wishlist_ledger_entries l
    JOIN public.equipment_wishlist_items i ON i.id = l.item_id
    LEFT JOIN public.wishlist_ledger_entries c ON c.id = l.corrects_entry_id
    WHERE auth.uid() IS NOT NULL
      AND l.organization_id IN (SELECT public.current_org_ids())
      AND (i.status <> 'cancelled' OR public.can_manage_wishlist(i.organization_id))
    GROUP BY l.item_id
  )
  SELECT t.item_id, greatest(t.rec, 0), greatest(t.spe, 0), greatest(t.rec, 0),
         greatest(t.rec, 0) - greatest(t.spe, 0)
  FROM t;
$$;

REVOKE ALL ON FUNCTION public.trg_wishlist_ledger_append_only() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_wishlist_ledger_append_only() TO service_role;
REVOKE ALL ON FUNCTION public.wishlist_ledger_item_for_manager(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wishlist_ledger_item_for_manager(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.record_wishlist_contribution(uuid, bigint, date, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_wishlist_contribution(uuid, bigint, date, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_wishlist_purchase(uuid, bigint, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_wishlist_purchase(uuid, bigint, date, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_wishlist_correction(uuid, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_wishlist_correction(uuid, bigint, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_wishlist_ledger(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_wishlist_ledger(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_wishlist_ledger_totals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_wishlist_ledger_totals() TO authenticated, service_role;
