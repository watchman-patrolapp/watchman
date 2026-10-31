-- P0b (2/2) - Org-scoped community storage buckets. NEW_FEATURES_BLUEPRINT sections 5.3, 5.6, 12.7.
--
-- Purely additive:
--   * Creates buckets community-media (public URL, no listing) and community-private (signed URLs)
--     with INSERT ... ON CONFLICT DO NOTHING, so an existing bucket is never changed.
--   * Creates 3 new storage.objects policies (only these are dropped-if-exists first).
--     No existing bucket or policy is touched.
-- Helpers (G4, 20261021004000): try_uuid, storage_path_org_id, storage_path_in_caller_org.
-- can_moderate_resident_content comes from 20261031020000 (run that file first).
-- The community-private SELECT policy ships with the P3 equipment migration
-- (needs can_manage_equipment / is_equipment_member). Until then only service_role / signed
-- URLs created server-side can read community-private.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('community-media', 'community-media', true, 8388608,
   ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]),
  ('community-private', 'community-private', false, 10485760,
   ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[])
ON CONFLICT (id) DO NOTHING;

-- community-media: public URL read (no SELECT policy => no listing), writes only inside
-- the caller's own org folder; delete own files, or moderators of that org.
DROP POLICY IF EXISTS "community_media_insert_org" ON storage.objects;
CREATE POLICY "community_media_insert_org" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'community-media' AND public.storage_path_in_caller_org(name));

DROP POLICY IF EXISTS "community_media_delete_owner_or_mod" ON storage.objects;
CREATE POLICY "community_media_delete_owner_or_mod" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'community-media'
    AND public.storage_path_in_caller_org(name)
    AND (
      owner_id = (SELECT auth.uid())::text
      OR public.can_moderate_resident_content(public.storage_path_org_id(name))
    )
  );

-- community-private: write only inside the caller's own org folder.
DROP POLICY IF EXISTS "community_private_insert_org" ON storage.objects;
CREATE POLICY "community_private_insert_org" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'community-private' AND public.storage_path_in_caller_org(name));

-- ---------------------------------------------------------------------------
-- Verification (run manually in the SQL editor; read-only)
-- ---------------------------------------------------------------------------
-- PRE-CHECKS (before applying):
--   SELECT id FROM storage.buckets WHERE id IN ('community-media','community-private');  -- 0 rows
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
--   WHERE p.proname IN ('try_uuid','storage_path_org_id','storage_path_in_caller_org','can_moderate_resident_content');  -- 4 rows
--   SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';  -- note N
--   SELECT count(*) FROM storage.objects;  -- note M
--
-- POST-CHECKS (after applying):
--   SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets
--   WHERE id IN ('community-media','community-private');  -- 2 rows: media public=true, private public=false
--   SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
--     AND policyname LIKE 'community_%';  -- 3 rows (2 INSERT, 1 DELETE)
--   SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';  -- N + 3
--   SELECT count(*) FROM storage.objects;  -- M (unchanged)
