-- SA places, phase P1: schema only (no place data; the GeoNames seed is P2).
--
-- * countries (ZA only, active) and the 9 provinces (ISO 3166-2:ZA codes).
-- * cities gain province, GeoNames id, place type, population, a "near …" label for
--   repeated names, status and source, plus a normalised name_key. The single
--   UNIQUE(name) on cities is dropped because South Africa has many repeated town
--   names (Middelburg, Dikeni, …); GeoNames ids are unique instead.
-- * city_aliases (old names like Port Elizabeth, alternate spellings) and suburb_aliases.
-- * suburbs gain name_key, status (active / requested / merged / rejected), merged_into_id,
--   requested_by and source, for member-created suburbs that go through approval.
-- * place_name_key(text): the same normalisation as tools/geonames-za/lib.mjs nameKey().
-- * Trigram + prefix indexes for search (pg_trgm, already installed).
-- * The existing Gqeberha row becomes "Gqeberha" (GeoNames 964420) with Port Elizabeth,
--   PE, Ibhayi and die Baai as aliases. Same id, so nothing that points at it changes.
--   default_city_id() now finds it by GeoNames id or name, old or new.
-- Additive, safe to run more than once. Nothing changes unless the pre-check passes.
-- Place names © GeoNames (geonames.org), CC BY 4.0.

