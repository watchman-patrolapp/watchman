-- One city sits above every neighborhood / partner org.
-- Gqeberha (Port Elizabeth) is the parent; areas (Theescombe, later Lorraine, …)
-- stay isolated from each other. City Hub and Hotspots remain city-wide.

INSERT INTO public.cities (name, province, country, center_lat, center_lng)
SELECT
  'Gqeberha (Port Elizabeth)',
  'Eastern Cape',
  'South Africa',
  -33.9608,
  25.6022
WHERE NOT EXISTS (
  SELECT 1
  FROM public.cities c
  WHERE lower(c.name) IN (
    'gqeberha (port elizabeth)',
    'gqeberha',
    'port elizabeth',
    'nelson mandela bay'
  )
);

UPDATE public.cities
SET
  name = 'Gqeberha (Port Elizabeth)',
  province = coalesce(province, 'Eastern Cape'),
  country = coalesce(nullif(country, ''), 'South Africa'),
  center_lat = coalesce(center_lat, -33.9608),
  center_lng = coalesce(center_lng, 25.6022)
WHERE lower(name) IN ('gqeberha', 'port elizabeth', 'nelson mandela bay');

CREATE OR REPLACE FUNCTION public.default_city_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id
  FROM public.cities
  WHERE lower(name) = 'gqeberha (port elizabeth)'
  ORDER BY created_at
  LIMIT 1
$$;

COMMENT ON FUNCTION public.default_city_id() IS
  'The single parent city for this deployment: Gqeberha (Port Elizabeth).';

REVOKE ALL ON FUNCTION public.default_city_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.default_city_id() TO anon;
GRANT EXECUTE ON FUNCTION public.default_city_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.default_city_id() TO service_role;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS city_id uuid REFERENCES public.cities (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS organizations_city_id_idx ON public.organizations (city_id);

INSERT INTO public.suburbs (city_id, name, center_lat, center_lng, active)
SELECT public.default_city_id(), 'Theescombe', -33.978, 25.505, true
WHERE public.default_city_id() IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.suburbs s WHERE lower(s.name) = 'theescombe'
  );

UPDATE public.suburbs
SET city_id = public.default_city_id()
WHERE city_id IS NULL
  AND public.default_city_id() IS NOT NULL;

UPDATE public.organizations
SET city_id = public.default_city_id()
WHERE city_id IS NULL
  AND public.default_city_id() IS NOT NULL;

UPDATE public.organizations o
SET primary_suburb_id = s.id
FROM public.suburbs s
WHERE o.primary_suburb_id IS NULL
  AND lower(o.name) LIKE '%theescombe%'
  AND lower(s.name) = 'theescombe';

UPDATE public.city_hub_posts
SET city_id = public.default_city_id()
WHERE city_id IS NULL
  AND public.default_city_id() IS NOT NULL;

UPDATE public.criminal_profiles
SET city_id = public.default_city_id()
WHERE city_id IS NULL
  AND public.default_city_id() IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_default_city_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.city_id IS NULL THEN
    NEW.city_id := public.default_city_id();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_set_default_city ON public.organizations;
CREATE TRIGGER organizations_set_default_city
  BEFORE INSERT OR UPDATE OF city_id
  ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_default_city_id();

DROP TRIGGER IF EXISTS suburbs_set_default_city ON public.suburbs;
CREATE TRIGGER suburbs_set_default_city
  BEFORE INSERT OR UPDATE OF city_id
  ON public.suburbs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_default_city_id();

ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cities_select_all ON public.cities;
CREATE POLICY cities_select_all ON public.cities
  FOR SELECT TO anon, authenticated
  USING (true);

GRANT SELECT ON public.cities TO anon;
GRANT SELECT ON public.cities TO authenticated;

CREATE OR REPLACE FUNCTION public.list_public_signup_options()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'city', (
      SELECT jsonb_build_object('id', c.id, 'name', c.name)
      FROM public.cities c
      WHERE c.id = public.default_city_id()
    ),
    'areas', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object('id', o.id, 'name', o.name)
        ORDER BY o.name
      )
      FROM public.organizations o
      WHERE o.type = 'nw_group'
        AND o.status = 'active'
    ), '[]'::jsonb),
    'security_companies', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object('id', o.id, 'name', o.name)
        ORDER BY o.name
      )
      FROM public.organizations o
      WHERE o.type = 'security_company'
        AND o.status <> 'suspended'
    ), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION public.list_public_signup_options() IS
  'Public register form options: parent city, active neighborhood areas, and listed security companies.';
