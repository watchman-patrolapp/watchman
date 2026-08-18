-- Fix neighbourhood petrol-price save:
-- 1. Table + RPC if the previous migration was not applied yet
-- 2. Global admin/tech may save for the area they have selected in the app
--    even when active_organization_id is not synced
-- 3. Reload PostgREST so the RPC is visible immediately

CREATE TABLE IF NOT EXISTS public.organization_petrol_price (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations (id) ON DELETE CASCADE,
  price_zar_per_litre numeric(5,2) NOT NULL
    CHECK (price_zar_per_litre >= 12 AND price_zar_per_litre <= 40),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users (id) ON DELETE SET NULL
);

ALTER TABLE public.organization_petrol_price ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_set_organization_petrol_price()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_global_app_staff()
    OR public.is_platform_staff()
    OR EXISTS (
      SELECT 1
      FROM public.users cu
      WHERE cu.id = auth.uid()
        AND lower(trim(coalesce(cu.role::text, ''))) IN (
          'admin',
          'technical_support',
          'nw_admin',
          'committee'
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_set_organization_petrol_price() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_set_organization_petrol_price() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_set_organization_petrol_price() TO service_role;

DROP POLICY IF EXISTS organization_petrol_price_select ON public.organization_petrol_price;
CREATE POLICY organization_petrol_price_select ON public.organization_petrol_price
  FOR SELECT TO authenticated
  USING (
    public.is_global_app_staff()
    OR public.is_platform_staff()
    OR organization_id IN (SELECT public.current_org_ids())
    OR organization_id = public.working_organization_id()
  );

DROP POLICY IF EXISTS organization_petrol_price_write ON public.organization_petrol_price;
CREATE POLICY organization_petrol_price_write ON public.organization_petrol_price
  FOR ALL TO authenticated
  USING (
    public.can_set_organization_petrol_price()
    AND (
      public.is_global_app_staff()
      OR public.is_platform_staff()
      OR organization_id IN (SELECT public.current_org_ids())
      OR organization_id = public.working_organization_id()
    )
  )
  WITH CHECK (
    public.can_set_organization_petrol_price()
    AND (
      public.is_global_app_staff()
      OR public.is_platform_staff()
      OR organization_id IN (SELECT public.current_org_ids())
      OR organization_id = public.working_organization_id()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_petrol_price TO authenticated;
GRANT ALL ON public.organization_petrol_price TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_organization_petrol_price(
  p_organization_id uuid,
  p_price numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_price numeric(5,2);
  v_user uuid;
BEGIN
  v_org := COALESCE(p_organization_id, public.working_organization_id());
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'organization required';
  END IF;
  IF NOT public.can_set_organization_petrol_price() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  -- Local watch roles may only write their neighbourhood. Global/platform staff
  -- may write the org the app is currently viewing.
  IF NOT (public.is_global_app_staff() OR public.is_platform_staff()) THEN
    IF v_org NOT IN (SELECT public.current_org_ids())
       AND v_org IS DISTINCT FROM public.working_organization_id() THEN
      RAISE EXCEPTION 'organization out of scope';
    END IF;
  END IF;

  v_price := round(COALESCE(p_price, 0)::numeric, 1);
  IF v_price < 12 OR v_price > 40 THEN
    RAISE EXCEPTION 'price out of range';
  END IF;

  SELECT id INTO v_user FROM public.users WHERE id = auth.uid();

  INSERT INTO public.organization_petrol_price (
    organization_id, price_zar_per_litre, updated_at, updated_by
  ) VALUES (
    v_org, v_price, now(), v_user
  )
  ON CONFLICT (organization_id) DO UPDATE
    SET price_zar_per_litre = EXCLUDED.price_zar_per_litre,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by;

  RETURN v_price;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_organization_petrol_price(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_organization_petrol_price(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_organization_petrol_price(uuid, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.list_watch_fuel_vehicles()
RETURNS TABLE (
  user_id uuid,
  vehicle_type text,
  make_model text,
  car_type text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id AS user_id,
    v.vehicle_type,
    v.make_model,
    u.car_type
  FROM public.users u
  LEFT JOIN LATERAL (
    SELECT uv.vehicle_type, uv.make_model
    FROM public.user_vehicles uv
    WHERE uv.user_id = u.id
    ORDER BY uv.is_primary DESC NULLS LAST
    LIMIT 1
  ) v ON true
  WHERE
    u.id = auth.uid()
    OR u.organization_id IN (SELECT public.current_org_ids())
    OR u.organization_id = public.working_organization_id();
$$;

REVOKE ALL ON FUNCTION public.list_watch_fuel_vehicles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_watch_fuel_vehicles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_watch_fuel_vehicles() TO service_role;

NOTIFY pgrst, 'reload schema';
