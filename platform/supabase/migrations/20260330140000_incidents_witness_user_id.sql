-- Optional link when the witness is a platform member; free-text name remains in witness_name.
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS witness_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.incidents.witness_user_id IS
  'When the witness is a platform member, references public.users; otherwise null and witness_name holds free text.';
