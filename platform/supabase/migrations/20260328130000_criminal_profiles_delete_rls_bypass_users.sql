-- DELETE policy used EXISTS (SELECT ... FROM users). If `users` has RLS, that subquery often
-- cannot see the row and the policy fails for everyone except strict creator JWT match.
-- SECURITY DEFINER helper reads users as the function owner (bypasses users RLS for this check only).

DROP POLICY IF EXISTS "Enable delete for creators or elevated roles" ON criminal_profiles;
DROP POLICY IF EXISTS "Enable delete for creators or admins" ON criminal_profiles;

CREATE OR REPLACE FUNCTION public.can_delete_criminal_profile(p_created_by text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    coalesce(trim(both from p_created_by), '') = auth.uid()::text
    OR EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND coalesce(lower(u.role::text), '') IN ('admin', 'committee')
    )
    OR coalesce(auth.jwt() ->> 'role', '') = 'admin';
$$;

REVOKE ALL ON FUNCTION public.can_delete_criminal_profile(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_delete_criminal_profile(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_delete_criminal_profile(text) TO service_role;

CREATE POLICY "Enable delete for creators or elevated roles"
ON criminal_profiles
FOR DELETE
USING (public.can_delete_criminal_profile(created_by));
