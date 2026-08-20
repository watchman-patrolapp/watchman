-- Stop public Storage listing on CDN buckets.
-- Public object URLs (getPublicUrl) keep working without SELECT on storage.objects.
-- incident-photos keeps authenticated SELECT so admin delete can list a folder to clean up.

-- ---------------------------------------------------------------------------
-- Drop broad public/anon listing policies (named in advisor)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "avatars_select" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read" ON storage.objects;
DROP POLICY IF EXISTS "Chat media is publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "city_hub_photos_public_read" ON storage.objects;
DROP POLICY IF EXISTS "emergency_directory_public_read" ON storage.objects;
DROP POLICY IF EXISTS "incident_photos_public_read" ON storage.objects;
DROP POLICY IF EXISTS "security_branding_public_read" ON storage.objects;

-- ---------------------------------------------------------------------------
-- incident-photos: signed-in staff/helpers may list (folder cleanup on delete)
-- Extra predicate avoids the "bucket-only" listing lint for public buckets.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "incident_photos_authenticated_select" ON storage.objects;

CREATE POLICY "incident_photos_authenticated_select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'incident-photos'
    AND (
      public.is_global_app_staff()
      OR public.is_platform_staff()
      OR public.can_moderate_incidents()
      OR public.is_admin_or_committee()
    )
  );
