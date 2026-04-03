-- Per evidence-category section keys (Scene evidence, Suspect profiles, etc.)

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

-- Older single "evidence" updates: show under Scene evidence (most common narrative).
UPDATE public.incident_section_updates
SET section_key = 'evidence_scene_photos'
WHERE section_key = 'evidence';
