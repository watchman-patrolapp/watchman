-- Append-only per-section narrative updates on incidents (original row unchanged).
-- UI shows original as read-only baseline; updates stored here with author snapshot.

CREATE TABLE IF NOT EXISTS public.incident_section_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.incidents (id) ON DELETE CASCADE,
  section_key text NOT NULL CHECK (
    section_key IN (
      'incident_date',
      'location',
      'type',
      'description',
      'suspect',
      'vehicle',
      'witness',
      'saps_case',
      'reporting_member',
      'evidence'
    )
  ),
  body text NOT NULL CHECK (char_length(trim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  author_name text NOT NULL DEFAULT 'Member',
  author_role text NOT NULL DEFAULT 'volunteer'
);

CREATE INDEX IF NOT EXISTS idx_incident_section_updates_incident
  ON public.incident_section_updates (incident_id, section_key, created_at);

COMMENT ON TABLE public.incident_section_updates IS
  'Append-only section notes; does not modify incidents row. author_* set at insert from public.users.';

CREATE OR REPLACE FUNCTION public.incident_section_updates_set_author()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    SELECT
      COALESCE(NULLIF(trim(u.full_name), ''), 'Member'),
      COALESCE(NULLIF(trim(lower(u.role::text)), ''), 'volunteer')
    INTO NEW.author_name, NEW.author_role
    FROM public.users u
    WHERE u.id = NEW.created_by;
  END IF;
  IF NEW.author_name IS NULL OR NEW.author_name = '' THEN
    NEW.author_name := 'Member';
  END IF;
  IF NEW.author_role IS NULL OR NEW.author_role = '' THEN
    NEW.author_role := 'volunteer';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_incident_section_updates_set_author ON public.incident_section_updates;
CREATE TRIGGER trg_incident_section_updates_set_author
  BEFORE INSERT ON public.incident_section_updates
  FOR EACH ROW
  EXECUTE FUNCTION public.incident_section_updates_set_author();

ALTER TABLE public.incident_section_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY incident_section_updates_select_authenticated
  ON public.incident_section_updates
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY incident_section_updates_insert_elevated
  ON public.incident_section_updates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND lower(trim(u.role::text)) IN (
          'admin',
          'committee',
          'patroller',
          'investigator'
        )
    )
  );

GRANT SELECT, INSERT ON public.incident_section_updates TO authenticated;
