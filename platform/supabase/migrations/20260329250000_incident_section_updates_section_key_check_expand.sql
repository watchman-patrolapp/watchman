-- Expand section_key allowed values for per-evidence-category updates.
-- Safe if 20260329230000 already ran (replaces same constraint).

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

-- Legacy single-key rows (if any remain after prior migration).
UPDATE public.incident_section_updates
SET section_key = 'evidence_scene_photos'
WHERE section_key = 'evidence';

NOTIFY pgrst, 'reload schema';
