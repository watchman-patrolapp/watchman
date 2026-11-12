-- P4a — Local services directory: taxonomy, listings, search.
-- Apply in the Supabase SQL editor (staging first). Idempotent and additive.
-- When committed, split into these migration files (do not reuse an older 20261003 prefix;
-- those would sort before already-applied 20261112 migrations):
--   platform/supabase/migrations/20261112140000_local_services_taxonomy.sql
--     (extension, categories, synonyms, RLS, grants, seed)
--   platform/supabase/migrations/20261112141000_local_services_listings_search.sql
--     (listings table, search trigger, RPCs, org-move pause trigger, grants)
-- Follows platform/docs/SQL_CONVENTIONS.md and NEW_FEATURES_BLUEPRINT.md §9.5–9.6
-- with current-repo updates: photo paths are {orgId}/services/{listingId}/… (community-media
-- is private; signed URLs on the client), organization_id from the row / working org,
-- cross-org errors raise 'not found'.
-- Owner decisions (12 Nov 2026): listings are neighbourhood-only (no city-wide UI;
-- upsert always stores serves_whole_city = false). Published phone / WhatsApp / email /
-- website are visible to every signed-in member of the same neighbourhood; consent
-- wording must match that, not "verified members only".
-- Opt-in neighbouring suburbs (same day): public.org_neighbours is an org-to-org
-- adjacency on public.organizations (Watchman NW groups). Suburb badges use
-- organizations.primary_suburb_id -> public.suburbs.name. Search always returns
-- the caller's neighbourhood; when p_include_neighbours is true it also returns
-- published listings from directly adjacent orgs (one hop, never chains) whose
-- show_to_neighbours is true. Contact numbers on those neighbour rows are only
-- returned when the provider opted in (same flag).

