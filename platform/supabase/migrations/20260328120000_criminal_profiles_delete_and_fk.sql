-- Criminal profiles had no FOR DELETE RLS policy, so deletes affected 0 rows with no error from PostgREST.
-- Match queue rows referencing a profile blocked DELETE without CASCADE/SET NULL.

-- Creators, JWT admin claim (if used), or app users with admin/committee role
CREATE POLICY "Enable delete for creators or elevated roles"
ON criminal_profiles
FOR DELETE
USING (
  auth.uid()::text = created_by
  OR (auth.jwt() ->> 'role') = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND COALESCE(u.role::text, '') IN ('admin', 'committee')
  )
);

-- Allow profile removal when match-queue suggestions still point at it
ALTER TABLE profile_match_queue
  DROP CONSTRAINT IF EXISTS profile_match_queue_suggested_profile_id_fkey;

ALTER TABLE profile_match_queue
  ADD CONSTRAINT profile_match_queue_suggested_profile_id_fkey
  FOREIGN KEY (suggested_profile_id)
  REFERENCES criminal_profiles(id)
  ON DELETE SET NULL;
