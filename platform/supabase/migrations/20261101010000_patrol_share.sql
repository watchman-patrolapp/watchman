-- =============================================================================
-- Share to WhatsApp: patrol sign-on / sign-off share references.
-- Additive only. end_patrol is NOT changed (still idempotent); the patrol_logs
-- BEFORE INSERT trigger carries the share fields across, which also covers the
-- admin force-end path (client INSERT into patrol_logs).
--
--   * active_patrols / patrol_logs: share_ref ('PT-' + 4 chars from
--     ABCDEFGHJKMNPQRSTUVWXYZ23456789), start_shared_at, share_tracked.
--     patrol_logs also gets end_shared_at and vehicle_type (if missing).
--   * share_ref is unique per organization across BOTH tables (generator
--     checks both; partial unique indexes guard each table).
--   * share_tracked = true for patrols started after this migration, so the
--     control room shows "Not shared" only for patrols that could be shared.
--     Backfilled rows get a ref but stay share_tracked = false.
--   * mark_patrol_shared(p_share_ref, p_kind): idempotent; owner, or org
--     staff (nw_admin / committee / admin / technical_support / platform
--     staff) in the same org.
--   * get_patrol_share(p_share_ref) and list_my_pending_patrol_shares():
--     read paths that do not depend on the patrol tables' RLS.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.active_patrols
  ADD COLUMN IF NOT EXISTS share_ref text,
  ADD COLUMN IF NOT EXISTS start_shared_at timestamptz,
  ADD COLUMN IF NOT EXISTS share_tracked boolean NOT NULL DEFAULT false;

ALTER TABLE public.patrol_logs
  ADD COLUMN IF NOT EXISTS share_ref text,
  ADD COLUMN IF NOT EXISTS start_shared_at timestamptz,
  ADD COLUMN IF NOT EXISTS end_shared_at timestamptz,
  ADD COLUMN IF NOT EXISTS share_tracked boolean NOT NULL DEFAULT false;

-- Conditional, non-destructive vehicle split: patrol_logs historically keeps
-- make/model + reg but not the type. Add it only when missing; never drop or
-- rewrite existing vehicle columns.
DO $vt$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patrol_logs' AND column_name = 'vehicle_type'
  ) THEN
    ALTER TABLE public.patrol_logs ADD COLUMN vehicle_type text;
  END IF;
END
$vt$;

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'active_patrols_share_ref_format') THEN
    ALTER TABLE public.active_patrols ADD CONSTRAINT active_patrols_share_ref_format
      CHECK (share_ref IS NULL OR share_ref ~ '^PT-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patrol_logs_share_ref_format') THEN
    ALTER TABLE public.patrol_logs ADD CONSTRAINT patrol_logs_share_ref_format
      CHECK (share_ref IS NULL OR share_ref ~ '^PT-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$');
  END IF;
END
$chk$;

CREATE UNIQUE INDEX IF NOT EXISTS active_patrols_org_share_ref_uniq
  ON public.active_patrols (organization_id, share_ref) WHERE share_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS patrol_logs_org_share_ref_uniq
  ON public.patrol_logs (organization_id, share_ref) WHERE share_ref IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Ref generator (unique per org across both tables)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.random_patrol_share_ref()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  out_ref text := 'PT-';
  i int;
BEGIN
  FOR i IN 1..4 LOOP
    out_ref := out_ref || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  END LOOP;
  RETURN out_ref;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_patrol_share_ref(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate text;
  attempt int := 0;
BEGIN
  LOOP
    attempt := attempt + 1;
    candidate := public.random_patrol_share_ref();
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.active_patrols ap
      WHERE ap.share_ref = candidate AND ap.organization_id IS NOT DISTINCT FROM p_org_id
    ) AND NOT EXISTS (
      SELECT 1 FROM public.patrol_logs pl
      WHERE pl.share_ref = candidate AND pl.organization_id IS NOT DISTINCT FROM p_org_id
    );
    IF attempt >= 50 THEN
      RAISE EXCEPTION 'could not allocate a patrol share ref';
    END IF;
  END LOOP;
  RETURN candidate;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Triggers. Names start with zz_ so they fire after
