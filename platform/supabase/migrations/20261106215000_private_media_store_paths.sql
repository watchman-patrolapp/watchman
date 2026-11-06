-- Store object paths instead of public storage URLs.
-- Files are not downloaded or uploaded. This only rewrites text that already
-- points at an object. Apply after the signing app is deployed and after
-- 20261106210000. Apply 20261106220000 (the bucket flip) last.
--
-- wishlist_ledger_entries is append-only, so receipt_path is not rewritten.
-- The app accepts either a legacy public URL or a path for that column.

CREATE OR REPLACE FUNCTION public.storage_percent_decode(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  i int := 1;
  n int;
  out text := '';
  hex text;
  piece text;
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;
  n := char_length(p_value);
  WHILE i <= n LOOP
    piece := NULL;
    IF substring(p_value FROM i FOR 1) = '%' AND i + 2 <= n THEN
      hex := substring(p_value FROM i + 1 FOR 2);
      IF hex ~ '^[0-9A-Fa-f]{2}$' THEN
        BEGIN
          piece := convert_from(decode(hex, 'hex'), 'UTF8');
        EXCEPTION WHEN others THEN
          piece := NULL;
        END;
      END IF;
    END IF;
    IF piece IS NOT NULL THEN
      out := out || piece;
      i := i + 3;
    ELSE
      out := out || substring(p_value FROM i FOR 1);
      i := i + 1;
    END IF;
  END LOOP;
  RETURN out;
END;
$$;

CREATE OR REPLACE FUNCTION public.storage_reference_to_path(p_bucket text, p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text;
  marker text;
  prefix text;
  raw text;
BEGIN
  IF p_bucket IS NULL OR btrim(p_bucket) = '' OR p_value IS NULL THEN
    RETURN NULL;
  END IF;
  v := btrim(p_value);
  IF v = '' OR left(v, 5) = 'blob:' OR left(v, 5) = 'data:' THEN
    RETURN NULL;
  END IF;
  v := split_part(split_part(v, '#', 1), '?', 1);
  marker := '/' || p_bucket || '/';
  prefix := p_bucket || '/';
  IF position(marker IN v) > 0 THEN
    raw := regexp_replace(v, '^.*' || marker, '');
  ELSIF left(v, char_length(prefix)) = prefix THEN
    raw := substring(v FROM char_length(prefix) + 1);
  ELSIF v ~* '^[a-z][a-z0-9+.-]*:' THEN
    RETURN btrim(p_value);
  ELSE
    raw := regexp_replace(v, '^/+', '');
  END IF;
  raw := public.storage_percent_decode(raw);
  IF raw IS NULL OR btrim(raw) = '' OR left(raw, 1) = '/'
     OR position('..' IN raw) > 0
     OR position(chr(92) IN raw) > 0
     OR position(chr(0) IN raw) > 0 THEN
    RETURN NULL;
  END IF;
  RETURN raw;
END;
$$;

CREATE OR REPLACE FUNCTION public.storage_rewrite_text_array(p_bucket text, p_values text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(array_agg(converted ORDER BY ord), ARRAY[]::text[])
  FROM (
    SELECT t.ord, public.storage_reference_to_path(p_bucket, t.u) AS converted
    FROM unnest(COALESCE(p_values, ARRAY[]::text[])) WITH ORDINALITY AS t(u, ord)
  ) s
  WHERE converted IS NOT NULL AND btrim(converted) <> '';
$$;

CREATE OR REPLACE FUNCTION public.storage_rewrite_attachment_urls(p_bucket text, p_docs jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(jsonb_agg(rewritten ORDER BY ord), '[]'::jsonb)
  FROM (
    SELECT
      t.ord,
      CASE
        WHEN jsonb_typeof(t.elem) = 'object' THEN
          CASE
            WHEN public.storage_reference_to_path(p_bucket, t.elem->>'url') IS NULL THEN NULL
            ELSE jsonb_set(
              t.elem,
              '{url}',
              to_jsonb(public.storage_reference_to_path(p_bucket, t.elem->>'url')),
              true
            )
          END
        WHEN jsonb_typeof(t.elem) = 'string' THEN
          CASE
            WHEN public.storage_reference_to_path(p_bucket, t.elem #>> '{}') IS NULL THEN NULL
            ELSE to_jsonb(public.storage_reference_to_path(p_bucket, t.elem #>> '{}'))
          END
        ELSE t.elem
      END AS rewritten
    FROM jsonb_array_elements(COALESCE(p_docs, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
  ) s
  WHERE rewritten IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.storage_percent_decode(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.storage_reference_to_path(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.storage_rewrite_text_array(text, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.storage_rewrite_attachment_urls(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_percent_decode(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_reference_to_path(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_rewrite_text_array(text, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_rewrite_attachment_urls(text, jsonb) TO authenticated, service_role;

-- Incident and evidence photos. Existing files stay in incident-photos.
UPDATE public.incidents
SET media_urls = public.storage_rewrite_text_array('incident-photos', media_urls)
WHERE media_urls IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(media_urls) AS u
    WHERE u LIKE '%/incident-photos/%' OR u ~* '^[a-z][a-z0-9+.-]*:'
  );

UPDATE public.incident_evidence
SET media_urls = public.storage_rewrite_text_array('incident-photos', media_urls)
WHERE media_urls IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(media_urls) AS u
    WHERE u LIKE '%/incident-photos/%' OR u ~* '^[a-z][a-z0-9+.-]*:'
  );

DO $suspects$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'incident_suspects'
      AND column_name = 'photo_urls'
  ) THEN
    UPDATE public.incident_suspects
    SET photo_urls = public.storage_rewrite_text_array('incident-photos', photo_urls)
    WHERE photo_urls IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM unnest(photo_urls) AS u
        WHERE u LIKE '%/incident-photos/%' OR u ~* '^[a-z][a-z0-9+.-]*:'
      );
  END IF;
END
$suspects$;

-- Profiles sometimes keep an incident photo reference. Prefix the bucket so the
-- app can tell it from a criminal-photos path. Criminal-photos URLs stay as they are.
UPDATE public.criminal_profiles AS cp
SET photo_urls = (
  SELECT COALESCE(
    array_agg(
      CASE
        WHEN u LIKE '%/incident-photos/%' THEN
          'incident-photos/' || public.storage_reference_to_path('incident-photos', u)
        ELSE u
      END
      ORDER BY ord
    ),
    ARRAY[]::text[]
  )
  FROM unnest(COALESCE(cp.photo_urls, ARRAY[]::text[])) WITH ORDINALITY AS t(u, ord)
  WHERE u IS NOT NULL AND btrim(u) <> ''
)
WHERE cp.photo_urls IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(cp.photo_urls) AS u
    WHERE u LIKE '%/incident-photos/%'
  );

-- City Hub files are already in city-hub-photos. Store the path.
UPDATE public.city_hub_posts
SET photo_urls = public.storage_rewrite_text_array('city-hub-photos', photo_urls)
WHERE photo_urls IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(photo_urls) AS u
    WHERE u LIKE '%/city-hub-photos/%' OR u ~* '^[a-z][a-z0-9+.-]*:'
  );

UPDATE public.city_hub_posts
SET document_attachments = public.storage_rewrite_attachment_urls('city-hub-photos', document_attachments)
WHERE document_attachments IS NOT NULL
  AND document_attachments::text LIKE '%/city-hub-photos/%';

-- Community catalogue paths are usually already paths. Rewrite any full URLs.
UPDATE public.equipment_items
SET photo_path = public.storage_reference_to_path('community-media', photo_path)
WHERE photo_path LIKE '%/community-media/%'
  AND public.storage_reference_to_path('community-media', photo_path) IS NOT NULL;

UPDATE public.equipment_items
SET photo_paths = public.storage_rewrite_text_array('community-media', photo_paths)
WHERE photo_paths IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(photo_paths) AS u
    WHERE u LIKE '%/community-media/%'
  );

UPDATE public.equipment_units
SET photo_path = public.storage_reference_to_path('community-media', photo_path)
WHERE photo_path LIKE '%/community-media/%'
  AND public.storage_reference_to_path('community-media', photo_path) IS NOT NULL;

UPDATE public.equipment_wishlist_items
SET photo_path = public.storage_reference_to_path('community-media', photo_path)
WHERE photo_path LIKE '%/community-media/%'
  AND public.storage_reference_to_path('community-media', photo_path) IS NOT NULL
  AND char_length(public.storage_reference_to_path('community-media', photo_path)) <= 300;

COMMENT ON COLUMN public.incidents.media_urls IS
  'Object paths in incident-photos. The app signs them for members of the owning organization.';
COMMENT ON COLUMN public.city_hub_posts.photo_urls IS
  'Object paths in city-hub-photos for copies and files uploaded on the post.';
COMMENT ON COLUMN public.city_hub_posts.document_attachments IS
  'JSON array of {url, name}. url is an object path in city-hub-photos.';

DO $verify$
DECLARE
  v_sample text := 'https://example.supabase.co/storage/v1/object/public/incident-photos/11111111-1111-4111-8111-111111111111/scene.jpg';
  v_path text;
  v_left int;
BEGIN
  v_path := public.storage_reference_to_path('incident-photos', v_sample);
  IF v_path IS DISTINCT FROM '11111111-1111-4111-8111-111111111111/scene.jpg' THEN
    RAISE EXCEPTION 'private media paths: parser did not land (%)', COALESCE(v_path, 'null');
  END IF;
  IF public.storage_reference_to_path('incident-photos', v_path) IS DISTINCT FROM v_path THEN
    RAISE EXCEPTION 'private media paths: parser is not stable';
  END IF;
  IF public.storage_reference_to_path(
       'incident-photos',
       'https://example.supabase.co/storage/v1/object/public/incident-photos/../secret.jpg'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'private media paths: dot-dot path was accepted';
  END IF;

  SELECT count(*) INTO v_left
  FROM (
    SELECT u AS val
    FROM public.incidents i
    CROSS JOIN LATERAL unnest(COALESCE(i.media_urls, ARRAY[]::text[])) AS u
    WHERE u LIKE '%/object/public/incident-photos/%'
       OR u LIKE '%/object/sign/incident-photos/%'
    UNION ALL
    SELECT u
    FROM public.incident_evidence e
    CROSS JOIN LATERAL unnest(COALESCE(e.media_urls, ARRAY[]::text[])) AS u
    WHERE u LIKE '%/object/public/incident-photos/%'
       OR u LIKE '%/object/sign/incident-photos/%'
    UNION ALL
    SELECT u
    FROM public.city_hub_posts p
    CROSS JOIN LATERAL unnest(COALESCE(p.photo_urls, ARRAY[]::text[])) AS u
    WHERE u LIKE '%/object/public/city-hub-photos/%'
       OR u LIKE '%/object/sign/city-hub-photos/%'
    UNION ALL
    SELECT photo_path
    FROM public.equipment_items
    WHERE photo_path LIKE '%/object/public/community-media/%'
       OR photo_path LIKE '%/object/sign/community-media/%'
    UNION ALL
    SELECT u
    FROM public.equipment_items i
    CROSS JOIN LATERAL unnest(COALESCE(i.photo_paths, ARRAY[]::text[])) AS u
    WHERE u LIKE '%/object/public/community-media/%'
       OR u LIKE '%/object/sign/community-media/%'
    UNION ALL
    SELECT photo_path
    FROM public.equipment_wishlist_items
    WHERE photo_path LIKE '%/object/public/community-media/%'
       OR photo_path LIKE '%/object/sign/community-media/%'
  ) q;

  IF v_left <> 0 THEN
    RAISE EXCEPTION 'private media paths: % stored public URLs were not rewritten', v_left;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.criminal_profiles cp
    CROSS JOIN LATERAL unnest(COALESCE(cp.photo_urls, ARRAY[]::text[])) AS u
    WHERE u LIKE '%/object/public/incident-photos/%'
       OR u LIKE '%/object/sign/incident-photos/%'
  ) THEN
    RAISE EXCEPTION 'private media paths: criminal profile rows still store public incident photo URLs';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.city_hub_posts
    WHERE document_attachments::text LIKE '%/object/public/city-hub-photos/%'
       OR document_attachments::text LIKE '%/object/sign/city-hub-photos/%'
  ) THEN
    RAISE EXCEPTION 'private media paths: city hub documents still store public URLs';
  END IF;
END
$verify$;
