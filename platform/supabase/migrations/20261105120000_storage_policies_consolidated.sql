-- Restate the storage.objects policies that remain after every earlier migration.
-- Additive and idempotent: DROP POLICY IF EXISTS, then CREATE. No storage.objects
-- rows are inserted, updated, deleted, or renamed. storage.buckets is not updated,
-- so incident-photos and community-media stay public. Making those buckets private
-- is a later change; see platform/docs/STORAGE_PRIVACY_PLAN.md.
--
-- Derived by replaying migrations in filename order. `supabase migration list`
-- was not available (CLI not linked) and Docker was not available, so pg_policies
-- was not queried. If a hosted project has extra policies whose names are not
-- listed below, this file leaves them in place.
--
-- Superseded for storage.objects policy text (the files stay; do not edit them):
--   20260328163000_storage_incident_photos_bucket.sql
--   20260815034000_city_hub_photos.sql
--   20260815035000_city_hub_pdf_attachments.sql
--   20260815074000_branding_banner_and_emergency_directory.sql
--   20260815076000_emergency_directory_media.sql
--   20260820090000_storage_public_buckets_no_listing.sql
--   20261021004000_storage_write_hardening.sql
--   20261021005000_criminal_photos_storage_lockdown.sql
--   20261031030000_community_storage_buckets.sql
--   20261101020000_equipment_catalogue.sql  (community_private_equipment_select only)
--
-- avatars and chat-media have no CREATE POLICY in this repo. This file only
-- repeats the listing-policy drops from 20260820090000. It does not invent
-- write policies for those buckets.
--
-- Final policies, by bucket:
--   incident-photos: authenticated SELECT for staff (no public listing);
--     insert if the incident is writable; update by owner; delete by owner or moderator.
--   city-hub-photos: insert/update/delete when the caller can manage the post. No SELECT.
--   security-branding: insert/update/delete for global staff or the company's members. No SELECT.
--   emergency-directory: insert for managers; update/delete for managers or the object owner. No SELECT.
--   criminal-photos: select/insert/update/delete via the G4b helpers. Bucket stays private
--     because 20261021005000 set public = false; this file does not touch that flag.
--   community-media: insert inside the caller's org; delete by owner or a moderator. No SELECT.
--   community-private: insert inside the caller's org; SELECT only for
--     {org}/equipment/... when the caller can manage equipment.

-- ---------------------------------------------------------------------------
-- Drops: names removed by later migrations, plus the names recreated below.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "incident_photos_public_read" ON storage.objects;
DROP POLICY IF EXISTS "incident_photos_authenticated_insert" ON storage.objects;
DROP POLICY IF EXISTS "incident_photos_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "incident_photos_authenticated_delete" ON storage.objects;
DROP POLICY IF EXISTS "incident_photos_authenticated_select" ON storage.objects;
DROP POLICY IF EXISTS "incident_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "incident_photos_update" ON storage.objects;
DROP POLICY IF EXISTS "incident_photos_delete" ON storage.objects;

DROP POLICY IF EXISTS "city_hub_photos_public_read" ON storage.objects;
DROP POLICY IF EXISTS "city_hub_photos_authenticated_insert" ON storage.objects;
DROP POLICY IF EXISTS "city_hub_photos_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "city_hub_photos_authenticated_delete" ON storage.objects;
DROP POLICY IF EXISTS "city_hub_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "city_hub_photos_update" ON storage.objects;
DROP POLICY IF EXISTS "city_hub_photos_delete" ON storage.objects;

DROP POLICY IF EXISTS "security_branding_public_read" ON storage.objects;
DROP POLICY IF EXISTS "security_branding_authenticated_write" ON storage.objects;
DROP POLICY IF EXISTS "security_branding_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "security_branding_authenticated_delete" ON storage.objects;
DROP POLICY IF EXISTS "security_branding_write" ON storage.objects;
DROP POLICY IF EXISTS "security_branding_update" ON storage.objects;
DROP POLICY IF EXISTS "security_branding_delete" ON storage.objects;

DROP POLICY IF EXISTS "emergency_directory_public_read" ON storage.objects;
DROP POLICY IF EXISTS "emergency_directory_authenticated_write" ON storage.objects;
DROP POLICY IF EXISTS "emergency_directory_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "emergency_directory_authenticated_delete" ON storage.objects;
DROP POLICY IF EXISTS "emergency_directory_write" ON storage.objects;
DROP POLICY IF EXISTS "emergency_directory_update" ON storage.objects;
DROP POLICY IF EXISTS "emergency_directory_delete" ON storage.objects;

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

DROP POLICY IF EXISTS "community_media_insert_org" ON storage.objects;
DROP POLICY IF EXISTS "community_media_delete_owner_or_mod" ON storage.objects;
DROP POLICY IF EXISTS "community_private_insert_org" ON storage.objects;
DROP POLICY IF EXISTS community_private_equipment_select ON storage.objects;

-- Public listing policies dropped in 20260820090000. avatars and chat-media
-- have no replacement SELECT in migrations; public object URLs still resolve
-- while those buckets stay public.
DROP POLICY IF EXISTS "avatars_select" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read" ON storage.objects;
DROP POLICY IF EXISTS "Chat media is publicly readable" ON storage.objects;

-- ---------------------------------------------------------------------------
-- incident-photos
-- ---------------------------------------------------------------------------
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
-- city-hub-photos
-- ---------------------------------------------------------------------------
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
-- security-branding
-- ---------------------------------------------------------------------------
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
-- emergency-directory
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- criminal-photos
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- community-media and community-private
-- ---------------------------------------------------------------------------
CREATE POLICY "community_media_insert_org" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'community-media' AND public.storage_path_in_caller_org(name));

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

CREATE POLICY "community_private_insert_org" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'community-private' AND public.storage_path_in_caller_org(name));

CREATE POLICY community_private_equipment_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'community-private'
    AND split_part(name, '/', 2) = 'equipment'
    AND public.can_manage_equipment(public.storage_path_org_id(name))
  );