-- =====================================================================
-- 1) Taxonomy
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.local_service_categories (
  slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  label text NOT NULL,
  parent_slug text REFERENCES public.local_service_categories (slug) ON DELETE SET NULL,
  icon text,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.local_service_synonyms (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  term text NOT NULL CHECK (term = lower(trim(term)) AND char_length(term) BETWEEN 2 AND 40),
  canonical text NOT NULL CHECK (canonical = lower(trim(canonical))),
  category_slug text REFERENCES public.local_service_categories (slug) ON DELETE CASCADE,
  weight real NOT NULL DEFAULT 1.0,
  UNIQUE (term, canonical)
);
CREATE INDEX IF NOT EXISTS local_service_synonyms_term_trgm
  ON public.local_service_synonyms USING gin (term extensions.gin_trgm_ops);

ALTER TABLE public.local_service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_service_synonyms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS local_service_categories_read ON public.local_service_categories;
CREATE POLICY local_service_categories_read ON public.local_service_categories
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS local_service_synonyms_read ON public.local_service_synonyms;
CREATE POLICY local_service_synonyms_read ON public.local_service_synonyms
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.local_service_categories (slug, label, parent_slug, icon, sort_order) VALUES
  ('trades', 'Trades & repairs', NULL, 'FaTools', 10),
  ('food', 'Food & baking', NULL, 'FaUtensils', 20),
  ('home', 'Home & garden', NULL, 'FaHome', 30),
  ('kids-pets', 'Kids & pets', NULL, 'FaPaw', 40),
  ('health-beauty', 'Health & beauty', NULL, 'FaSpa', 50),
  ('tech', 'Tech & security', NULL, 'FaLaptop', 60),
  ('transport', 'Transport & moving', NULL, 'FaTruck', 70),
  ('events', 'Events & entertainment', NULL, 'FaGlassCheers', 80),
  ('other', 'Other', NULL, 'FaStore', 999)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.local_service_categories (slug, label, parent_slug, sort_order) VALUES
  ('plumbing', 'Plumbing', 'trades', 11),
  ('electrical', 'Electrical', 'trades', 12),
  ('welding', 'Welding & steel work', 'trades', 13),
  ('building', 'Building & renovations', 'trades', 14),
  ('painting', 'Painting', 'trades', 15),
  ('roofing', 'Roofing & waterproofing', 'trades', 16),
  ('carpentry', 'Carpentry', 'trades', 17),
  ('handyman', 'Handyman', 'trades', 18),
  ('appliance-repair', 'Appliance repair', 'trades', 19),
  ('auto', 'Mechanic & auto', 'trades', 20),
  ('locksmith', 'Locksmith & glazier', 'trades', 21),
  ('solar', 'Solar & inverters', 'trades', 22),
  ('baking', 'Cakes & baking', 'food', 23),
  ('catering', 'Catering', 'food', 24),
  ('braai-meat', 'Braai packs & butchery', 'food', 25),
  ('home-meals', 'Home-cooked meals', 'food', 26),
  ('garden', 'Garden services', 'home', 31),
  ('pool', 'Pool services', 'home', 32),
  ('cleaning', 'Cleaning', 'home', 33),
  ('pest-control', 'Pest control', 'home', 34),
  ('tutoring', 'Tutoring & lessons', 'kids-pets', 41),
  ('childcare', 'Childcare', 'kids-pets', 42),
  ('pet-care', 'Pet sitting & grooming', 'kids-pets', 43),
  ('hair-beauty', 'Hair & beauty', 'health-beauty', 51),
  ('fitness', 'Fitness', 'health-beauty', 52),
  ('it-support', 'IT & computers', 'tech', 61),
  ('cctv-alarms', 'CCTV, alarms & gates', 'tech', 62),
  ('moving', 'Moving & bakkie hire', 'transport', 71),
  ('shuttle', 'Lifts & shuttles', 'transport', 72),
  ('photography', 'Photography', 'events', 81),
  ('party-hire', 'Party & jumping castles', 'events', 82)
ON CONFLICT (slug) DO NOTHING;

-- English + SA slang + Afrikaans. Further isiXhosa terms can be added later with community input.
INSERT INTO public.local_service_synonyms (term, canonical, category_slug) VALUES
  ('plumber', 'plumbing', 'plumbing'), ('plumbing', 'plumbing', 'plumbing'), ('geyser', 'plumbing', 'plumbing'),
  ('leak', 'plumbing', 'plumbing'), ('drain', 'plumbing', 'plumbing'), ('loodgieter', 'plumbing', 'plumbing'),
  ('electrician', 'electrical', 'electrical'), ('sparky', 'electrical', 'electrical'), ('electric', 'electrical', 'electrical'),
  ('wiring', 'electrical', 'electrical'), ('coc', 'electrical', 'electrical'), ('elektrisien', 'electrical', 'electrical'),
  ('welder', 'welding', 'welding'), ('welding', 'welding', 'welding'), ('sweis', 'welding', 'welding'),
  ('burglar bars', 'welding', 'welding'), ('gate', 'welding', 'welding'), ('steel', 'welding', 'welding'),
  ('builder', 'building', 'building'), ('bricklayer', 'building', 'building'), ('tiler', 'building', 'building'),
  ('painter', 'painting', 'painting'), ('roof', 'roofing', 'roofing'), ('waterproofing', 'roofing', 'roofing'),
  ('carpenter', 'carpentry', 'carpentry'), ('handyman', 'handyman', 'handyman'), ('fix', 'handyman', 'handyman'),
  ('fridge', 'appliance', 'appliance-repair'), ('washing machine', 'appliance', 'appliance-repair'),
  ('mechanic', 'mechanic', 'auto'), ('car', 'mechanic', 'auto'), ('panelbeater', 'mechanic', 'auto'),
  ('locksmith', 'locksmith', 'locksmith'), ('glass', 'glazier', 'locksmith'), ('glazier', 'glazier', 'locksmith'),
  ('solar', 'solar', 'solar'), ('inverter', 'solar', 'solar'), ('battery', 'solar', 'solar'), ('loadshedding', 'solar', 'solar'),
  ('food', 'food', NULL), ('eat', 'food', NULL), ('kos', 'food', NULL),
  ('cake', 'baking', 'baking'), ('cakes', 'baking', 'baking'), ('baker', 'baking', 'baking'), ('koek', 'baking', 'baking'),
  ('cupcakes', 'baking', 'baking'), ('bread', 'baking', 'baking'), ('rusks', 'baking', 'baking'), ('beskuit', 'baking', 'baking'),
  ('catering', 'catering', 'catering'), ('caterer', 'catering', 'catering'),
  ('braai', 'braai', 'braai-meat'), ('meat', 'braai', 'braai-meat'), ('boerewors', 'braai', 'braai-meat'),
  ('butcher', 'braai', 'braai-meat'), ('vleis', 'braai', 'braai-meat'), ('wood', 'braai', 'braai-meat'),
  ('meals', 'meals', 'home-meals'), ('lunch', 'meals', 'home-meals'), ('dinner', 'meals', 'home-meals'),
  ('garden', 'garden', 'garden'), ('gardener', 'garden', 'garden'), ('tuinier', 'garden', 'garden'), ('lawn', 'garden', 'garden'),
  ('tree', 'garden', 'garden'), ('pool', 'pool', 'pool'), ('cleaner', 'cleaning', 'cleaning'), ('domestic', 'cleaning', 'cleaning'),
  ('pest', 'pest', 'pest-control'), ('termites', 'pest', 'pest-control'),
  ('tutor', 'tutoring', 'tutoring'), ('maths', 'tutoring', 'tutoring'), ('math', 'tutoring', 'tutoring'),
  ('lessons', 'tutoring', 'tutoring'), ('teacher', 'tutoring', 'tutoring'),
  ('babysitter', 'childcare', 'childcare'), ('creche', 'childcare', 'childcare'),
  ('dog', 'pets', 'pet-care'), ('cat', 'pets', 'pet-care'), ('grooming', 'pets', 'pet-care'), ('dog walker', 'pets', 'pet-care'),
  ('hair', 'hair', 'hair-beauty'), ('nails', 'beauty', 'hair-beauty'), ('barber', 'hair', 'hair-beauty'),
  ('computer', 'it', 'it-support'), ('laptop', 'it', 'it-support'), ('wifi', 'it', 'it-support'), ('fibre', 'it', 'it-support'),
  ('cctv', 'cctv', 'cctv-alarms'), ('camera', 'cctv', 'cctv-alarms'), ('alarm', 'alarm', 'cctv-alarms'),
  ('electric fence', 'alarm', 'cctv-alarms'), ('gate motor', 'alarm', 'cctv-alarms'),
  ('bakkie', 'moving', 'moving'), ('removals', 'moving', 'moving'), ('movers', 'moving', 'moving'),
  ('lift', 'shuttle', 'shuttle'), ('airport', 'shuttle', 'shuttle'), ('school run', 'shuttle', 'shuttle'),
  ('photographer', 'photography', 'photography'), ('jumping castle', 'party', 'party-hire'), ('party', 'party', 'party-hire')
ON CONFLICT (term, canonical) DO NOTHING;

REVOKE INSERT, UPDATE, DELETE ON public.local_service_categories, public.local_service_synonyms FROM anon, authenticated;
GRANT SELECT ON public.local_service_categories, public.local_service_synonyms TO authenticated;
GRANT ALL ON public.local_service_categories, public.local_service_synonyms TO service_role;

