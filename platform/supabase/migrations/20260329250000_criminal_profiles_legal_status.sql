-- Structured legal / prosecution context for intelligence records (not a substitute for court or SAPS dockets).
ALTER TABLE criminal_profiles
  ADD COLUMN IF NOT EXISTS conviction_history_summary text,
  ADD COLUMN IF NOT EXISTS criminal_justice_status text;

ALTER TABLE criminal_profiles
  DROP CONSTRAINT IF EXISTS criminal_profiles_conviction_history_summary_check;

ALTER TABLE criminal_profiles
  ADD CONSTRAINT criminal_profiles_conviction_history_summary_check
  CHECK (
    conviction_history_summary IS NULL
    OR conviction_history_summary IN (
      'unknown',
      'none_known_on_file',
      'prior_convictions_verified',
      'prior_convictions_alleged_unverified'
    )
  );

ALTER TABLE criminal_profiles
  DROP CONSTRAINT IF EXISTS criminal_profiles_criminal_justice_status_check;

ALTER TABLE criminal_profiles
  ADD CONSTRAINT criminal_profiles_criminal_justice_status_check
  CHECK (
    criminal_justice_status IS NULL
    OR criminal_justice_status IN (
      'unknown',
      'no_open_matters_known',
      'subject_active_investigation',
      'charged_awaiting_trial',
      'trial_or_hearing_pending',
      'on_bail_or_court_supervision',
      'post_conviction_sentencing_pending',
      'appeal_or_review_pending',
      'criminal_matters_concluded'
    )
  );

COMMENT ON COLUMN criminal_profiles.conviction_history_summary IS 'Summary of what this file records about prior convictions; operational intelligence only.';
COMMENT ON COLUMN criminal_profiles.criminal_justice_status IS 'Open or recent criminal-justice process stage as known to the watch; not legal status advice.';
