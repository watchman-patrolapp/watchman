# Storage privacy plan

Incident photos and community media stay public in this change. Flipping either bucket requires the app to sign URLs first. `20261105120000_storage_policies_consolidated.sql` restates `storage.objects` policies and does not update `storage.buckets.public`.

Inventory is every `getPublicUrl` and `createSignedUrl` under `platform/web/src` at commit `5537497` plus this branch (no new call sites).

## Recommendation

**Incident evidence (`incident-photos`): private bucket + signed URLs.** Scene photos, suspect images, and vehicle images are stored as full public URLs. Anyone who has the URL can fetch the object while the bucket is public. SELECT on `storage.objects` was already narrowed to staff, but a public bucket does not consult that policy for `/object/public/...`.

**Resident media (`community-media`): private bucket + signed URLs as well, after incidents.** The database stores object paths, and display goes through `wishlistPhotoUrl` (needs photos, equipment catalogue photos, and receipt images). That is a smaller client change than incidents. Receipts on a public bucket are the part that should not wait: `NeedLedger` renders `receipt_path` with the same public URL helper. Until the bucket flip, move new receipt uploads to `community-private` (already signed) if a smaller first step is wanted. Item photos of kit and wishlist goods are lower sensitivity; one signed helper is still simpler than two buckets with two helpers.

Do not flip either flag until the client that signs those URLs is what production is serving. A private bucket with the current `getPublicUrl` strings in `<img src>` renders broken images.

`criminal-photos` is already the pattern to copy: the row keeps `getPublicUrl()` as a stable id, and `resolveCriminalPhotoUrl` / `CriminalPhotoImg` call `createSignedUrl` at display time (`20261021005000` set that bucket private).

## Buckets as they stand

| Bucket | Public flag | Who can read via the API | How the app builds a URL |
|--------|-------------|--------------------------|--------------------------|
| `incident-photos` | public (`20260328163000`) | Staff SELECT for listing. Public URL ignores that. | `getPublicUrl`, stored on the row |
| `community-media` | public (`20261031030000`) | No SELECT policy (no listing). Public URL still works. | `getPublicUrl` from a stored path |
| `community-private` | private | SELECT only for `{org}/equipment/...` managers | `createSignedUrl` |
| `criminal-photos` | private (`20261021005000`) | Intelligence viewers in the org | stable `getPublicUrl` id, signed at display |
| `city-hub-photos` | public | No SELECT | `getPublicUrl` stored on the post |
| `security-branding` | public | No SELECT | `getPublicUrl` stored on the branding row |
| `emergency-directory` | public | No SELECT | `getPublicUrl` stored on the directory row |
| `avatars` | not created in migrations | Listing policy dropped; no replacement in repo | `getPublicUrl` stored on `users.avatar_url` |
| `chat-media` | not created in migrations | Listing policy dropped; no replacement in repo | `getPublicUrl` stored on the chat message |

City hub, branding, emergency logos, avatars, and chat are a separate decision. They are public on purpose today (directory cards, map avatars, chat history). This plan does not change them.

## Call sites

### `getPublicUrl`

| Location | Bucket | What happens to the URL |
|----------|--------|-------------------------|
| `platform/web/src/utils/evidenceHelpers.js` (~line 81) | `incident-photos` | Pushed onto `media_urls` and saved with the evidence row. |
| `platform/web/src/pages/IncidentForm.jsx` (~line 645) | `incident-photos` | Pushed into the evidence payload for the new incident. |
| `platform/web/src/pages/ResidentActivityReport.jsx` (~line 129) | `incident-photos` | Written to `incidents.media_urls` / the evidence insert. |
| `platform/web/src/utils/communityMedia.js` (~line 85) | `community-media` | Returned as `publicUrl` from `uploadCommunityImage`. No other file calls that function today; the progress uploader returns `{ path }` only. |
| `platform/web/src/utils/equipmentWishlist.js` (~line 74) `wishlistPhotoUrl` | `community-media` | Synchronous display URL. Callers: `NeedGallery`, `NeedItemEditor`, `NeedLedger` (including `receipt_path`), `NeedsList`, `pages/admin/NeedsAdmin.jsx`. `EquipmentUnitPage` passes equipment paths through `NeedGallery`, so catalogue photos use this helper too. |
| `platform/web/src/utils/equipment.js` (~line 34) `equipmentPhotoUrl` | `community-media` | Same transform. No other file calls it yet. |
| `platform/web/src/utils/cityHubPhotos.js` (~line 53) | `city-hub-photos` | Stored on `city_hub_posts.photo_urls`. |
| `platform/web/src/utils/emergencyDirectory.js` (~line 128) | `emergency-directory` | Stored on the directory row. |
| `platform/web/src/utils/emergencyDirectory.js` (~line 151) | `security-branding` | Stored on the branding row. |
| `platform/web/src/pages/Profile.jsx` (~line 407) | `avatars` | Stored on `users.avatar_url`. |
| `platform/web/src/chat/services/storageService.js` (~lines 23 and 59) | `chat-media` | Returned as the message image or voice URL. |
| `platform/web/src/components/intelligence/QuickCreateProfileDrawer.jsx` (~line 127) | `criminal-photos` | Stored on `photo_urls`. Display signs it. |
| `platform/web/src/pages/intelligence/CreateProfile.jsx` (~line 303) | `criminal-photos` | Stored on `photo_urls`. The same screen can also copy `incident-photos` URLs off an incident (`media_urls`). Those copied strings are not criminal-photo paths, so the criminal signer leaves them alone. |
| `platform/web/src/pages/CriminalProfileDetail.jsx` (~line 463) | `criminal-photos` | Appended to `photo_urls`. Display signs it. |

