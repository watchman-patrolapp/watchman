-- Corrective follow-up to 20261106215000_private_media_store_paths.sql.
--
-- The original storage_rewrite_text_array and storage_rewrite_attachment_urls
-- removed any entry that storage_reference_to_path could not convert (blob: and
-- data: values, unsafe paths). A rewrite must never shorten a media list, so an
-- entry that cannot be converted is now kept exactly as it was stored.
--
-- This file only redefines the helpers. It does not touch table data, so it is
-- safe to apply once and safe to re-run. Rows already rewritten by the earlier
-- migration cannot be restored from here; restore those from a backup if an
-- audit shows lists that lost entries.

CREATE OR REPLACE FUNCTION public.storage_rewrite_text_array(p_bucket text, p_values text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    array_agg(
      COALESCE(NULLIF(btrim(s.converted), ''), s.original)
      ORDER BY s.ord
    ),
    ARRAY[]::text[]
  )
  FROM (
    SELECT
      t.ord,
      t.u AS original,
      public.storage_reference_to_path(p_bucket, t.u) AS converted
    FROM unnest(COALESCE(p_values, ARRAY[]::text[])) WITH ORDINALITY AS t(u, ord)
  ) s;
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
        WHEN jsonb_typeof(t.elem) = 'object'
             AND public.storage_reference_to_path(p_bucket, t.elem->>'url') IS NOT NULL THEN
          jsonb_set(
            t.elem,
            '{url}',
            to_jsonb(public.storage_reference_to_path(p_bucket, t.elem->>'url')),
            true
          )
        WHEN jsonb_typeof(t.elem) = 'string'
             AND public.storage_reference_to_path(p_bucket, t.elem #>> '{}') IS NOT NULL THEN
          to_jsonb(public.storage_reference_to_path(p_bucket, t.elem #>> '{}'))
        ELSE t.elem
      END AS rewritten
    FROM jsonb_array_elements(COALESCE(p_docs, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
  ) s;
$$;

REVOKE ALL ON FUNCTION public.storage_rewrite_text_array(text, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.storage_rewrite_attachment_urls(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_rewrite_text_array(text, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_rewrite_attachment_urls(text, jsonb) TO authenticated, service_role;

DO $verify$
DECLARE
  v_in text[] := ARRAY[
    'https://example.supabase.co/storage/v1/object/public/incident-photos/a/one.jpg',
    'blob:https://example.com/not-a-real-object',
    'b/two.jpg'
  ];
  v_out text[];
  v_docs jsonb := '[
    {"url": "https://example.supabase.co/storage/v1/object/public/city-hub-photos/a/doc.pdf", "name": "doc"},
    {"url": "blob:https://example.com/temp", "name": "temp"}
  ]'::jsonb;
  v_docs_out jsonb;
BEGIN
  v_out := public.storage_rewrite_text_array('incident-photos', v_in);

  IF COALESCE(array_length(v_out, 1), 0) <> array_length(v_in, 1) THEN
    RAISE EXCEPTION 'private media paths: rewrite shortened the list (% in, % out)',
      array_length(v_in, 1), COALESCE(array_length(v_out, 1), 0);
  END IF;
  IF v_out[1] IS DISTINCT FROM 'a/one.jpg' THEN
    RAISE EXCEPTION 'private media paths: public URL was not converted (%)', COALESCE(v_out[1], 'null');
  END IF;
  IF v_out[2] IS DISTINCT FROM v_in[2] THEN
    RAISE EXCEPTION 'private media paths: unparsed entry was not kept as stored';
  END IF;
  IF v_out[3] IS DISTINCT FROM 'b/two.jpg' THEN
    RAISE EXCEPTION 'private media paths: bare path changed (%)', COALESCE(v_out[3], 'null');
  END IF;

  v_docs_out := public.storage_rewrite_attachment_urls('city-hub-photos', v_docs);

  IF jsonb_array_length(v_docs_out) <> jsonb_array_length(v_docs) THEN
    RAISE EXCEPTION 'private media paths: attachment rewrite shortened the list';
  END IF;
  IF v_docs_out #>> '{0,url}' IS DISTINCT FROM 'a/doc.pdf' THEN
    RAISE EXCEPTION 'private media paths: attachment URL was not converted';
  END IF;
  IF v_docs_out #>> '{1,url}' IS DISTINCT FROM 'blob:https://example.com/temp' THEN
    RAISE EXCEPTION 'private media paths: unparsed attachment was not kept as stored';
  END IF;
END
$verify$;
