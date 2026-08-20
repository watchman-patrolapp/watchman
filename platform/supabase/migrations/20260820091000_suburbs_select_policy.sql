-- suburbs: RLS was enabled (or should be) without policies, so client SELECTs
-- (areaWeather, OrganizationOnboarding) return nothing. Mirror cities: open read.

ALTER TABLE public.suburbs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS suburbs_select_all ON public.suburbs;
DROP POLICY IF EXISTS suburbs_select_active ON public.suburbs;

CREATE POLICY suburbs_select_active ON public.suburbs
  FOR SELECT
  TO authenticated
  USING (coalesce(active, true));

GRANT SELECT ON public.suburbs TO authenticated;
