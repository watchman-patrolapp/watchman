-- Run in Supabase SQL Editor if migration 20260329280000 was not applied.
-- Adds connection_type value: apprehended

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
      'apprehended',
      'apprehended_released'
    )
  );