-- ---------------------------------------------------------------------------
-- Pre-check
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE
  missing text[] := ARRAY[]::text[];
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public', 'cities', 'id'), ('public', 'cities', 'name'), ('public', 'cities', 'province'),
      ('public', 'cities', 'country'), ('public', 'cities', 'center_lat'), ('public', 'cities', 'center_lng'),
      ('public', 'cities', 'created_at'),
      ('public', 'suburbs', 'id'), ('public', 'suburbs', 'city_id'), ('public', 'suburbs', 'name'),
      ('public', 'suburbs', 'active'),
      ('public', 'users', 'id')
    ) AS t(s, tbl, col)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = r.s AND c.table_name = r.tbl AND c.column_name = r.col
    ) THEN
      missing := missing || format('%s.%s column', r.tbl, r.col);
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    missing := missing || 'pg_trgm extension'::text;
  END IF;
  IF to_regprocedure('public.default_city_id()') IS NULL THEN
    missing := missing || 'default_city_id() function'::text;
  END IF;
  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'SA places schema: not applied, missing %. Nothing was changed.', array_to_string(missing, ', ');
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- Name normalisation (keep identical to tools/geonames-za/lib.mjs nameKey)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_name_key(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT btrim(regexp_replace(regexp_replace(
    replace(replace(replace(replace(replace(replace(replace(
      translate(
        regexp_replace(lower(btrim(coalesce(p_name, ''))), '\s*\([^)]*\)\s*$', ''),
        'áàâäãåāăąéèêëēėęíìîïīįóòôöõøōúùûüūųýÿñńçćčšśžźżđ',
        'aaaaaaaaaeeeeeeeiiiiiiooooooouuuuuuyynncccsszzzd'),
      'ß', 'ss'), 'æ', 'ae'), 'œ', 'oe'), '''', ''), '’', ''), '`', ''), '‘', ''),
    '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

COMMENT ON FUNCTION public.place_name_key(text) IS
  'Search key for place names: lower case, no trailing "(…)", accents folded, apostrophes dropped, other punctuation as spaces.';

-- ---------------------------------------------------------------------------
-- Countries and provinces
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.countries (
  iso2 text PRIMARY KEY CHECK (iso2 ~ '^[A-Z]{2}$'),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.countries (iso2, name, active)
VALUES ('ZA', 'South Africa', true)
ON CONFLICT (iso2) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.provinces (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z]{2}-[A-Z]{2,3}$'),
  country_iso2 text NOT NULL REFERENCES public.countries (iso2),
  name text NOT NULL,
  geonames_admin1 text,
  UNIQUE (country_iso2, name)
);

INSERT INTO public.provinces (code, country_iso2, name, geonames_admin1) VALUES
  ('ZA-EC', 'ZA', 'Eastern Cape', '05'),
  ('ZA-FS', 'ZA', 'Free State', '03'),
  ('ZA-GP', 'ZA', 'Gauteng', '06'),
  ('ZA-KZN', 'ZA', 'KwaZulu-Natal', '02'),
  ('ZA-LP', 'ZA', 'Limpopo', '09'),
  ('ZA-MP', 'ZA', 'Mpumalanga', '07'),
  ('ZA-NC', 'ZA', 'Northern Cape', '08'),
  ('ZA-NW', 'ZA', 'North West', '10'),
  ('ZA-WC', 'ZA', 'Western Cape', '11')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Cities
-- ---------------------------------------------------------------------------
ALTER TABLE public.cities ADD COLUMN IF NOT EXISTS country_iso2 text NOT NULL DEFAULT 'ZA' REFERENCES public.countries (iso2);
ALTER TABLE public.cities ADD COLUMN IF NOT EXISTS province_code text REFERENCES public.provinces (code);
ALTER TABLE public.cities ADD COLUMN IF NOT EXISTS geonames_id bigint;
ALTER TABLE public.cities ADD COLUMN IF NOT EXISTS place_type text;
ALTER TABLE public.cities ADD COLUMN IF NOT EXISTS feature_code text;
ALTER TABLE public.cities ADD COLUMN IF NOT EXISTS population integer NOT NULL DEFAULT 0;
ALTER TABLE public.cities ADD COLUMN IF NOT EXISTS near_label text;
ALTER TABLE public.cities ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.cities ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.cities ADD COLUMN IF NOT EXISTS name_key text GENERATED ALWAYS AS (public.place_name_key(name)) STORED;

DO $cities$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cities_place_type_check' AND conrelid = 'public.cities'::regclass) THEN
    ALTER TABLE public.cities ADD CONSTRAINT cities_place_type_check
      CHECK (place_type IS NULL OR place_type IN ('city', 'town', 'village', 'locality'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cities_status_check' AND conrelid = 'public.cities'::regclass) THEN
    ALTER TABLE public.cities ADD CONSTRAINT cities_status_check CHECK (status IN ('active', 'hidden'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cities_source_check' AND conrelid = 'public.cities'::regclass) THEN
    ALTER TABLE public.cities ADD CONSTRAINT cities_source_check CHECK (source IN ('geonames', 'manual'));
  END IF;
END
$cities$;

CREATE UNIQUE INDEX IF NOT EXISTS cities_geonames_id_uidx ON public.cities (geonames_id) WHERE geonames_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cities_province_idx ON public.cities (province_code);
CREATE INDEX IF NOT EXISTS cities_name_key_prefix_idx ON public.cities (name_key text_pattern_ops);
CREATE INDEX IF NOT EXISTS cities_population_idx ON public.cities (population DESC);

-- Repeated town names are normal in South Africa: drop the single-column UNIQUE(name).
DO $uniq$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.cities'::regclass
      AND con.contype = 'u'
      AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.cities'::regclass AND attname = 'name')]::int2[]
  LOOP
    EXECUTE format('ALTER TABLE public.cities DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'SA places schema: dropped UNIQUE(name) constraint % on cities (GeoNames ids are unique instead).', c.conname;
  END LOOP;
END
$uniq$;

-- ---------------------------------------------------------------------------
-- Aliases
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.city_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES public.cities (id) ON DELETE CASCADE,
  alias text NOT NULL,
  alias_key text GENERATED ALWAYS AS (public.place_name_key(alias)) STORED,
  kind text NOT NULL DEFAULT 'alternate' CHECK (kind IN ('old_name', 'alternate')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, alias_key)
);
CREATE INDEX IF NOT EXISTS city_aliases_key_prefix_idx ON public.city_aliases (alias_key text_pattern_ops);

-- ---------------------------------------------------------------------------
-- Suburbs (member-created, approval-gated)
-- ---------------------------------------------------------------------------
ALTER TABLE public.suburbs ADD COLUMN IF NOT EXISTS name_key text GENERATED ALWAYS AS (public.place_name_key(name)) STORED;
ALTER TABLE public.suburbs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.suburbs ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES public.suburbs (id) ON DELETE SET NULL;
ALTER TABLE public.suburbs ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES public.users (id) ON DELETE SET NULL;
ALTER TABLE public.suburbs ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'admin';

DO $suburbs$
DECLARE
  clashes int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suburbs_status_check' AND conrelid = 'public.suburbs'::regclass) THEN
    ALTER TABLE public.suburbs ADD CONSTRAINT suburbs_status_check CHECK (status IN ('active', 'requested', 'merged', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suburbs_source_check' AND conrelid = 'public.suburbs'::regclass) THEN
    ALTER TABLE public.suburbs ADD CONSTRAINT suburbs_source_check CHECK (source IN ('admin', 'member'));
  END IF;

  -- One live suburb per spelling per city. Skipped (with a notice) if old data already clashes.
  IF to_regclass('public.suburbs_city_name_key_live_uidx') IS NULL THEN
    SELECT count(*) INTO clashes FROM (
      SELECT city_id, name_key FROM public.suburbs
      WHERE status IN ('active', 'requested')
      GROUP BY city_id, name_key HAVING count(*) > 1
    ) d;
    IF clashes = 0 THEN
      CREATE UNIQUE INDEX suburbs_city_name_key_live_uidx
        ON public.suburbs (city_id, name_key) WHERE status IN ('active', 'requested');
    ELSE
      RAISE NOTICE 'Heads-up: % suburb spellings repeat inside one city; the one-per-city index was not added. Merge them, then re-run.', clashes;
    END IF;
  END IF;
END
$suburbs$;

CREATE INDEX IF NOT EXISTS suburbs_name_key_prefix_idx ON public.suburbs (name_key text_pattern_ops);

CREATE TABLE IF NOT EXISTS public.suburb_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suburb_id uuid NOT NULL REFERENCES public.suburbs (id) ON DELETE CASCADE,
  alias text NOT NULL,
  alias_key text GENERATED ALWAYS AS (public.place_name_key(alias)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (suburb_id, alias_key)
);
CREATE INDEX IF NOT EXISTS suburb_aliases_key_prefix_idx ON public.suburb_aliases (alias_key text_pattern_ops);

-- Trigram indexes, in whatever schema pg_trgm lives in (extensions on Supabase).
DO $trgm$
DECLARE
  s text;
BEGIN
  SELECT n.nspname INTO s FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm';
  EXECUTE format('CREATE INDEX IF NOT EXISTS cities_name_key_trgm_idx ON public.cities USING gin (name_key %I.gin_trgm_ops)', s);
  EXECUTE format('CREATE INDEX IF NOT EXISTS city_aliases_key_trgm_idx ON public.city_aliases USING gin (alias_key %I.gin_trgm_ops)', s);
  EXECUTE format('CREATE INDEX IF NOT EXISTS suburbs_name_key_trgm_idx ON public.suburbs USING gin (name_key %I.gin_trgm_ops)', s);
  EXECUTE format('CREATE INDEX IF NOT EXISTS suburb_aliases_key_trgm_idx ON public.suburb_aliases USING gin (alias_key %I.gin_trgm_ops)', s);
END
$trgm$;

-- ---------------------------------------------------------------------------
-- Row level security: reference data is readable; writes stay server-side.
-- ---------------------------------------------------------------------------
ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provinces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.city_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suburb_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS countries_select_all ON public.countries;
CREATE POLICY countries_select_all ON public.countries FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS provinces_select_all ON public.provinces;
CREATE POLICY provinces_select_all ON public.provinces FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS city_aliases_select_all ON public.city_aliases;
CREATE POLICY city_aliases_select_all ON public.city_aliases FOR SELECT TO anon, authenticated USING (true);
-- suburb_aliases: no client policy; read through the suggestion RPCs (P3).

REVOKE ALL ON public.countries, public.provinces, public.city_aliases, public.suburb_aliases FROM anon, authenticated;
GRANT SELECT ON public.countries, public.provinces, public.city_aliases TO anon, authenticated;

-- Requested / merged / rejected suburbs are not readable directly.
DROP POLICY IF EXISTS suburbs_select_active ON public.suburbs;
CREATE POLICY suburbs_select_active ON public.suburbs
  FOR SELECT
  TO authenticated
  USING (coalesce(active, true) AND status = 'active');

-- ---------------------------------------------------------------------------
-- Gqeberha: official name, GeoNames id, aliases
-- ---------------------------------------------------------------------------
DO $gq$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.cities
  WHERE geonames_id = 964420
     OR lower(name) IN ('gqeberha (port elizabeth)', 'gqeberha', 'port elizabeth')
  ORDER BY (geonames_id = 964420) DESC NULLS LAST, created_at
  LIMIT 1;
  IF v_id IS NULL THEN
    RAISE NOTICE 'Heads-up: no Gqeberha row found; nothing renamed.';
    RETURN;
  END IF;
  UPDATE public.cities SET
    name = 'Gqeberha',
    geonames_id = 964420,
    province_code = 'ZA-EC',
    province = coalesce(nullif(province, ''), 'Eastern Cape'),
    country_iso2 = 'ZA',
    place_type = 'city',
    feature_code = 'PPLA2',
    population = greatest(population, 1050078),
    source = 'geonames',
    status = 'active'
  WHERE id = v_id;
  INSERT INTO public.city_aliases (city_id, alias, kind) VALUES
    (v_id, 'Port Elizabeth', 'old_name'),
    (v_id, 'PE', 'old_name'),
    (v_id, 'Ibhayi', 'alternate'),
    (v_id, 'die Baai', 'alternate')
  ON CONFLICT (city_id, alias_key) DO NOTHING;
END
$gq$;

-- Finds Gqeberha by GeoNames id first, then by its current or old label.
CREATE OR REPLACE FUNCTION public.default_city_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id
  FROM public.cities
  WHERE geonames_id = 964420
     OR lower(name) IN ('gqeberha', 'gqeberha (port elizabeth)')
  ORDER BY (geonames_id = 964420) DESC NULLS LAST, created_at
  LIMIT 1
$$;

COMMENT ON FUNCTION public.default_city_id() IS
  'Fallback parent city while every watch is in Gqeberha (GeoNames 964420). Removed from callers in phase P6.';

-- ---------------------------------------------------------------------------
-- Final check
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  problems text[] := ARRAY[]::text[];
  had_gq boolean;
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('countries'), ('provinces'), ('city_aliases'), ('suburb_aliases')
    ) AS t(tbl)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NULL THEN
      problems := problems || (r.tbl || ' table is missing');
    ELSIF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || r.tbl)::regclass) THEN
      problems := problems || (r.tbl || ' has no row level security');
    END IF;
    IF has_table_privilege('anon', 'public.' || r.tbl, 'INSERT') OR has_table_privilege('authenticated', 'public.' || r.tbl, 'UPDATE') THEN
      problems := problems || (r.tbl || ' is writable by clients');
    END IF;
  END LOOP;
  FOR r IN
    SELECT * FROM (VALUES
      ('cities', 'name_key'), ('cities', 'province_code'), ('cities', 'geonames_id'), ('cities', 'population'),
      ('cities', 'near_label'), ('cities', 'status'), ('suburbs', 'name_key'), ('suburbs', 'status'),
      ('suburbs', 'merged_into_id'), ('suburbs', 'requested_by')
    ) AS t(tbl, col)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.col) THEN
      problems := problems || format('%s.%s missing', r.tbl, r.col);
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.provinces WHERE country_iso2 = 'ZA') <> 9 THEN
    problems := problems || 'expected 9 provinces'::text;
  END IF;
  IF public.place_name_key('Gqeberha (Port Elizabeth)') <> 'gqeberha'
     OR public.place_name_key(' King William''s Town ') <> 'king williams town'
     OR public.place_name_key('Città del Capo') <> 'citta del capo'
     OR public.place_name_key('Bela-Bela') <> 'bela bela' THEN
    problems := problems || 'place_name_key gives unexpected keys'::text;
  END IF;
  FOR r IN SELECT * FROM (VALUES ('cities_name_key_trgm_idx'), ('city_aliases_key_trgm_idx'), ('suburbs_name_key_trgm_idx'),
                                 ('suburb_aliases_key_trgm_idx'), ('cities_geonames_id_uidx')) AS t(idx) LOOP
    IF to_regclass('public.' || r.idx) IS NULL THEN
      problems := problems || (r.idx || ' index missing');
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    WHERE con.conrelid = 'public.cities'::regclass AND con.contype = 'u'
      AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.cities'::regclass AND attname = 'name')]::int2[]
  ) THEN
    problems := problems || 'cities still has UNIQUE(name)'::text;
  END IF;
  had_gq := EXISTS (SELECT 1 FROM public.cities WHERE geonames_id = 964420);
  IF had_gq THEN
    IF public.default_city_id() IS DISTINCT FROM (SELECT id FROM public.cities WHERE geonames_id = 964420) THEN
      problems := problems || 'default_city_id() does not return Gqeberha'::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.city_aliases a JOIN public.cities c ON c.id = a.city_id
                   WHERE c.geonames_id = 964420 AND a.alias_key = 'port elizabeth' AND a.kind = 'old_name') THEN
      problems := problems || 'Port Elizabeth alias missing'::text;
    END IF;
  END IF;
  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION 'SA places schema: check failed: %', array_to_string(problems, '; ');
  END IF;
  RAISE NOTICE 'SA places schema: OK';
END
$verify$;

NOTIFY pgrst, 'reload schema';
