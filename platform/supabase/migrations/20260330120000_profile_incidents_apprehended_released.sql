-- Link type: subject was apprehended/handled to SAPS then released (bail, warning, no charge, etc.).

ALTER TABLE public.profile_incidents
  DROP CONSTRAINT IF EXISTS profile_incidents_connection_type_check;

ALTER TABLE public.profile_incidents
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
      'apprehended',
      'apprehended_released'
    )
  );

COMMENT ON COLUMN public.profile_incidents.connection_type IS
  'Operational relation to the incident. apprehended = detained/handover to police in connection with this matter (may still be out later). apprehended_released = same but subject later released (bail, etc.). Not a court finding.';
