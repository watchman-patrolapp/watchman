-- Incident report images: bucket + policies expected by web/src/pages/IncidentForm.jsx
-- (uses .from('incident-photos') + getPublicUrl — bucket should be public OR add SELECT for anon/authenticated)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'incident-photos',
  'incident-photos',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Replace policies if you re-run this migration (idempotent for these names only)
DROP POLICY IF EXISTS "incident_photos_public_read" ON storage.objects;
DROP POLICY IF EXISTS "incident_photos_authenticated_insert" ON storage.objects;
DROP POLICY IF EXISTS "incident_photos_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "incident_photos_authenticated_delete" ON storage.objects;

CREATE POLICY "incident_photos_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'incident-photos');

CREATE POLICY "incident_photos_authenticated_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'incident-photos');

CREATE POLICY "incident_photos_authenticated_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'incident-photos')
  WITH CHECK (bucket_id = 'incident-photos');

CREATE POLICY "incident_photos_authenticated_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'incident-photos');
