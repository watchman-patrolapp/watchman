-- One City Hub post per incident. Share is explicit; incidents stay neighborhood-scoped.

ALTER TABLE public.city_hub_posts
  ADD COLUMN IF NOT EXISTS related_incident_id uuid REFERENCES public.incidents (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS city_hub_posts_related_incident_id_uidx
  ON public.city_hub_posts (related_incident_id)
  WHERE related_incident_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS city_hub_posts_related_incident_id_idx
  ON public.city_hub_posts (related_incident_id);

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS city_hub_post_id uuid REFERENCES public.city_hub_posts (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS city_hub_shared_at timestamptz;

COMMENT ON COLUMN public.city_hub_posts.related_incident_id IS
  'Source incident for an admin share. Unique so an incident cannot be posted twice.';
COMMENT ON COLUMN public.incidents.city_hub_post_id IS
  'City Hub post created from this incident, if shared.';
