-- Display names for criminal_profiles.created_by / updated_by on intelligence cards.
-- Direct SELECT on public.users is often restricted by RLS to the signed-in row only.

CREATE OR REPLACE FUNCTION public.user_labels_for_audit(p_user_ids text[])
RETURNS TABLE (id uuid, full_name text, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT u.id, u.full_name, u.email::text
  FROM public.users u
  WHERE EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_user_ids, ARRAY[]::text[])) AS t(raw_id)
    WHERE u.id::text = trim(both FROM t.raw_id)
  );
$$;

REVOKE ALL ON FUNCTION public.user_labels_for_audit(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_labels_for_audit(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_labels_for_audit(text[]) TO service_role;

COMMENT ON FUNCTION public.user_labels_for_audit(text[]) IS
  'Returns id, full_name, email for user UUID strings; used for profile audit UI. Bypasses users RLS.';
