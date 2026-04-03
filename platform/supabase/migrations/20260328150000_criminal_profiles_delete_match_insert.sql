-- Same SQL as ../criminal_profiles_delete_policy.sql (for CLI migrations).
-- To run manually: open that file, copy all SQL, paste into Supabase SQL Editor.

DROP POLICY IF EXISTS "Enable delete for creators or elevated roles" ON criminal_profiles;
DROP POLICY IF EXISTS "Enable delete for creators or admins" ON criminal_profiles;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON criminal_profiles;

DROP FUNCTION IF EXISTS public.can_delete_criminal_profile(text);

CREATE POLICY "Enable delete for authenticated users"
ON criminal_profiles
FOR DELETE
TO authenticated
USING (auth.role() = 'authenticated');
