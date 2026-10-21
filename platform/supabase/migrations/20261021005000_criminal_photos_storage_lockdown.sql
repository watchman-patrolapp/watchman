-- G4b — Lock down the criminal-photos bucket.
-- Depends on G4 (20261021004000) for public.try_uuid(text), and on earlier
-- helpers: current_org_ids(), is_global_app_staff(), is_org_nw_admin(uuid).
--
-- Does not INSERT, UPDATE, DELETE, move, or rename any storage.objects row.
-- The only storage write is storage.buckets.public = false for this bucket,
-- so a public URL cannot bypass the SELECT policy. Object names stay
-- criminal-profiles/{uploader user id}/{file}. The 22 live objects stay.
--
-- Who can read (same people as roleMatrix intelligenceView, in the org):
--   volunteer, patroller, investigator, committee, nw_admin, admin,
--   technical_support, security_admin, city_admin.
--   Residents cannot. Global staff (admin, technical_support) only see the
--   working neighbourhood from current_org_ids().
-- A photo linked from criminal_profiles.photo_urls is readable when that
-- profile's organization_id is in the caller's orgs. A photo linked only to
-- another org is denied, including to the uploader. An unlinked object
-- (upload preview, or a file whose URL is not on a profile) is readable by
-- the uploader and by intelligence viewers in the uploader's org.
--
-- Who can upload: those same roles, and only into
-- criminal-profiles/{their auth.uid()}/{file}.
-- Who can overwrite or delete: the uploader, the NW admin of the profile's
-- org, or global staff in that org. A link to another org blocks the write.
--
-- Read-only pre-check (run before this file; do not write):
--   SELECT id, name, public
--   FROM storage.buckets
--   WHERE id = 'criminal-photos';
--   SELECT count(*) AS object_count
--   FROM storage.objects
--   WHERE bucket_id = 'criminal-photos';
--   SELECT policyname, cmd, roles::text, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'storage'
--     AND tablename = 'objects'
--     AND (
--       policyname IN (
--         'Allow authenticated uploads',
--         'Allow authenticated deletes',
--         'Allow authenticated reads',
--         'criminal-photos_authenticated_uploads',
--         'criminal-photos_authenticated_deletes',
--         'criminal-photos_authenticated_reads'
--       )
--       OR coalesce(qual, '') ILIKE '%criminal-photos%'
--       OR coalesce(with_check, '') ILIKE '%criminal-photos%'
--     )
--   ORDER BY policyname, cmd;
--   SELECT count(*) AS objects,
--          count(*) FILTER (
--            WHERE EXISTS (
--              SELECT 1
--              FROM public.criminal_profiles cp
--              CROSS JOIN LATERAL unnest(coalesce(cp.photo_urls, ARRAY[]::text[])) AS photo_url
--              WHERE public.criminal_photo_url_matches(photo_url, o.name)
--            )
--          ) AS linked_to_a_profile
--   FROM storage.objects o
--   WHERE o.bucket_id = 'criminal-photos';
-- The last query only works after this file creates criminal_photo_url_matches.
-- Run it as a post-check instead if the function is not there yet. linked
-- objects are what patrollers see. Unlinked objects stay visible to the
-- uploader and to intelligence viewers in the uploader's org.
--
-- Post-check (object count must still be 22; public must be false):
--   SELECT id, public FROM storage.buckets WHERE id = 'criminal-photos';
--   SELECT count(*) AS object_count
--   FROM storage.objects
--   WHERE bucket_id = 'criminal-photos';
--   SELECT policyname, cmd
--   FROM pg_policies
--   WHERE schemaname = 'storage'
--     AND tablename = 'objects'
--     AND policyname LIKE 'criminal_photos_%'
--   ORDER BY policyname;

-- ---------------------------------------------------------------------------
-- Role gate. Normalise with replace(lower(trim(role::text)), '-', '_'),
-- then the same aliases as platform/web/src/auth/roleMatrix.js.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalized_app_role(p_role text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE replace(lower(trim(coalesce(p_role, ''))), '-', '_')
    WHEN 'patrol' THEN 'patroller'
    WHEN 'technicalsupport' THEN 'technical_support'
    WHEN 'tech_support' THEN 'technical_support'
    WHEN 'techsupport' THEN 'technical_support'
    WHEN 'user' THEN 'resident'
    ELSE replace(lower(trim(coalesce(p_role, ''))), '-', '_')
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_view_criminal_intelligence()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_global_app_staff()
      OR EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = auth.uid()
          AND public.normalized_app_role(u.role::text) IN (
            'volunteer',
            'patroller',
            'investigator',
            'committee',
            'nw_admin',
            'admin',
            'technical_support',
            'security_admin',
            'city_admin'
          )
      );
