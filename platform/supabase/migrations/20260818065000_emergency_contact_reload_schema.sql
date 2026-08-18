-- Reload PostgREST so next-of-kin RPCs are visible after SQL-editor applies.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS emergency_contact_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship text;

DO $$
BEGIN
  IF to_regprocedure('public.list_emergency_contact_candidates()') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.list_emergency_contact_candidates() TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.list_emergency_contact_candidates() TO service_role';
  END IF;
  IF to_regprocedure('public.set_my_emergency_contact(uuid, text, text, boolean, text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.set_my_emergency_contact(uuid, text, text, boolean, text) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.set_my_emergency_contact(uuid, text, text, boolean, text) TO service_role';
  ELSIF to_regprocedure('public.set_my_emergency_contact(uuid, text, text, boolean)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.set_my_emergency_contact(uuid, text, text, boolean) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.set_my_emergency_contact(uuid, text, text, boolean) TO service_role';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
