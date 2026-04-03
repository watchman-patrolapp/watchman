-- No schema change: both FKs already use ON DELETE CASCADE (see 20250327000002_criminal_intelligence_system.sql).
-- When a criminal_profiles row is deleted, every profile_associates row referencing that id (as profile_id OR associate_profile_id) is removed automatically.

COMMENT ON TABLE profile_associates IS
  'Directed link: profile_id created the association toward associate_profile_id. Either endpoint delete cascades and removes the row. UIs may show the edge on both profiles without inserting a reciprocal row.';
