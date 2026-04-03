-- Expand connection_type for apprehended-in-custody reporting (operational intelligence, not legal status).
ALTER TABLE profile_incidents
  DROP CONSTRAINT IF EXISTS profile_incidents_connection_type_check;

ALTER TABLE profile_incidents
  ADD CONSTRAINT profile_incidents_connection_type_check
  CHECK (
    connection_type IS NULL
    OR connection_type IN (
      'confirmed_perpetrator',
      'probable_suspect',
      'person_of_interest',
      'witness',
      'associate_present',
      'victim',
      'false_positive',
      'apprehended'
    )
  );

COMMENT ON COLUMN profile_incidents.confidence_score IS
  'Optional 1–100 analyst-assessed strength of the profile–incident link (evidence/ID/corroboration); not a legal finding.';
COMMENT ON COLUMN profile_incidents.connection_type IS
  'Operational classification of the subject''s relation to the incident; apprehended = taken into custody/handled to police in connection with this matter.';