--    stamp_working_organization_id (BEFORE triggers run in name order).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_active_patrols_share_ref()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Server-owned fields: a client can never pre-mark a patrol as shared.
  NEW.start_shared_at := NULL;
  NEW.share_tracked := true;
  NEW.share_ref := public.next_patrol_share_ref(NEW.organization_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_active_patrols_share_ref ON public.active_patrols;
CREATE TRIGGER zz_active_patrols_share_ref
  BEFORE INSERT ON public.active_patrols
  FOR EACH ROW EXECUTE FUNCTION public.trg_active_patrols_share_ref();

-- Clients may not rewrite the share fields on UPDATE (vehicle sync updates the row).
CREATE OR REPLACE FUNCTION public.trg_active_patrols_share_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('app.patrol_share_write', true), '') <> 'on' THEN
    NEW.share_ref := OLD.share_ref;
    NEW.start_shared_at := OLD.start_shared_at;
    NEW.share_tracked := OLD.share_tracked;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_active_patrols_share_guard ON public.active_patrols;
CREATE TRIGGER zz_active_patrols_share_guard
  BEFORE UPDATE ON public.active_patrols
  FOR EACH ROW EXECUTE FUNCTION public.trg_active_patrols_share_guard();

-- patrol_logs INSERT (end_patrol, admin force-end, anything else): carry the
-- ref and sign-on share time from the still-present active row; fill the
-- vehicle type, and the legacy car_type / reg_number when the log has none.
CREATE OR REPLACE FUNCTION public.trg_patrol_logs_share_ref()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ap public.active_patrols%ROWTYPE;
BEGIN
  NEW.end_shared_at := NULL;

  SELECT * INTO ap
  FROM public.active_patrols a
  WHERE a.user_id::text = NEW.user_id::text
  ORDER BY (a.start_time = NEW.start_time) DESC NULLS LAST, a.start_time DESC
  LIMIT 1;

  IF FOUND THEN
    NEW.share_ref := ap.share_ref;
    NEW.start_shared_at := ap.start_shared_at;
    NEW.share_tracked := coalesce(ap.share_tracked, false);
    IF nullif(trim(coalesce(NEW.vehicle_type, '')), '') IS NULL THEN
      NEW.vehicle_type := ap.vehicle_type;
    END IF;
    IF nullif(trim(coalesce(NEW.vehicle_make_model, '')), '') IS NULL
       AND nullif(nullif(trim(coalesce(ap.car_type, '')), ''), '-') IS NOT NULL THEN
      NEW.vehicle_make_model := ap.car_type;
    END IF;
    IF nullif(trim(coalesce(NEW.vehicle_reg, '')), '') IS NULL
       AND nullif(nullif(trim(coalesce(ap.reg_number, '')), ''), '-') IS NOT NULL THEN
      NEW.vehicle_reg := ap.reg_number;
    END IF;
  ELSE
    NEW.start_shared_at := NULL;
    NEW.share_tracked := false;
  END IF;

  IF NEW.share_ref IS NULL
     OR EXISTS (
       SELECT 1 FROM public.patrol_logs pl
       WHERE pl.share_ref = NEW.share_ref
         AND pl.organization_id IS NOT DISTINCT FROM NEW.organization_id
     ) THEN
    NEW.share_ref := public.next_patrol_share_ref(NEW.organization_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_patrol_logs_share_ref ON public.patrol_logs;
CREATE TRIGGER zz_patrol_logs_share_ref
  BEFORE INSERT ON public.patrol_logs
  FOR EACH ROW EXECUTE FUNCTION public.trg_patrol_logs_share_ref();

CREATE OR REPLACE FUNCTION public.trg_patrol_logs_share_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('app.patrol_share_write', true), '') <> 'on' THEN
    NEW.share_ref := OLD.share_ref;
    NEW.start_shared_at := OLD.start_shared_at;
    NEW.end_shared_at := OLD.end_shared_at;
    NEW.share_tracked := OLD.share_tracked;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_patrol_logs_share_guard ON public.patrol_logs;
CREATE TRIGGER zz_patrol_logs_share_guard
  BEFORE UPDATE ON public.patrol_logs
  FOR EACH ROW EXECUTE FUNCTION public.trg_patrol_logs_share_guard();

-- ---------------------------------------------------------------------------
-- 4) Backfill refs (share_tracked stays false: these predate the feature)
-- ---------------------------------------------------------------------------
DO $bf$
DECLARE
  r record;
