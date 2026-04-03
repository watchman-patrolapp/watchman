-- Track who last updated a criminal profile (displayed on cards + detail).

ALTER TABLE public.criminal_profiles
  ADD COLUMN IF NOT EXISTS updated_by text;

COMMENT ON COLUMN public.criminal_profiles.updated_by IS
  'public.users.id (as text) of member who last saved the profile; set by web app.';
