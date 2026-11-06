-- FINAL private-media step. Apply this last, after all of the following:
--   1. 20261106210000_private_media_read_policies_and_copy_registry.sql
--   2. The web app that signs incident, community, and City Hub media is deployed
--   3. 20261106215000_private_media_store_paths.sql
--   4. node scripts/backfill-city-hub-media-copies.mjs --apply
--      (from platform/web; see platform/docs/PRIVATE_MEDIA_COPY_ON_SHARE.md)
--
-- Until this file runs, the three buckets stay public and old public URLs
-- still open. After it runs, only a signed URL works, and anon cannot read them.

UPDATE storage.buckets
SET public = false
WHERE id IN ('incident-photos', 'community-media', 'city-hub-photos')
  AND public IS DISTINCT FROM false;

DO $verify$
DECLARE
  v_missing int;
  v_public int;
BEGIN
  SELECT count(*) INTO v_missing
  FROM (VALUES ('incident-photos'), ('community-media'), ('city-hub-photos')) AS expected(id)
  WHERE NOT EXISTS (
    SELECT 1 FROM storage.buckets b WHERE b.id = expected.id
  );

  SELECT count(*) INTO v_public
  FROM storage.buckets
  WHERE id IN ('incident-photos', 'community-media', 'city-hub-photos')
    AND public IS TRUE;

  IF v_missing <> 0 OR v_public <> 0 THEN
    RAISE EXCEPTION 'private media bucket flip did not land (missing %, still public %)', v_missing, v_public;
  END IF;
END
$verify$;
