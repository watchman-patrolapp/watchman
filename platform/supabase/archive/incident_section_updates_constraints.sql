-- =============================================================================
-- incident_section_updates — full constraint reference (matches web app)
-- =============================================================================
-- Apply in Supabase SQL Editor if migrations were skipped or drift occurred.
-- After: NOTIFY pgrst, 'reload schema';  (or wait for cache refresh)
--
-- UI mapping (IncidentDetail.jsx + IncidentForm evidence categories):
--
--   Details / narrative (INCIDENT_SECTION_KEYS):
--     incident_date, location, type, description, suspect, vehicle,
--     witness, saps_case, reporting_member
--
--   Evidence tab / per-category (evidence_{slug} from EVIDENCE_CATEGORY_ORDER):
--     evidence_scene_photos, evidence_suspects, evidence_vehicles,
--     evidence_physical_evidence, evidence_documentation, evidence_contextual_intel
--
--   Legacy:
--     evidence  (old single bucket; migrate to evidence_scene_photos)
--
-- Optional column for per-exhibit notes (IncidentDetail per-entry updates):
-- =============================================================================

ALTER TABLE public.incident_section_updates
  ADD COLUMN IF NOT EXISTS target_evidence_id uuid REFERENCES public.incident_evidence (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_incident_section_updates_target_evidence
  ON public.incident_section_updates (target_evidence_id)
  WHERE target_evidence_id IS NOT NULL;

COMMENT ON COLUMN public.incident_section_updates.target_evidence_id IS
  'When set, note applies only to that incident_evidence row; null = whole section.';

ALTER TABLE public.incident_section_updates
  DROP CONSTRAINT IF EXISTS incident_section_updates_section_key_check;

ALTER TABLE public.incident_section_updates
  ADD CONSTRAINT incident_section_updates_section_key_check
  CHECK (
    section_key IN (
      'incident_date',
      'location',
      'type',
      'description',
      'suspect',
      'vehicle',
      'witness',
      'saps_case',
      'reporting_member',
      'evidence',
      'evidence_scene_photos',
      'evidence_suspects',
      'evidence_vehicles',
      'evidence_physical_evidence',
      'evidence_documentation',
      'evidence_contextual_intel'
    )
  );

UPDATE public.incident_section_updates
SET section_key = 'evidence_scene_photos'
WHERE section_key = 'evidence';

NOTIFY pgrst, 'reload schema';