BEGIN
  PERFORM set_config('app.patrol_share_write', 'on', true);
  FOR r IN SELECT ctid, organization_id FROM public.active_patrols WHERE share_ref IS NULL LOOP
    UPDATE public.active_patrols
    SET share_ref = public.next_patrol_share_ref(r.organization_id)
    WHERE ctid = r.ctid;
  END LOOP;
  FOR r IN SELECT ctid, organization_id FROM public.patrol_logs WHERE share_ref IS NULL LOOP
    UPDATE public.patrol_logs
    SET share_ref = public.next_patrol_share_ref(r.organization_id)
    WHERE ctid = r.ctid;
  END LOOP;
  PERFORM set_config('app.patrol_share_write', 'off', true);
END
$bf$;

-- ---------------------------------------------------------------------------
-- 5) Who may see / mark a patrol's share state
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_view_patrol_shares(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND p_org_id IS NOT NULL
    AND p_org_id IN (SELECT public.current_org_ids())
    AND (
      public.is_org_nw_admin(p_org_id)
      OR public.is_global_app_staff()
      OR public.is_platform_staff()
      OR EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid()
          AND replace(lower(trim(u.role::text)), '-', '_') IN ('committee', 'admin', 'technical_support')
      )
    );
$$;

-- One row shape for both tables.
CREATE OR REPLACE FUNCTION public.get_patrol_share(p_share_ref text)
RETURNS TABLE (
  source text,
  share_ref text,
  user_id text,
  user_name text,
  organization_id uuid,
  zone text,
  start_time timestamptz,
  end_time timestamptz,
  vehicle_type text,
  vehicle_make_model text,
  vehicle_reg text,
  start_shared_at timestamptz,
  end_shared_at timestamptz,
  share_tracked boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  RETURN QUERY
  SELECT q.* FROM (
    SELECT 'log'::text, pl.share_ref, pl.user_id::text, pl.user_name::text, pl.organization_id,
           pl.zone::text, pl.start_time::timestamptz, pl.end_time::timestamptz,
           pl.vehicle_type::text, pl.vehicle_make_model::text, pl.vehicle_reg::text,
           pl.start_shared_at, pl.end_shared_at, pl.share_tracked
    FROM public.patrol_logs pl
    WHERE pl.share_ref = upper(trim(p_share_ref))
      AND (pl.user_id::text = uid::text OR public.can_view_patrol_shares(pl.organization_id))
    UNION ALL
    SELECT 'active'::text, ap.share_ref, ap.user_id::text, ap.user_name::text, ap.organization_id,
           ap.zone::text, ap.start_time::timestamptz, NULL::timestamptz,
           ap.vehicle_type::text,
           coalesce(nullif(trim(ap.vehicle_make_model::text), ''), nullif(nullif(trim(ap.car_type::text), ''), '-')),
           coalesce(nullif(trim(ap.vehicle_reg::text), ''), nullif(nullif(trim(ap.reg_number::text), ''), '-')),
           ap.start_shared_at, NULL::timestamptz, ap.share_tracked
    FROM public.active_patrols ap
    WHERE ap.share_ref = upper(trim(p_share_ref))
      AND (ap.user_id::text = uid::text OR public.can_view_patrol_shares(ap.organization_id))
  ) q
  ORDER BY q.start_time DESC NULLS LAST
  LIMIT 1;
END;
$$;

-- The caller's own patrols that still need a share: the active one (sign-on not
-- shared) and ended ones from the last 24 h whose sign-off is not shared.
CREATE OR REPLACE FUNCTION public.list_my_pending_patrol_shares()
RETURNS TABLE (
  source text,
  share_ref text,
  user_id text,
  user_name text,
  organization_id uuid,
  zone text,
  start_time timestamptz,
  end_time timestamptz,
  vehicle_type text,
  vehicle_make_model text,
  vehicle_reg text,
  start_shared_at timestamptz,
  end_shared_at timestamptz,
  share_tracked boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  RETURN QUERY
  SELECT q.* FROM (
    SELECT 'active'::text, ap.share_ref, ap.user_id::text, ap.user_name::text, ap.organization_id,
           ap.zone::text, ap.start_time::timestamptz, NULL::timestamptz,
           ap.vehicle_type::text,
           coalesce(nullif(trim(ap.vehicle_make_model::text), ''), nullif(nullif(trim(ap.car_type::text), ''), '-')),
           coalesce(nullif(trim(ap.vehicle_reg::text), ''), nullif(nullif(trim(ap.reg_number::text), ''), '-')),
           ap.start_shared_at, NULL::timestamptz, ap.share_tracked
    FROM public.active_patrols ap
    WHERE ap.user_id::text = uid::text
      AND ap.share_tracked
      AND ap.start_shared_at IS NULL
    UNION ALL
    SELECT 'log'::text, pl.share_ref, pl.user_id::text, pl.user_name::text, pl.organization_id,
           pl.zone::text, pl.start_time::timestamptz, pl.end_time::timestamptz,
           pl.vehicle_type::text, pl.vehicle_make_model::text, pl.vehicle_reg::text,
           pl.start_shared_at, pl.end_shared_at, pl.share_tracked
    FROM public.patrol_logs pl
    WHERE pl.user_id::text = uid::text
      AND pl.share_tracked
      AND pl.end_shared_at IS NULL
      AND pl.end_time::timestamptz > now() - interval '24 hours'
  ) q
  ORDER BY q.start_time DESC NULLS LAST
  LIMIT 5;
END;
$$;

-- Idempotent: the first share time wins; later calls return it unchanged.
CREATE OR REPLACE FUNCTION public.mark_patrol_shared(p_share_ref text, p_kind text)
RETURNS timestamptz
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  ref text := upper(trim(coalesce(p_share_ref, '')));
  v_org uuid;
  v_owner text;
  v_at timestamptz;
  v_src text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('start', 'end') THEN
    RAISE EXCEPTION 'invalid kind';
  END IF;

  -- Locate the row the caller can see (own patrol, or any patrol in an org they belong to).
  IF p_kind = 'start' THEN
    SELECT 'active', ap.organization_id, ap.user_id::text INTO v_src, v_org, v_owner
    FROM public.active_patrols ap
    WHERE ap.share_ref = ref
      AND (ap.user_id::text = uid::text OR ap.organization_id IN (SELECT public.current_org_ids()))
    ORDER BY (ap.user_id::text = uid::text) DESC
    LIMIT 1;
  END IF;
  IF v_src IS NULL THEN
    SELECT 'log', pl.organization_id, pl.user_id::text INTO v_src, v_org, v_owner
    FROM public.patrol_logs pl
    WHERE pl.share_ref = ref
      AND (pl.user_id::text = uid::text OR pl.organization_id IN (SELECT public.current_org_ids()))
    ORDER BY (pl.user_id::text = uid::text) DESC, pl.start_time DESC
    LIMIT 1;
  END IF;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'patrol not found';
  END IF;

  IF v_owner IS DISTINCT FROM uid::text AND NOT public.can_view_patrol_shares(v_org) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  PERFORM set_config('app.patrol_share_write', 'on', true);
  IF v_src = 'active' THEN
    UPDATE public.active_patrols ap
    SET start_shared_at = coalesce(ap.start_shared_at, now())
    WHERE ap.share_ref = ref AND ap.organization_id IS NOT DISTINCT FROM v_org
    RETURNING ap.start_shared_at INTO v_at;
  ELSIF p_kind = 'start' THEN
    UPDATE public.patrol_logs pl
    SET start_shared_at = coalesce(pl.start_shared_at, now())
    WHERE pl.share_ref = ref AND pl.organization_id IS NOT DISTINCT FROM v_org
    RETURNING pl.start_shared_at INTO v_at;
  ELSE
    UPDATE public.patrol_logs pl
    SET end_shared_at = coalesce(pl.end_shared_at, now())
    WHERE pl.share_ref = ref AND pl.organization_id IS NOT DISTINCT FROM v_org
    RETURNING pl.end_shared_at INTO v_at;
  END IF;
  PERFORM set_config('app.patrol_share_write', 'off', true);

  RETURN v_at;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.random_patrol_share_ref() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.random_patrol_share_ref() TO service_role;
REVOKE ALL ON FUNCTION public.next_patrol_share_ref(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_patrol_share_ref(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.trg_active_patrols_share_ref() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_active_patrols_share_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_patrol_logs_share_ref() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_patrol_logs_share_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_view_patrol_shares(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_patrol_shares(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_patrol_share(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_patrol_share(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_my_pending_patrol_shares() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_pending_patrol_shares() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_patrol_shared(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_patrol_shared(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.mark_patrol_shared(text, text) IS
  'Stamp start_shared_at / end_shared_at once (idempotent). Owner, or org staff in the same org.';
COMMENT ON FUNCTION public.get_patrol_share(text) IS
  'Share card data for one patrol by share_ref. Owner, or org staff in the same org.';