$$;

-- Path is criminal-profiles/{uploader uuid}/{file}. Anything else has no uploader.
CREATE OR REPLACE FUNCTION public.criminal_photo_uploader_id(p_name text)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN (storage.foldername(p_name))[1] = 'criminal-profiles'
      THEN public.try_uuid((storage.foldername(p_name))[2])
    ELSE NULL
  END;
$$;

-- photo_urls stores getPublicUrl(), which ends with /{object name}.
-- Compare the path suffix so a short name cannot match the middle of another.
CREATE OR REPLACE FUNCTION public.criminal_photo_url_matches(p_url text, p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_url IS NOT NULL
     AND p_name IS NOT NULL
     AND btrim(p_name) <> ''
     AND (
       split_part(p_url, '?', 1) = p_name
       OR right(split_part(p_url, '?', 1), char_length(p_name) + 1) = '/' || p_name
       OR right(
            split_part(p_url, '?', 1),
            char_length(replace(p_name, ' ', '%20')) + 1
          ) = '/' || replace(p_name, ' ', '%20')
     );
$$;

CREATE OR REPLACE FUNCTION public.criminal_photo_linked_org_ids(p_name text)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT cp.organization_id
  FROM public.criminal_profiles cp
  WHERE cp.organization_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM unnest(coalesce(cp.photo_urls, ARRAY[]::text[])) AS photo_url
      WHERE public.criminal_photo_url_matches(photo_url, p_name)
    );
$$;

CREATE OR REPLACE FUNCTION public.criminal_photo_visible_in_caller_orgs(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.criminal_photo_linked_org_ids(p_name) AS linked(org_id)
    WHERE linked.org_id IN (SELECT public.current_org_ids())
  );
$$;

-- True when some profile outside the caller's orgs references this object.
CREATE OR REPLACE FUNCTION public.criminal_photo_blocked_by_other_org(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.criminal_photo_linked_org_ids(p_name) AS linked(org_id)
    WHERE linked.org_id NOT IN (SELECT public.current_org_ids())
  );
$$;

