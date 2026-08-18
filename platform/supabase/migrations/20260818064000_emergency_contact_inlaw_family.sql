-- Add in-law and family to next-of-kin relationship options.
-- Safe to run even if 20260818063000 was not applied yet.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship text;

CREATE OR REPLACE FUNCTION public.normalize_emergency_contact_relationship(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE replace(replace(lower(trim(coalesce(p_value, ''))), '-', '_'), ' ', '_')
    WHEN 'spouse' THEN 'spouse'
    WHEN 'partner' THEN 'spouse'
    WHEN 'husband' THEN 'spouse'
    WHEN 'wife' THEN 'spouse'
    WHEN 'parent' THEN 'parent'
    WHEN 'mother' THEN 'parent'
    WHEN 'father' THEN 'parent'
    WHEN 'child' THEN 'child'
    WHEN 'son' THEN 'child'
    WHEN 'daughter' THEN 'child'
    WHEN 'sibling' THEN 'sibling'
    WHEN 'brother' THEN 'sibling'
    WHEN 'sister' THEN 'sibling'
    WHEN 'in_law' THEN 'in_law'
    WHEN 'inlaw' THEN 'in_law'
    WHEN 'in_laws' THEN 'in_law'
    WHEN 'inlaws' THEN 'in_law'
    WHEN 'mother_in_law' THEN 'in_law'
    WHEN 'father_in_law' THEN 'in_law'
    WHEN 'son_in_law' THEN 'in_law'
    WHEN 'daughter_in_law' THEN 'in_law'
    WHEN 'brother_in_law' THEN 'in_law'
    WHEN 'sister_in_law' THEN 'in_law'
    WHEN 'family' THEN 'family'
    WHEN 'relative' THEN 'family'
    WHEN 'relatives' THEN 'family'
    WHEN 'aunt' THEN 'family'
    WHEN 'uncle' THEN 'family'
    WHEN 'cousin' THEN 'family'
    WHEN 'grandparent' THEN 'family'
    WHEN 'grandchild' THEN 'family'
    WHEN 'neighbour' THEN 'neighbour'
    WHEN 'neighbor' THEN 'neighbour'
    WHEN 'friend' THEN 'friend'
    WHEN 'other' THEN 'other'
    ELSE NULL
  END;
$$;

COMMENT ON COLUMN public.users.emergency_contact_relationship IS
  'Optional next-of-kin relationship: spouse, parent, child, sibling, in_law, family, neighbour, friend, other.';

NOTIFY pgrst, 'reload schema';
