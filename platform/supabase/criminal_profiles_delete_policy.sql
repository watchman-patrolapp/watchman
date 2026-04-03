-- Paste this entire file into Supabase Dashboard → SQL Editor → Run.
-- Do not paste the filename or path as SQL.

DROP POLICY IF EXISTS "Enable delete for creators or elevated roles" ON criminal_profiles;
DROP POLICY IF EXISTS "Enable delete for creators or admins" ON criminal_profiles;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON criminal_profiles;

DROP FUNCTION IF EXISTS public.can_delete_criminal_profile(text);

CREATE POLICY "Enable delete for authenticated users"
ON criminal_profiles
FOR DELETE
TO authenticated
USING (auth.role() = 'authenticated');
