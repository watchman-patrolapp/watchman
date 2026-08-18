-- Allow PDFs on the City Hub attachments bucket and store named document links.

ALTER TABLE public.city_hub_posts
  ADD COLUMN IF NOT EXISTS document_attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.city_hub_posts.document_attachments IS
  'JSON array of {url, name} for PDF files attached to a City Hub post.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'city-hub-photos',
  'city-hub-photos',
  true,
  20971520,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'application/pdf'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "city_hub_photos_public_read" ON storage.objects;
DROP POLICY IF EXISTS "city_hub_photos_authenticated_insert" ON storage.objects;
DROP POLICY IF EXISTS "city_hub_photos_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "city_hub_photos_authenticated_delete" ON storage.objects;

CREATE POLICY "city_hub_photos_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'city-hub-photos');

CREATE POLICY "city_hub_photos_authenticated_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'city-hub-photos');

CREATE POLICY "city_hub_photos_authenticated_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'city-hub-photos')
  WITH CHECK (bucket_id = 'city-hub-photos');

CREATE POLICY "city_hub_photos_authenticated_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'city-hub-photos');