CREATE OR REPLACE FUNCTION public.criminal_photo_caller_is_uploader(p_name text, p_owner_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND (
       (p_owner_id IS NOT NULL AND p_owner_id = auth.uid()::text)
       OR public.criminal_photo_uploader_id(p_name) = auth.uid()
     );
$$;

-- Uploader's home org or an active membership is one of the caller's orgs.
CREATE OR REPLACE FUNCTION public.criminal_photo_uploader_in_caller_orgs(p_name text, p_owner_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users uploader
    WHERE uploader.id = coalesce(
            public.criminal_photo_uploader_id(p_name),
            public.try_uuid(p_owner_id)
          )
      AND (
        (
          uploader.organization_id IS NOT NULL
          AND uploader.organization_id IN (SELECT public.current_org_ids())
        )
        OR EXISTS (
          SELECT 1
          FROM public.organization_members om
          WHERE om.user_id = uploader.id
            AND om.status = 'active'
            AND om.organization_id IN (SELECT public.current_org_ids())
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_criminal_photo(p_name text, p_owner_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_view_criminal_intelligence()
     AND (
       -- Linked from a profile in the caller's orgs. A second org that also
       -- stored the same URL does not hide it from the org that has the profile.
       public.criminal_photo_visible_in_caller_orgs(p_name)
       OR (
         -- Not on any profile yet: uploader, or intelligence viewers in the uploader's org.
         NOT EXISTS (SELECT 1 FROM public.criminal_photo_linked_org_ids(p_name))
         AND (
           public.criminal_photo_caller_is_uploader(p_name, p_owner_id)
           OR public.criminal_photo_uploader_in_caller_orgs(p_name, p_owner_id)
         )
       )
     );
$$;

CREATE OR REPLACE FUNCTION public.can_upload_criminal_photo(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_view_criminal_intelligence()
     AND auth.uid() IS NOT NULL
     AND (storage.foldername(p_name))[1] = 'criminal-profiles'
     AND public.try_uuid((storage.foldername(p_name))[2]) = auth.uid()
     AND coalesce(array_length(storage.foldername(p_name), 1), 0) = 2
     AND split_part(p_name, '/', 3) <> '';
$$;

-- NW admin of the uploader's org, or global staff working in that org.
CREATE OR REPLACE FUNCTION public.criminal_photo_unlinked_manageable(p_name text, p_owner_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.criminal_photo_uploader_in_caller_orgs(p_name, p_owner_id)
     AND (
       public.is_global_app_staff()
       OR EXISTS (
         SELECT 1
         FROM public.users uploader
         WHERE uploader.id = coalesce(
                 public.criminal_photo_uploader_id(p_name),
                 public.try_uuid(p_owner_id)
               )
           AND (
             public.is_org_nw_admin(uploader.organization_id)
             OR EXISTS (
               SELECT 1
               FROM public.organization_members om
               WHERE om.user_id = uploader.id
                 AND om.status = 'active'
                 AND public.is_org_nw_admin(om.organization_id)
             )
           )
       )
     );
$$;

CREATE OR REPLACE FUNCTION public.criminal_photo_writable_by_caller(p_name text, p_owner_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND NOT public.criminal_photo_blocked_by_other_org(p_name)
     AND (
       (
         public.criminal_photo_caller_is_uploader(p_name, p_owner_id)
         AND (
           NOT EXISTS (SELECT 1 FROM public.criminal_photo_linked_org_ids(p_name))
           OR public.criminal_photo_visible_in_caller_orgs(p_name)
         )
       )
       OR (
         public.criminal_photo_visible_in_caller_orgs(p_name)
         AND EXISTS (
           SELECT 1
           FROM public.criminal_photo_linked_org_ids(p_name) AS linked(org_id)
           WHERE public.is_org_nw_admin(linked.org_id)
              OR public.is_global_app_staff()
         )
       )
       OR (
         NOT EXISTS (SELECT 1 FROM public.criminal_photo_linked_org_ids(p_name))
         AND public.criminal_photo_unlinked_manageable(p_name, p_owner_id)
       )
     );
$$;

REVOKE ALL ON FUNCTION public.normalized_app_role(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalized_app_role(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_view_criminal_intelligence() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_criminal_intelligence() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.criminal_photo_uploader_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criminal_photo_uploader_id(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.criminal_photo_url_matches(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criminal_photo_url_matches(text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.criminal_photo_linked_org_ids(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criminal_photo_linked_org_ids(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.criminal_photo_visible_in_caller_orgs(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criminal_photo_visible_in_caller_orgs(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.criminal_photo_blocked_by_other_org(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criminal_photo_blocked_by_other_org(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.criminal_photo_caller_is_uploader(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criminal_photo_caller_is_uploader(text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.criminal_photo_uploader_in_caller_orgs(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criminal_photo_uploader_in_caller_orgs(text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_read_criminal_photo(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_criminal_photo(text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_upload_criminal_photo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_upload_criminal_photo(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.criminal_photo_unlinked_manageable(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criminal_photo_unlinked_manageable(text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.criminal_photo_writable_by_caller(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criminal_photo_writable_by_caller(text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Private bucket. Public object URLs ignore SELECT policies. The web app
-- keeps storing getPublicUrl() as the stable id and signs it at display time.
-- No object rows change.
-- ---------------------------------------------------------------------------
UPDATE storage.buckets
SET public = false
WHERE id = 'criminal-photos'
  AND public IS DISTINCT FROM false;

-- ---------------------------------------------------------------------------
-- Replace the six live policies. Names confirmed from production pg_policies.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated reads" ON storage.objects;
DROP POLICY IF EXISTS "criminal-photos_authenticated_uploads" ON storage.objects;
DROP POLICY IF EXISTS "criminal-photos_authenticated_deletes" ON storage.objects;
DROP POLICY IF EXISTS "criminal-photos_authenticated_reads" ON storage.objects;
DROP POLICY IF EXISTS "criminal_photos_select" ON storage.objects;
DROP POLICY IF EXISTS "criminal_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "criminal_photos_update" ON storage.objects;
DROP POLICY IF EXISTS "criminal_photos_delete" ON storage.objects;

CREATE POLICY "criminal_photos_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'criminal-photos'
    AND public.can_read_criminal_photo(name, owner_id)
  );

CREATE POLICY "criminal_photos_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'criminal-photos'
    AND public.can_upload_criminal_photo(name)
  );

CREATE POLICY "criminal_photos_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'criminal-photos'
    AND public.criminal_photo_writable_by_caller(name, owner_id)
  )
  WITH CHECK (
    bucket_id = 'criminal-photos'
    AND public.criminal_photo_writable_by_caller(name, owner_id)
  );

CREATE POLICY "criminal_photos_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'criminal-photos'
    AND public.criminal_photo_writable_by_caller(name, owner_id)
  );
