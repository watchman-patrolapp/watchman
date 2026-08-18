-- Neighbourhood petrol price for volunteer fuel estimates on the leaderboard.
-- Committee / NW admin / tech support set today's pump price; members can read it.

CREATE TABLE IF NOT EXISTS public.organization_petrol_price (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations (id) ON DELETE CASCADE,
  price_zar_per_litre numeric(5,2) NOT NULL
    CHECK (price_zar_per_litre >= 12 AND price_zar_per_litre <= 40),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.organization_petrol_price IS
  'Area pump price (ZAR/L) used for approximate patrol fuel cost on the leaderboard.';

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
  );

DROP POLICY IF EXISTS organization_petrol_price_write ON public.organization_petrol_price;
CREATE POLICY organization_petrol_price_write ON public.organization_petrol_price
  FOR ALL TO authenticated
  USING (public.can_set_organization_petrol_price())
  WITH CHECK (public.can_set_organization_petrol_price());

GRANT SELECT ON public.organization_petrol_price TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.organization_petrol_price TO authenticated;
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
  v_price numeric(5,2);
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization required';
  END IF;
  IF NOT public.can_set_organization_petrol_price() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF NOT (
    public.is_global_app_staff()
    OR public.is_platform_staff()
    OR p_organization_id IN (SELECT public.current_org_ids())
  ) THEN
    RAISE EXCEPTION 'organization out of scope';
  END IF;

  v_price := round(p_price::numeric, 1);
  IF v_price < 12 OR v_price > 40 THEN
    RAISE EXCEPTION 'price out of range';
  END IF;

  INSERT INTO public.organization_petrol_price (
    organization_id, price_zar_per_litre, updated_at, updated_by
  ) VALUES (
    p_organization_id, v_price, now(), auth.uid()
  )
  ON CONFLICT (organization_id) DO UPDATE
    SET price_zar_per_litre = EXCLUDED.price_zar_per_litre,
        updated_at = now(),
        updated_by = auth.uid();

  RETURN v_price;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_organization_petrol_price(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_organization_petrol_price(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_organization_petrol_price(uuid, numeric) TO service_role;

-- Make/model + type for fuel estimates. No registration numbers.
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
    OR u.organization_id IN (SELECT public.current_org_ids());
$$;

REVOKE ALL ON FUNCTION public.list_watch_fuel_vehicles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_watch_fuel_vehicles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_watch_fuel_vehicles() TO service_role;

COMMENT ON FUNCTION public.list_watch_fuel_vehicles() IS
  'Primary vehicle make/model for neighbourhood fuel estimates. No number plates.';
