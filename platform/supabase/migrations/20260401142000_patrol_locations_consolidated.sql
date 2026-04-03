-- Consolidates former web/supabase/migrations patrol GPS pieces into the canonical supabase/migrations chain.
-- Safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS).

CREATE TABLE IF NOT EXISTS public.patrol_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patrol_id uuid NOT NULL REFERENCES public.active_patrols (user_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  accuracy double precision DEFAULT 0,
  altitude double precision,
  speed double precision,
  heading double precision,
  "timestamp" timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  is_archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_patrol_locations_patrol_id ON public.patrol_locations (patrol_id);
CREATE INDEX IF NOT EXISTS idx_patrol_locations_user_id ON public.patrol_locations (user_id);
CREATE INDEX IF NOT EXISTS idx_patrol_locations_timestamp ON public.patrol_locations ("timestamp");
CREATE INDEX IF NOT EXISTS idx_patrol_locations_deleted_at ON public.patrol_locations (deleted_at);

ALTER TABLE public.patrol_locations
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

ALTER TABLE public.patrol_locations
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE TABLE IF NOT EXISTS public.patrol_locations_archive (
  id uuid PRIMARY KEY,
  patrol_id uuid NOT NULL,
  user_id uuid NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  accuracy double precision DEFAULT 0,
  altitude double precision,
  speed double precision,
  heading double precision,
  "timestamp" timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  deleted_at timestamptz,
  original_id uuid,
  archived_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.patrol_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own patrol locations" ON public.patrol_locations;
CREATE POLICY "Users can view their own patrol locations" ON public.patrol_locations
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own patrol locations" ON public.patrol_locations;
CREATE POLICY "Users can insert their own patrol locations" ON public.patrol_locations
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own patrol locations" ON public.patrol_locations;
CREATE POLICY "Users can update their own patrol locations" ON public.patrol_locations
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own patrol locations" ON public.patrol_locations;
CREATE POLICY "Users can delete their own patrol locations" ON public.patrol_locations
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins and committee can view all patrol locations" ON public.patrol_locations;
CREATE POLICY "Admins and committee can view all patrol locations" ON public.patrol_locations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND lower(trim(u.role::text)) IN ('admin', 'committee')
    )
  );

GRANT ALL ON TABLE public.patrol_locations TO authenticated;

ALTER TABLE public.patrol_locations_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own archived patrol locations" ON public.patrol_locations_archive;
CREATE POLICY "Users can view their own archived patrol locations" ON public.patrol_locations_archive
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT ON TABLE public.patrol_locations_archive TO authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'patrol_routes'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS "Admins and committee can view all patrol routes" ON public.patrol_routes';
    EXECUTE $p$
      CREATE POLICY "Admins and committee can view all patrol routes"
      ON public.patrol_routes
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid()
            AND lower(trim(u.role::text)) IN ('admin', 'committee')
        )
      )
    $p$;
  END IF;
END $$;

UPDATE public.patrol_locations
SET "timestamp" = created_at
WHERE created_at IS NOT NULL
  AND (
    "timestamp" IS NULL
    OR "timestamp" IS DISTINCT FROM created_at
  );
