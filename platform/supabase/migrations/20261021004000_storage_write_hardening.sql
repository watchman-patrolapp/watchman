-- G4 — Storage write lockdown + safe path helpers.
-- Depends on G3 (20261021003000) for public.can_manage_emergency_entry(uuid).
--
-- This file does not INSERT, UPDATE, DELETE, or move any storage.objects row.
-- It does not change storage.buckets (public flag, size limit, mime types stay).
-- Existing objects keep their names. Public object URLs keep working because the
-- four buckets stay public; getPublicUrl does not need a SELECT policy.
-- SELECT policies are left as they are:
--   20260820090000 already dropped public listing.
--   "incident_photos_authenticated_select" stays so moderators can list a folder.
--
-- Read-only pre-check (run before this file; do not write):
--   SELECT policyname, cmd, roles::text, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'storage' AND tablename = 'objects'
--   ORDER BY policyname;
--   SELECT id, name, public
--   FROM storage.buckets
--   ORDER BY id;
--   SELECT bucket_id, count(*) AS object_count
--   FROM storage.objects
--   WHERE bucket_id IN (
--     'incident-photos', 'city-hub-photos', 'security-branding',
--     'emergency-directory', 'criminal-photos'
--   )
--   GROUP BY bucket_id
--   ORDER BY bucket_id;
-- After apply, those object counts must be unchanged. Confirm the write policy
-- names dropped below still match the live names before applying.
--
-- criminal-photos: the repo has no CREATE POLICY and no storage.buckets row for
-- it. Uploads in the web app use criminal-profiles/{user}/{file}. This migration
-- does not add or change that bucket. Inspect it with the pre-check above.