`platform/web/src/utils/uploadWithProgress.js` uploads to `community-media` with XHR and returns `{ path }`. It does not call `getPublicUrl`.

### `createSignedUrl`

| Location | Bucket | TTL | Notes |
|----------|--------|-----|-------|
| `platform/web/src/utils/criminalPhotos.js` (~line 71) | `criminal-photos` | 1 hour, cached until 2 minutes before expiry | `resolveCriminalPhotoUrl`, `useCriminalPhotoSrcList`. `CriminalPhotoImg` and the intelligence cards go through this. On failure it falls back to the stored URL, which only works while the bucket is public. |
| `platform/web/src/utils/communityMedia.js` (~line 115) `getSignedUrl` | `community-private` | 5 minutes default | `EquipmentUnitsPanel.jsx` uses it for invoice / private files. |

No `createSignedUrls` (batch) call exists.

### Incident URLs that are rendered, not produced

These read a URL already stored in `media_urls` (or the legacy `incidents.media_urls` array) and put it on an image. A private bucket breaks them until they sign:

- `platform/web/src/components/evidence/StructuredEvidenceList.jsx`
- `platform/web/src/pages/IncidentModeration.jsx` (passes `emptyFallbackUrls`)
- `platform/web/src/pages/PrintIncidentDetail.jsx`
- `platform/web/src/pages/intelligence/CreateProfile.jsx` when it copies incident media onto a profile
- `platform/web/src/supabase/client.js` passes `media_urls` through on create

Search `media_urls` again before the flip. Print and moderation are the easy ones to miss.

## Work to make `incident-photos` private

1. Add a resolver next to `criminalPhotos.js`: parse a stored URL for the `/incident-photos/` marker, reject `..`, call `createSignedUrl`. Keep storing `getPublicUrl()` so existing rows do not need a rewrite. Old rows and new rows then share one display path.
2. One image component (the criminal `CriminalPhotoImg` shape) used by the evidence list, moderation, the resident report preview, and print. Print needs a longer TTL or it must be opened while the URL is still valid. One hour is enough for a print preview; a saved PDF that embeds the signed URL will rot.
3. Widen SELECT. Today `incident_photos_authenticated_select` allows only global staff, platform staff, incident moderators, and admin/committee. `createSignedUrl` requires SELECT. A patroller or the reporting resident cannot sign under that policy, so the private bucket would hide the photo from the people the incident screen is for. The follow-up migration should allow SELECT when the caller can read that incident (same org, or they are `reporter_id` / `submitted_by`), and keep delete as it is (owner or moderator). Do that in the same migration that sets `public = false`, after the client is deployed. Deploy order: ship the signer while the bucket is still public (signed URL works, public URL still works), then set `public = false`.
4. Leave `getPublicUrl` at the three upload sites so the stored id does not change shape. `CreateProfile` copies of incident URLs must go through the incident signer, not only the criminal one.

That is one new module, a change to the evidence/moderation/print image path, and one migration. It is not a storage-policy restatement. The risk is a display site that still binds `media_urls[i]` straight to `src`.

## Work to make `community-media` private

1. Change `wishlistPhotoUrl` from a sync `getPublicUrl` to the criminal-photo cache plus `createSignedUrl`. `equipmentPhotoUrl` should call the same function so the unused helper cannot drift.
2. `NeedGallery` is the display funnel (needs and equipment). It maps paths to URLs during render. That becomes a state update after the signed URLs resolve, the way `useCriminalPhotoSrcList` does. `NeedItemEditor`, `NeedLedger`, `NeedsList`, and `NeedsAdmin` call `wishlistPhotoUrl` directly and need the same async treatment.
3. Add a SELECT policy for `community-media`: caller is in the org encoded in the first path segment (`storage_path_in_caller_org`). Without it, signing returns 403. Insert and delete policies already exist and can stay.
4. Receipts: either they follow that policy, or new receipt uploads go to `community-private` and `NeedLedger` calls `getSignedUrl`. Prefer one private `community-media` so receipts do not sit on a second path by accident.
5. `uploadCommunityImage` still returns `publicUrl`. Nothing calls it. Point it at the path and drop the public URL, or leave it until the function is deleted.

`community-private` is already signed. No bucket change there. Its SELECT policy only covers `{org}/equipment/...`, so a needs receipt placed in that bucket would not be readable until the policy grows a prefix for it. That is why the recommendation is to sign `community-media` itself rather than to split receipts across buckets in a hurry.

## Out of scope here

- No `UPDATE storage.buckets SET public = false` for `incident-photos` or `community-media`.
- No app changes to URL helpers.
- Avatars, chat, city hub, branding, and the emergency directory stay on `getPublicUrl`.
