-- Roll-up gallery for list/moderation/print views; optional FK from suspect row to evidence row
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS media_urls text[] DEFAULT '{}';

UPDATE public.incidents
SET media_urls = '{}'
WHERE media_urls IS NULL;

ALTER TABLE public.incident_suspects
  ADD COLUMN IF NOT EXISTS evidence_id uuid REFERENCES public.incident_evidence(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.incidents.media_urls IS 'Aggregated public URLs for all photos attached to this incident (synced on submit).';
COMMENT ON COLUMN public.incident_suspects.evidence_id IS 'Structured suspect evidence row this suspect record was derived from.';