-- ---------------------------------------------------------------------------
-- Safe helpers. try_uuid never raises, so a bad path cannot abort a policy.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_uuid(p text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN p::uuid;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.storage_path_org_id(p_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.try_uuid((storage.foldername(p_name))[1]);
$$;

CREATE OR REPLACE FUNCTION public.storage_path_in_caller_org(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.storage_path_org_id(p_name) IS NOT NULL
     AND public.storage_path_org_id(p_name) IN (SELECT public.current_org_ids());
$$;

-- incident_in_caller_orgs (20260820060000) requires organization_id IN current_org_ids().
-- IncidentForm still inserts organization_id NULL when no neighbourhood is selected.
-- Those rows stay writable by the reporter only. A set organization_id never
-- falls through to the reporter check, so another org's incident stays closed.
CREATE OR REPLACE FUNCTION public.storage_incident_writable(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.incident_in_caller_orgs(public.try_uuid((storage.foldername(p_name))[1]))
    OR EXISTS (
      SELECT 1
      FROM public.incidents i
      WHERE i.id = public.try_uuid((storage.foldername(p_name))[1])
        AND i.organization_id IS NULL
        AND auth.uid() IS NOT NULL
        AND (
          i.reporter_id = auth.uid()
          OR i.submitted_by::text = auth.uid()::text
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.storage_city_hub_post_manageable(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.city_hub_posts p
    WHERE p.id = public.try_uuid((storage.foldername(p_name))[1])
      AND public.can_manage_city_hub_post(p.created_by_user_id)
  );
$$;

REVOKE ALL ON FUNCTION public.try_uuid(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_uuid(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.storage_path_org_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_path_org_id(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.storage_path_in_caller_org(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_path_in_caller_org(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.storage_incident_writable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_incident_writable(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.storage_city_hub_post_manageable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_city_hub_post_manageable(text) TO authenticated, service_role;

-- Already created and granted in G3. Policies below call it as the signed-in user.
REVOKE ALL ON FUNCTION public.can_manage_emergency_entry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_emergency_entry(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- incident-photos. Path stays {incident_id}/… (IncidentForm, ResidentActivityReport).
-- Insert: incident is in the caller's orgs (or a NULL-org incident they reported).
-- Update: the uploader only, so one user cannot overwrite another's object.
-- Delete: the uploader, or a moderator while the incident row still exists.
-- deleteIncident.js removes objects before admin_delete_incident deletes the row.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "incident_photos_authenticated_insert" ON storage.objects;
DROP POLICY IF EXISTS "incident_photos_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "incident_photos_authenticated_delete" ON storage.objects;
DROP POLICY IF EXISTS "incident_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "incident_photos_update" ON storage.objects;
DROP POLICY IF EXISTS "incident_photos_delete" ON storage.objects;

CREATE POLICY "incident_photos_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'incident-photos'
    AND public.storage_incident_writable(name)
  );

CREATE POLICY "incident_photos_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'incident-photos'
    AND owner_id = (SELECT auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'incident-photos'
    AND owner_id = (SELECT auth.uid())::text
  );

CREATE POLICY "incident_photos_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'incident-photos'
    AND (
      owner_id = (SELECT auth.uid())::text
      OR (
        public.can_moderate_incidents()
        AND public.storage_incident_writable(name)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- city-hub-photos. Path stays {post_id}/… (uploadCityHubPhotos / Documents,
-- called only after the post insert returns). Writes follow
-- can_manage_city_hub_post: global staff, or the nw_admin who authored the post.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "city_hub_photos_authenticated_insert" ON storage.objects;
DROP POLICY IF EXISTS "city_hub_photos_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "city_hub_photos_authenticated_delete" ON storage.objects;
DROP POLICY IF EXISTS "city_hub_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "city_hub_photos_update" ON storage.objects;
DROP POLICY IF EXISTS "city_hub_photos_delete" ON storage.objects;

CREATE POLICY "city_hub_photos_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'city-hub-photos'
    AND public.storage_city_hub_post_manageable(name)
  );

CREATE POLICY "city_hub_photos_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'city-hub-photos'
    AND public.storage_city_hub_post_manageable(name)
  )
  WITH CHECK (
    bucket_id = 'city-hub-photos'
    AND public.storage_city_hub_post_manageable(name)
  );

CREATE POLICY "city_hub_photos_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'city-hub-photos'
    AND public.storage_city_hub_post_manageable(name)
  );

-- ---------------------------------------------------------------------------
-- security-branding. Path stays {company_id}/…. Own company or global staff.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "security_branding_authenticated_write" ON storage.objects;
DROP POLICY IF EXISTS "security_branding_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "security_branding_authenticated_delete" ON storage.objects;
DROP POLICY IF EXISTS "security_branding_write" ON storage.objects;
DROP POLICY IF EXISTS "security_branding_update" ON storage.objects;
DROP POLICY IF EXISTS "security_branding_delete" ON storage.objects;

CREATE POLICY "security_branding_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'security-branding'
    AND (
      public.is_global_app_staff()
      OR public.try_uuid((storage.foldername(name))[1]) IN (SELECT public.my_security_company_ids())
    )
  );

CREATE POLICY "security_branding_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'security-branding'
    AND (
      public.is_global_app_staff()
      OR public.try_uuid((storage.foldername(name))[1]) IN (SELECT public.my_security_company_ids())
    )
  )
  WITH CHECK (
    bucket_id = 'security-branding'
    AND (
      public.is_global_app_staff()
      OR public.try_uuid((storage.foldername(name))[1]) IN (SELECT public.my_security_company_ids())
    )
  );

CREATE POLICY "security_branding_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'security-branding'
    AND (
      public.is_global_app_staff()
      OR public.try_uuid((storage.foldername(name))[1]) IN (SELECT public.my_security_company_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- emergency-directory. New uploads use {org_id}/… or global/….
-- Legacy {uploader}/… objects are not moved or deleted. Their public URLs
-- keep loading. The original uploader can still replace or remove their own
-- object (owner_id). Everyone else needs can_manage_emergency_entry.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "emergency_directory_authenticated_write" ON storage.objects;
DROP POLICY IF EXISTS "emergency_directory_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "emergency_directory_authenticated_delete" ON storage.objects;
DROP POLICY IF EXISTS "emergency_directory_write" ON storage.objects;
DROP POLICY IF EXISTS "emergency_directory_update" ON storage.objects;
DROP POLICY IF EXISTS "emergency_directory_delete" ON storage.objects;

CREATE POLICY "emergency_directory_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'emergency-directory'
    AND (
      (
        (storage.foldername(name))[1] = 'global'
        AND public.can_manage_emergency_entry(NULL)
      )
      OR public.can_manage_emergency_entry(public.storage_path_org_id(name))
    )
  );

CREATE POLICY "emergency_directory_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'emergency-directory'
    AND (
      (
        (storage.foldername(name))[1] = 'global'
        AND public.can_manage_emergency_entry(NULL)
      )
      OR public.can_manage_emergency_entry(public.storage_path_org_id(name))
      OR owner_id = (SELECT auth.uid())::text
    )
  )
  WITH CHECK (
    bucket_id = 'emergency-directory'
    AND (
      (
        (storage.foldername(name))[1] = 'global'
        AND public.can_manage_emergency_entry(NULL)
      )
      OR public.can_manage_emergency_entry(public.storage_path_org_id(name))
      OR owner_id = (SELECT auth.uid())::text
    )
  );

CREATE POLICY "emergency_directory_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'emergency-directory'
    AND (
      (
        (storage.foldername(name))[1] = 'global'
        AND public.can_manage_emergency_entry(NULL)
      )
      OR public.can_manage_emergency_entry(public.storage_path_org_id(name))
      OR owner_id = (SELECT auth.uid())::text
    )
  );
