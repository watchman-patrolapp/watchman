-- Optional link to one incident_evidence row (per-entry addendum within a category, e.g. suspect entry 1 vs 2).

ALTER TABLE public.incident_section_updates
  ADD COLUMN IF NOT EXISTS target_evidence_id uuid REFERENCES public.incident_evidence (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_incident_section_updates_target_evidence
  ON public.incident_section_updates (target_evidence_id)
  WHERE target_evidence_id IS NOT NULL;

COMMENT ON COLUMN public.incident_section_updates.target_evidence_id IS
  'When set, this note applies only to that evidence entry; when null, applies to the whole section/category.';
