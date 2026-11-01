-- =============================================================================
-- P3a (part 1) - Equipment catalogue: categories, items, units, certifications,
-- append-only hash-chained ledger, QR resolve, member read RPCs.
-- Additive only. Org-scoped. Cross-org access always reports "not found".
--
-- Who can do what (part 1):
--   * Members (patrol roles in the org, plus global/platform staff) browse the
--     catalogue through list_/get_ RPCs. Restricted unit columns (price, serial,
--     qr_token, supplier, invoice, funding) are never granted to authenticated.
--   * can_manage_equipment = NW admin of the org, or global/platform staff.
--     The equipment_custodian capability is deliberately NOT used yet.
--   * equipment_certifications ships as a table only. Nothing checks it.
--   * Status changes go through equipment_set_unit_status (service_role only in
--     part 1; P3b check-out/return RPCs will call it).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_patrol_role(p_role text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT coalesce(replace(lower(trim(p_role)), '-', '_') IN (
    'volunteer', 'patroller', 'investigator', 'committee', 'nw_admin', 'admin', 'technical_support'
  ), false);
$fn$;

-- Caller may browse equipment in p_org: global/platform staff, or the org is one
-- of theirs AND they hold a patrol role (global role or active org membership role).
CREATE OR REPLACE FUNCTION public.is_equipment_member(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT auth.uid() IS NOT NULL AND p_org IS NOT NULL AND (
    public.is_global_app_staff()
    OR public.is_platform_staff()
    OR (
      p_org IN (SELECT public.current_org_ids())
      AND (
        EXISTS (SELECT 1 FROM public.users u
                WHERE u.id = auth.uid() AND public.is_patrol_role(u.role::text))
        OR EXISTS (SELECT 1 FROM public.organization_members om
                   WHERE om.user_id = auth.uid() AND om.organization_id = p_org
                     AND om.status = 'active' AND public.is_patrol_role(om.member_role::text))
      )
    )
  );
$fn$;

CREATE OR REPLACE FUNCTION public.can_manage_equipment(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT auth.uid() IS NOT NULL AND p_org IS NOT NULL AND (
    public.is_global_app_staff()
    OR public.is_platform_staff()
    OR (p_org IN (SELECT public.current_org_ids()) AND public.is_org_nw_admin(p_org))
  );
$fn$;

-- "Thabo M." style name for member-facing holder display.
CREATE OR REPLACE FUNCTION public.equipment_display_name(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN p_user IS NULL THEN NULL
    ELSE (
      SELECT CASE
        WHEN nullif(trim(u.full_name), '') IS NULL THEN 'Member'
        WHEN position(' ' IN trim(u.full_name)) = 0 THEN trim(u.full_name)
        ELSE split_part(trim(u.full_name), ' ', 1) || ' '
             || upper(left(trim(regexp_replace(trim(u.full_name), '^\S+\s+', '')), 1)) || '.'
      END
      FROM public.users u WHERE u.id = p_user
    )
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.equipment_new_qr_token()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $fn$
  SELECT translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_');
$fn$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.equipment_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 60),
  sort_order int NOT NULL DEFAULT 100,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS public.equipment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.equipment_categories(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 2000),
  photo_path text,
  requires_certification boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  wishlist_item_id uuid REFERENCES public.equipment_wishlist_items(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS equipment_items_org_idx ON public.equipment_items (organization_id, is_archived);

CREATE TABLE IF NOT EXISTS public.equipment_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.equipment_items(id) ON DELETE RESTRICT,
  asset_tag text NOT NULL CHECK (asset_tag ~ '^[A-Z0-9][A-Z0-9-]{1,23}$'),
  status text NOT NULL DEFAULT 'available' CHECK (status IN (
    'available', 'reserved', 'checked_out', 'in_transfer', 'overdue',
    'under_repair', 'damaged', 'lost', 'stolen', 'retired')),
  condition text NOT NULL DEFAULT 'good' CHECK (condition IN ('new', 'good', 'fair', 'poor')),
  current_holder_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  location_note text CHECK (location_note IS NULL OR char_length(location_note) <= 200),
  photo_path text,
  -- Restricted (managers only; never granted to authenticated):
  serial_number text CHECK (serial_number IS NULL OR char_length(serial_number) <= 80),
  purchase_price_cents bigint CHECK (purchase_price_cents IS NULL OR purchase_price_cents >= 0),
  purchase_date date,
  supplier text CHECK (supplier IS NULL OR char_length(supplier) <= 120),
  invoice_path text,
  funding_source text CHECK (funding_source IS NULL OR funding_source IN (
    'donation', 'fundraiser', 'committee_funds', 'sponsor', 'grant', 'loan', 'other')),
  qr_token text NOT NULL DEFAULT public.equipment_new_qr_token(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, asset_tag),
  UNIQUE (qr_token)
);
CREATE INDEX IF NOT EXISTS equipment_units_item_idx ON public.equipment_units (item_id);
CREATE INDEX IF NOT EXISTS equipment_units_org_status_idx ON public.equipment_units (organization_id, status);

-- Ships for P3b/part 2. Nothing gates on it yet.
CREATE TABLE IF NOT EXISTS public.equipment_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.equipment_items(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  UNIQUE (organization_id, user_id, item_id)
);

-- Append-only ledger. One hash chain per organization.
CREATE TABLE IF NOT EXISTS public.equipment_ledger (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  unit_id uuid REFERENCES public.equipment_units(id) ON DELETE RESTRICT,
  item_id uuid REFERENCES public.equipment_items(id) ON DELETE RESTRICT,
  event text NOT NULL CHECK (event IN (
    'item_created', 'item_updated', 'unit_added', 'unit_updated', 'qr_rotated',
    'status_changed', 'certification_granted', 'certification_revoked')),
  from_status text,
  to_status text,
  actor_id uuid,
  holder_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  prev_hash text,
  hash text NOT NULL
);
CREATE INDEX IF NOT EXISTS equipment_ledger_unit_idx ON public.equipment_ledger (unit_id, id);
CREATE INDEX IF NOT EXISTS equipment_ledger_org_idx ON public.equipment_ledger (organization_id, id);

-- -----------------------------------------------------------------------------
-- Ledger immutability (fires for every role, including service_role)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_equipment_ledger_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  RAISE EXCEPTION 'equipment ledger is append-only' USING ERRCODE = '42501';
END;
$fn$;

DROP TRIGGER IF EXISTS equipment_ledger_no_update ON public.equipment_ledger;
CREATE TRIGGER equipment_ledger_no_update
  BEFORE UPDATE OR DELETE ON public.equipment_ledger
  FOR EACH ROW EXECUTE FUNCTION public.trg_equipment_ledger_append_only();
DROP TRIGGER IF EXISTS equipment_ledger_no_truncate ON public.equipment_ledger;
CREATE TRIGGER equipment_ledger_no_truncate
  BEFORE TRUNCATE ON public.equipment_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_equipment_ledger_append_only();

-- Hash is computed here, so even a direct INSERT cannot forge the chain.
CREATE OR REPLACE FUNCTION public.trg_equipment_ledger_hash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('equipment_ledger:' || NEW.organization_id::text, 0));
  SELECT l.hash INTO NEW.prev_hash
  FROM public.equipment_ledger l
  WHERE l.organization_id = NEW.organization_id
  ORDER BY l.id DESC LIMIT 1;
  NEW.occurred_at := clock_timestamp();
  NEW.hash := encode(extensions.digest(concat_ws('|',
    coalesce(NEW.prev_hash, 'genesis'), NEW.organization_id::text,
    coalesce(NEW.unit_id::text, ''), coalesce(NEW.item_id::text, ''), NEW.event,
    coalesce(NEW.from_status, ''), coalesce(NEW.to_status, ''),
    coalesce(NEW.actor_id::text, ''), coalesce(NEW.holder_id::text, ''),
    NEW.payload::text, to_char(NEW.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
  ), 'sha256'), 'hex');
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS equipment_ledger_hash ON public.equipment_ledger;
CREATE TRIGGER equipment_ledger_hash
  BEFORE INSERT ON public.equipment_ledger
  FOR EACH ROW EXECUTE FUNCTION public.trg_equipment_ledger_hash();

CREATE OR REPLACE FUNCTION public.equipment_ledger_append(
  p_org uuid, p_event text, p_unit uuid DEFAULT NULL, p_item uuid DEFAULT NULL,
  p_from text DEFAULT NULL, p_to text DEFAULT NULL, p_holder uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.equipment_ledger
    (organization_id, unit_id, item_id, event, from_status, to_status, actor_id, holder_id, payload)
  VALUES (p_org, p_unit, p_item, p_event, p_from, p_to, auth.uid(), p_holder, coalesce(p_payload, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

-- Recompute an org's chain. Returns the first broken ledger id, or NULL if intact.
CREATE OR REPLACE FUNCTION public.verify_equipment_ledger(p_org uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r record;
  v_prev text := NULL;
  v_calc text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_manage_equipment(p_org) THEN
    RAISE EXCEPTION 'not found';
  END IF;
  FOR r IN SELECT * FROM public.equipment_ledger WHERE organization_id = p_org ORDER BY id LOOP
    v_calc := encode(extensions.digest(concat_ws('|',
      coalesce(v_prev, 'genesis'), r.organization_id::text,
      coalesce(r.unit_id::text, ''), coalesce(r.item_id::text, ''), r.event,
      coalesce(r.from_status, ''), coalesce(r.to_status, ''),
      coalesce(r.actor_id::text, ''), coalesce(r.holder_id::text, ''),
      r.payload::text, to_char(r.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
    ), 'sha256'), 'hex');
    IF r.prev_hash IS DISTINCT FROM v_prev OR r.hash <> v_calc THEN
      RETURN r.id;
    END IF;
    v_prev := r.hash;
  END LOOP;
  RETURN NULL;
END;
$fn$;

-- -----------------------------------------------------------------------------
-- Unit guard: status/holder/org only change via equipment_set_unit_status.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_equipment_units_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'available' OR NEW.current_holder_id IS NOT NULL THEN
      RAISE EXCEPTION 'new units start available with no holder';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.equipment_items i
                   WHERE i.id = NEW.item_id AND i.organization_id = NEW.organization_id) THEN
      RAISE EXCEPTION 'item not found';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.organization_id <> OLD.organization_id OR NEW.item_id <> OLD.item_id THEN
    RAISE EXCEPTION 'unit organization and item cannot change';
  END IF;
  IF (NEW.status IS DISTINCT FROM OLD.status OR NEW.current_holder_id IS DISTINCT FROM OLD.current_holder_id)
     AND coalesce(current_setting('app.equipment_status_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'unit status changes must go through equipment_set_unit_status';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS equipment_units_guard ON public.equipment_units;
CREATE TRIGGER equipment_units_guard
  BEFORE INSERT OR UPDATE ON public.equipment_units
  FOR EACH ROW EXECUTE FUNCTION public.trg_equipment_units_guard();

CREATE OR REPLACE FUNCTION public.equipment_transition_allowed(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT (p_from, p_to) IN (
    ('available', 'reserved'), ('available', 'checked_out'), ('available', 'in_transfer'),
    ('available', 'under_repair'), ('available', 'damaged'), ('available', 'lost'),
    ('available', 'stolen'), ('available', 'retired'),
    ('reserved', 'available'), ('reserved', 'checked_out'),
    ('checked_out', 'available'), ('checked_out', 'in_transfer'), ('checked_out', 'overdue'),
    ('checked_out', 'damaged'), ('checked_out', 'lost'), ('checked_out', 'stolen'),
    ('in_transfer', 'checked_out'), ('in_transfer', 'available'),
    ('overdue', 'available'), ('overdue', 'checked_out'), ('overdue', 'lost'), ('overdue', 'stolen'),
    ('overdue', 'damaged'),
    ('under_repair', 'available'), ('under_repair', 'retired'),
    ('damaged', 'under_repair'), ('damaged', 'available'), ('damaged', 'retired'),
    ('lost', 'available'), ('lost', 'retired'),
    ('stolen', 'available'), ('stolen', 'retired')
  );
$fn$;

-- Internal (service_role only in part 1). P3b RPCs call this after their own checks.
CREATE OR REPLACE FUNCTION public.equipment_set_unit_status(
  p_unit uuid, p_to text, p_holder uuid DEFAULT NULL, p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  u public.equipment_units%ROWTYPE;
BEGIN
  SELECT * INTO u FROM public.equipment_units WHERE id = p_unit FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unit not found'; END IF;
  IF NOT public.equipment_transition_allowed(u.status, p_to) THEN
    RAISE EXCEPTION 'invalid status change % -> %', u.status, p_to;
  END IF;
  PERFORM set_config('app.equipment_status_write', 'on', true);
  UPDATE public.equipment_units
     SET status = p_to,
         current_holder_id = CASE WHEN p_to IN ('checked_out', 'overdue', 'in_transfer', 'reserved') THEN p_holder ELSE NULL END
   WHERE id = p_unit;
  PERFORM set_config('app.equipment_status_write', 'off', true);
  PERFORM public.equipment_ledger_append(u.organization_id, 'status_changed', u.id, u.item_id,
    u.status, p_to, p_holder, jsonb_build_object('reason', left(p_reason, 500)));
END;
$fn$;

-- -----------------------------------------------------------------------------
-- Grants and RLS. Writes only via RPCs.
-- -----------------------------------------------------------------------------
ALTER TABLE public.equipment_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.equipment_categories, public.equipment_items, public.equipment_units,
  public.equipment_certifications, public.equipment_ledger FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.equipment_categories, public.equipment_items, public.equipment_units,
  public.equipment_certifications, public.equipment_ledger TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.equipment_ledger_id_seq TO service_role;

GRANT SELECT ON public.equipment_categories, public.equipment_items TO authenticated;
-- Column grant: price, serial, qr_token, supplier, invoice, funding stay hidden.
GRANT SELECT (id, organization_id, item_id, asset_tag, status, condition, current_holder_id,
  location_note, photo_path, created_at, updated_at) ON public.equipment_units TO authenticated;
GRANT SELECT ON public.equipment_certifications TO authenticated;

DROP POLICY IF EXISTS equipment_categories_select ON public.equipment_categories;
CREATE POLICY equipment_categories_select ON public.equipment_categories
  FOR SELECT TO authenticated USING (public.is_equipment_member(organization_id));

DROP POLICY IF EXISTS equipment_items_select ON public.equipment_items;
CREATE POLICY equipment_items_select ON public.equipment_items
  FOR SELECT TO authenticated USING (public.is_equipment_member(organization_id));

DROP POLICY IF EXISTS equipment_units_select ON public.equipment_units;
CREATE POLICY equipment_units_select ON public.equipment_units
  FOR SELECT TO authenticated USING (public.is_equipment_member(organization_id));

DROP POLICY IF EXISTS equipment_certifications_select ON public.equipment_certifications;
CREATE POLICY equipment_certifications_select ON public.equipment_certifications
  FOR SELECT TO authenticated
  USING (public.can_manage_equipment(organization_id)
         OR (user_id = auth.uid() AND public.is_equipment_member(organization_id)));

-- Ledger: no authenticated grant at all; read through list_equipment_unit_ledger.

-- -----------------------------------------------------------------------------
-- Storage: community-private SELECT for {org_id}/equipment/... (invoices, etc.)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS community_private_equipment_select ON storage.objects;
CREATE POLICY community_private_equipment_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'community-private'
    AND split_part(name, '/', 2) = 'equipment'
    AND public.can_manage_equipment(public.storage_path_org_id(name))
  );

-- -----------------------------------------------------------------------------
-- Manager RPCs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.equipment_require_org()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_org := public.working_organization_id();
  IF v_org IS NULL THEN
    SELECT u.organization_id INTO v_org FROM public.users u WHERE u.id = auth.uid();
  END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'no organization'; END IF;
  RETURN v_org;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ensure_equipment_defaults()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public.equipment_require_org();
  v_n int;
BEGIN
  IF NOT public.can_manage_equipment(v_org) THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.equipment_categories (organization_id, name, sort_order)
  SELECT v_org, t.name, t.ord
  FROM (VALUES ('Optics', 10), ('Radios', 20), ('Lighting', 30), ('Sirens & alarms', 40),
               ('Protective wear', 50), ('First aid', 60), ('Cameras', 70), ('Vehicle kit', 80),
               ('Other', 900)) t(name, ord)
  ON CONFLICT (organization_id, name) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.upsert_equipment_item(
  p_id uuid, p_name text, p_category_id uuid DEFAULT NULL, p_description text DEFAULT NULL,
  p_photo_path text DEFAULT NULL, p_requires_certification boolean DEFAULT false,
  p_is_archived boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_id IS NOT NULL THEN
    SELECT organization_id INTO v_org FROM public.equipment_items WHERE id = p_id;
    IF v_org IS NULL OR NOT public.can_manage_equipment(v_org) THEN RAISE EXCEPTION 'item not found'; END IF;
  ELSE
    v_org := public.equipment_require_org();
    IF NOT public.can_manage_equipment(v_org) THEN RAISE EXCEPTION 'forbidden'; END IF;
  END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.equipment_categories c WHERE c.id = p_category_id AND c.organization_id = v_org) THEN
    RAISE EXCEPTION 'category not found';
  END IF;
  IF p_photo_path IS NOT NULL AND public.storage_path_org_id(p_photo_path) IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'invalid photo path';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.equipment_items (organization_id, category_id, name, description, photo_path,
      requires_certification, is_archived, created_by)
    VALUES (v_org, p_category_id, trim(p_name), nullif(trim(p_description), ''), p_photo_path,
      coalesce(p_requires_certification, false), coalesce(p_is_archived, false), auth.uid())
    RETURNING id INTO v_id;
    PERFORM public.equipment_ledger_append(v_org, 'item_created', NULL, v_id, NULL, NULL, NULL,
      jsonb_build_object('name', trim(p_name)));
  ELSE
    UPDATE public.equipment_items
       SET category_id = p_category_id, name = trim(p_name), description = nullif(trim(p_description), ''),
           photo_path = p_photo_path, requires_certification = coalesce(p_requires_certification, false),
           is_archived = coalesce(p_is_archived, false), updated_at = now()
     WHERE id = p_id RETURNING id INTO v_id;
    PERFORM public.equipment_ledger_append(v_org, 'item_updated', NULL, v_id, NULL, NULL, NULL,
      jsonb_build_object('name', trim(p_name), 'archived', coalesce(p_is_archived, false)));
  END IF;
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.add_equipment_unit(
  p_item_id uuid, p_asset_tag text, p_condition text DEFAULT 'good', p_location_note text DEFAULT NULL,
  p_serial_number text DEFAULT NULL, p_purchase_price_cents bigint DEFAULT NULL,
  p_purchase_date date DEFAULT NULL, p_supplier text DEFAULT NULL, p_invoice_path text DEFAULT NULL,
  p_funding_source text DEFAULT NULL, p_photo_path text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid;
  v_id uuid;
  v_tag text := upper(trim(p_asset_tag));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT organization_id INTO v_org FROM public.equipment_items WHERE id = p_item_id;
  IF v_org IS NULL OR NOT public.can_manage_equipment(v_org) THEN RAISE EXCEPTION 'item not found'; END IF;
  IF p_invoice_path IS NOT NULL AND (public.storage_path_org_id(p_invoice_path) IS DISTINCT FROM v_org
       OR split_part(p_invoice_path, '/', 2) <> 'equipment') THEN
    RAISE EXCEPTION 'invalid invoice path';
  END IF;
  IF p_photo_path IS NOT NULL AND public.storage_path_org_id(p_photo_path) IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'invalid photo path';
  END IF;
  IF EXISTS (SELECT 1 FROM public.equipment_units WHERE organization_id = v_org AND asset_tag = v_tag) THEN
    RAISE EXCEPTION 'asset tag already used';
  END IF;
  INSERT INTO public.equipment_units (organization_id, item_id, asset_tag, condition, location_note,
    serial_number, purchase_price_cents, purchase_date, supplier, invoice_path, funding_source,
    photo_path, created_by)
  VALUES (v_org, p_item_id, v_tag, coalesce(p_condition, 'good'), nullif(trim(p_location_note), ''),
    nullif(trim(p_serial_number), ''), p_purchase_price_cents, p_purchase_date, nullif(trim(p_supplier), ''),
    p_invoice_path, p_funding_source, p_photo_path, auth.uid())
  RETURNING id INTO v_id;
  PERFORM public.equipment_ledger_append(v_org, 'unit_added', v_id, p_item_id, NULL, 'available', NULL,
    jsonb_build_object('asset_tag', v_tag));
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.update_equipment_unit_details(
  p_unit_id uuid, p_condition text, p_location_note text DEFAULT NULL,
  p_serial_number text DEFAULT NULL, p_purchase_price_cents bigint DEFAULT NULL,
  p_purchase_date date DEFAULT NULL, p_supplier text DEFAULT NULL, p_invoice_path text DEFAULT NULL,
  p_funding_source text DEFAULT NULL, p_photo_path text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  u public.equipment_units%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO u FROM public.equipment_units WHERE id = p_unit_id;
  IF NOT FOUND OR NOT public.can_manage_equipment(u.organization_id) THEN RAISE EXCEPTION 'unit not found'; END IF;
  IF p_invoice_path IS NOT NULL AND (public.storage_path_org_id(p_invoice_path) IS DISTINCT FROM u.organization_id
       OR split_part(p_invoice_path, '/', 2) <> 'equipment') THEN
    RAISE EXCEPTION 'invalid invoice path';
  END IF;
  IF p_photo_path IS NOT NULL AND public.storage_path_org_id(p_photo_path) IS DISTINCT FROM u.organization_id THEN
    RAISE EXCEPTION 'invalid photo path';
  END IF;
  UPDATE public.equipment_units
     SET condition = coalesce(p_condition, condition), location_note = nullif(trim(p_location_note), ''),
         serial_number = nullif(trim(p_serial_number), ''), purchase_price_cents = p_purchase_price_cents,
         purchase_date = p_purchase_date, supplier = nullif(trim(p_supplier), ''),
         invoice_path = p_invoice_path, funding_source = p_funding_source, photo_path = p_photo_path
   WHERE id = p_unit_id;
  PERFORM public.equipment_ledger_append(u.organization_id, 'unit_updated', u.id, u.item_id, NULL, NULL, NULL,
    jsonb_build_object('condition', coalesce(p_condition, u.condition)));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rotate_equipment_qr(p_unit_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  u public.equipment_units%ROWTYPE;
  v_token text := public.equipment_new_qr_token();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO u FROM public.equipment_units WHERE id = p_unit_id;
  IF NOT FOUND OR NOT public.can_manage_equipment(u.organization_id) THEN RAISE EXCEPTION 'unit not found'; END IF;
  UPDATE public.equipment_units SET qr_token = v_token WHERE id = p_unit_id;
  PERFORM public.equipment_ledger_append(u.organization_id, 'qr_rotated', u.id, u.item_id);
  RETURN v_token;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.get_equipment_unit_admin(p_unit_id uuid)
RETURNS TABLE (
  id uuid, organization_id uuid, item_id uuid, item_name text, asset_tag text, status text, condition text,
  current_holder_id uuid, holder_name text, location_note text, photo_path text, serial_number text,
  purchase_price_cents bigint, purchase_date date, supplier text, invoice_path text, funding_source text,
  qr_token text, created_at timestamptz, updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.equipment_units x
                 WHERE x.id = p_unit_id AND public.can_manage_equipment(x.organization_id)) THEN
    RAISE EXCEPTION 'unit not found';
  END IF;
  RETURN QUERY
  SELECT u.id, u.organization_id, u.item_id, i.name, u.asset_tag, u.status, u.condition,
         u.current_holder_id, hu.full_name, u.location_note, u.photo_path, u.serial_number,
         u.purchase_price_cents, u.purchase_date, u.supplier, u.invoice_path, u.funding_source,
         u.qr_token, u.created_at, u.updated_at
  FROM public.equipment_units u
  JOIN public.equipment_items i ON i.id = u.item_id
  LEFT JOIN public.users hu ON hu.id = u.current_holder_id
  WHERE u.id = p_unit_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.create_equipment_from_wishlist(p_wishlist_item_id uuid, p_category_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  w record;
  v_id uuid;
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
  INSERT INTO public.equipment_items (organization_id, category_id, name, description, wishlist_item_id, created_by)
  VALUES (w.organization_id, p_category_id, left(w.title, 120), left(w.description, 2000), w.id, auth.uid())
  RETURNING id INTO v_id;
  PERFORM public.equipment_ledger_append(w.organization_id, 'item_created', NULL, v_id, NULL, NULL, NULL,
    jsonb_build_object('name', left(w.title, 120), 'wishlist_item_id', w.id));
  RETURN v_id;
END;
$fn$;

-- -----------------------------------------------------------------------------
-- Member read RPCs (no restricted columns, holder as "First I.")
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_equipment_catalogue(p_include_archived boolean DEFAULT false)
RETURNS TABLE (
  item_id uuid, name text, description text, photo_path text, category_id uuid, category_name text,
  category_sort int, requires_certification boolean, is_archived boolean,
  unit_count int, available_count int, out_count int, unavailable_count int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public.equipment_require_org();
BEGIN
  IF NOT public.is_equipment_member(v_org) THEN RETURN; END IF;
  RETURN QUERY
  SELECT i.id, i.name, i.description, i.photo_path, c.id, c.name, coalesce(c.sort_order, 999),
         i.requires_certification, i.is_archived,
         count(u.id)::int,
         count(u.id) FILTER (WHERE u.status = 'available')::int,
         count(u.id) FILTER (WHERE u.status IN ('checked_out', 'overdue', 'in_transfer', 'reserved'))::int,
         count(u.id) FILTER (WHERE u.status IN ('under_repair', 'damaged', 'lost', 'stolen'))::int
  FROM public.equipment_items i
  LEFT JOIN public.equipment_categories c ON c.id = i.category_id
  LEFT JOIN public.equipment_units u ON u.item_id = i.id AND u.status <> 'retired'
  WHERE i.organization_id = v_org
    AND (coalesce(p_include_archived, false) OR NOT i.is_archived)
  GROUP BY i.id, c.id
  ORDER BY coalesce(c.sort_order, 999), c.name, i.name;
END;
$fn$;

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
    'requires_certification', i.requires_certification, 'is_archived', i.is_archived,
    'category_name', (SELECT c.name FROM public.equipment_categories c WHERE c.id = i.category_id),
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

CREATE OR REPLACE FUNCTION public.resolve_equipment_qr(p_token text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id uuid;
  v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT id, organization_id INTO v_id, v_org FROM public.equipment_units WHERE qr_token = trim(p_token);
  IF v_id IS NULL OR NOT public.is_equipment_member(v_org) THEN RAISE EXCEPTION 'unit not found'; END IF;
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.list_equipment_unit_ledger(p_unit_id uuid, p_limit int DEFAULT 50)
RETURNS TABLE (id bigint, event text, from_status text, to_status text, actor_name text,
               holder_name text, occurred_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT organization_id INTO v_org FROM public.equipment_units WHERE equipment_units.id = p_unit_id;
  IF v_org IS NULL OR NOT public.is_equipment_member(v_org) THEN RAISE EXCEPTION 'unit not found'; END IF;
  RETURN QUERY
  SELECT l.id, l.event, l.from_status, l.to_status,
         public.equipment_display_name(l.actor_id), public.equipment_display_name(l.holder_id), l.occurred_at
  FROM public.equipment_ledger l
  WHERE l.unit_id = p_unit_id AND l.organization_id = v_org
  ORDER BY l.id DESC
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
END;
$fn$;

-- -----------------------------------------------------------------------------
-- Function grants
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.is_patrol_role(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_patrol_role(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_equipment_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_equipment_member(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_manage_equipment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_equipment(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.equipment_transition_allowed(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipment_transition_allowed(text, text) TO authenticated, service_role;

-- Internal helpers: service_role only.
REVOKE ALL ON FUNCTION public.equipment_display_name(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_display_name(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.equipment_new_qr_token() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_new_qr_token() TO service_role;
REVOKE ALL ON FUNCTION public.equipment_ledger_append(uuid, text, uuid, uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_ledger_append(uuid, text, uuid, uuid, text, text, uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.equipment_set_unit_status(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_set_unit_status(uuid, text, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.equipment_require_org() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_require_org() TO service_role;
REVOKE ALL ON FUNCTION public.trg_equipment_ledger_append_only() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_equipment_ledger_append_only() TO service_role;
REVOKE ALL ON FUNCTION public.trg_equipment_ledger_hash() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_equipment_ledger_hash() TO service_role;
REVOKE ALL ON FUNCTION public.trg_equipment_units_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_equipment_units_guard() TO service_role;

-- Client RPCs.
REVOKE ALL ON FUNCTION public.verify_equipment_ledger(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_equipment_ledger(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ensure_equipment_defaults() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_equipment_defaults() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.upsert_equipment_item(uuid, text, uuid, text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_equipment_item(uuid, text, uuid, text, text, boolean, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.add_equipment_unit(uuid, text, text, text, text, bigint, date, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_equipment_unit(uuid, text, text, text, text, bigint, date, text, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_equipment_unit_details(uuid, text, text, text, bigint, date, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_equipment_unit_details(uuid, text, text, text, bigint, date, text, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.rotate_equipment_qr(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_equipment_qr(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_equipment_unit_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_equipment_unit_admin(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_equipment_from_wishlist(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_equipment_from_wishlist(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_equipment_catalogue(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_equipment_catalogue(boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_equipment_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_equipment_item(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_equipment_unit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_equipment_unit(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_equipment_qr(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_equipment_qr(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_equipment_unit_ledger(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_equipment_unit_ledger(uuid, int) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
