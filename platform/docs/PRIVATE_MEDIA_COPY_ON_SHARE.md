# Private media and City Hub copy-on-share

Incident photos and community media become private. A signed-in member of the owning organization can open them with a signed URL that lasts about an hour. City Hub does not point at those private files. When an admin shares a post, the photos they choose are copied into `city-hub-photos`. Any signed-in Watchman user can open that copy. An anonymous visitor cannot. Unsharing or deleting the post deletes the copies. The originals stay in the private bucket.

This replaces the incident, community, and City Hub parts of `STORAGE_PRIVACY_PLAN.md`. Avatars, chat, branding, the emergency directory, and criminal photos are unchanged. Criminal photos were already private.

## How access works

| Bucket | Who can sign a URL | Where the path lives |
| --- | --- | --- |
| `incident-photos` | Members of the incident's organization (`incident_in_caller_orgs` / `current_org_ids`), the reporter when the incident has no organization, and global or platform staff | `incidents.media_urls`, `incident_evidence.media_urls`, and `incident_suspects.photo_urls` when that column exists. A profile that keeps an incident photo stores `incident-photos/<path>`. |
| `community-media` | Members of the organization named by the first folder (`storage_path_in_caller_org`) | Wishlist, equipment, and receipt paths. Those columns already stored paths. |
| `city-hub-photos` | Any signed-in user, and only while the post is `published` | `city_hub_posts.photo_urls` and `document_attachments[].url` |

Signed URLs last 3600 seconds. The browser keeps one until two minutes before it expires, so a list does not flicker back to empty on the next render. If signing fails, the screen shows "Photo unavailable" or "Document unavailable". Storage errors stay in the console.

New uploads store the object path, not `getPublicUrl()`. The app still accepts an old public URL and signs the path inside it, so a row that has not been rewritten yet still displays.

## Copy on share

The share sheet lists the incident's photos. Nothing is selected until the admin ticks one. At most six are copied. The app downloads each chosen object (the admin can read it) and uploads it to `city-hub-photos/<post id>/copy_…`. `city_hub_media_copies` records the source and the destination. The post's `photo_urls` then stores the destination paths.

Archive and delete remove those objects, and any file uploaded directly onto the post, before the post leaves the feed. The database clears `photo_urls`, `document_attachments`, and the registry rows. Incident and community objects are not deleted.

A City Hub post that was shared before this change did not include photos. The backfill does not invent that selection. It only copies a file when the post already points at `incident-photos` or `community-media`.

## Apply order

The user runs each SQL file in the Supabase SQL editor. Do not run them against production from the app or from CI.

1. Deploy the web app that signs these URLs. Until the flip below, the buckets are still public, so the previous app keeps working if this deploy is delayed. After this deploy, both a stored path and an old public URL display.
2. `platform/supabase/migrations/20261106210000_private_media_read_policies_and_copy_registry.sql`
   Adds the SELECT policies, the copy registry, and archive/delete cleanup. Buckets stay public.
3. `platform/supabase/migrations/20261106215000_private_media_store_paths.sql`
   Rewrites stored public URLs to object paths. Files are not moved. Run this after the new app is what people are using. The previous app would show a bare path as a broken image.
4. From `platform/web`, with the service role key only in the environment:

   ```bash
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-city-hub-media-copies.mjs
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-city-hub-media-copies.mjs --apply
   ```

   The first command prints the count. `--apply` copies the bytes and is safe to repeat.
5. `platform/supabase/migrations/20261106220000_flip_incident_community_city_hub_buckets_private.sql`
   **Last.** Sets `public = false` on `incident-photos`, `community-media`, and `city-hub-photos`. After this, a public URL no longer opens the file.

`wishlist_ledger_entries` is append-only, so a receipt path is not rewritten. The app signs a path or a legacy public URL for that column. Receipts in this app are already stored as paths.

Each migration ends with a `DO` block that raises if the policies, path rewrite, or bucket flags did not land. Running a file again is safe.

## Rollback

1. Turn the three buckets public again. This is not a migration file, so it will not run on the next deploy by itself:

   ```sql
   UPDATE storage.buckets
   SET public = true
   WHERE id IN ('incident-photos', 'community-media', 'city-hub-photos');
   ```

   Public URLs work again for any object that is still a full URL. Rows that were rewritten to paths keep working only in the app that signs them. To put a public URL back you would rebuild it from the path; the file itself was never moved.
2. Leave the SELECT policies in place. They do not block a public URL, and the signing app needs them if you flip the buckets private again.
3. City Hub copies can stay. They are extra files. Deleting a post still removes its copies. To drop a copy without deleting the post, remove the `city-hub-photos` object and its `city_hub_media_copies` row, and take that path out of `photo_urls`. Do not delete the source object.
4. Redeploy the previous web build only if you have also restored public URLs in the database. A previous build does not sign paths.

## What stays public on purpose

`security-branding`, `emergency-directory`, `avatars`, and `chat-media` still use `getPublicUrl()`. `criminal-photos` stays on its existing signed-URL flow.
