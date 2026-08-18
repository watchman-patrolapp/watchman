-- Live neighbourhood notices on Home without a page reload.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'area_broadcasts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.area_broadcasts;
  END IF;
END $$;
