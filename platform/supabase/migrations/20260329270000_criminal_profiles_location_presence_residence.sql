ALTER TABLE criminal_profiles
  ADD COLUMN IF NOT EXISTS common_presence text,
  ADD COLUMN IF NOT EXISTS residence_last_known text;

COMMENT ON COLUMN criminal_profiles.common_presence IS
  'Areas or venues where the subject is commonly seen (operational summary; not a legal address record).';
COMMENT ON COLUMN criminal_profiles.residence_last_known IS
  'Last known residential address or area as held on this intelligence file.';
