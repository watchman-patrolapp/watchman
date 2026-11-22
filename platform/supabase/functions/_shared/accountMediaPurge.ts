/**
 * Account deletion: permanently remove a member's PERSONAL media from Storage.
 *
 * Deleted (personal):
 *   avatars          objects named "<userId>-<timestamp>.jpg" (profile photos)
 *   chat-media       images/voice notes referenced by chat_messages they sent
 *   city-hub-photos  photos and PDFs on their own City Hub posts of type "general"
 *   community-media  photos on their own local service listings ({org}/services/{listing}/...)
 *
 * Never deleted (safety records / shared data):
 *   incident-photos (incident photos and evidence), criminal-photos,
 *   City Hub suspect alerts, pattern and resource posts, City Hub copies of
 *   incident photos, needs/equipment media, emergency-directory, security-branding.
 *
 * Usage: build the plan BEFORE chat_messages and the users row are deleted (the plan
 * reads those rows), then run it only after the auth user has been deleted.
 * Every step logs and continues: a storage failure never blocks account deletion.
 */

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export const AVATARS_BUCKET = 'avatars';
export const CHAT_MEDIA_BUCKET = 'chat-media';
export const CITY_HUB_BUCKET = 'city-hub-photos';
export const COMMUNITY_MEDIA_BUCKET = 'community-media';

/** Buckets this purge may delete from. incident-photos is deliberately absent. */
export const PURGEABLE_BUCKETS = [
  AVATARS_BUCKET,
  CHAT_MEDIA_BUCKET,
  CITY_HUB_BUCKET,
  COMMUNITY_MEDIA_BUCKET,
] as const;

export const REMOVE_BATCH_SIZE = 100;
const PAGE_SIZE = 1000;

export type PurgePlan = {
  userId: string;
  /** bucket -> object paths */
  objects: Record<string, string[]>;
  /** City Hub general posts whose media references must be cleared after removal. */
  cityHubPosts: { id: string; keepPhotos: string[]; keepDocuments: unknown[] }[];
};

export type PurgeResult = {
  removed: Record<string, number>;
  failed: Record<string, number>;
  postsCleared: number;
};

function cleanPath(raw: string): string | null {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  decoded = decoded.replace(/^\/+/, '');
  if (!decoded || decoded.includes('..') || decoded.includes('\\') || decoded.includes('\0')) {
    return null;
  }
  return decoded;
}

/**
 * Object path inside `bucket` for a stored value: a full Storage URL (public or signed),
 * "bucket/path", or (when allowBare) a bare path. Values for other buckets return null.
 */
export function objectPathFor(stored: unknown, bucket: string, allowBare = false): string | null {
  if (typeof stored !== 'string') return null;
  const trimmed = stored.trim();
  if (!trimmed || trimmed.startsWith('blob:') || trimmed.startsWith('data:')) return null;
  const noQuery = trimmed.split('#')[0].split('?')[0];
  const marker = `/${bucket}/`;
  const at = noQuery.lastIndexOf(marker);
  if (at !== -1) return cleanPath(noQuery.slice(at + marker.length));
  if (noQuery.startsWith(`${bucket}/`)) return cleanPath(noQuery.slice(bucket.length + 1));
  if (/^[a-z][a-z0-9+.-]*:/i.test(noQuery)) return null;
  if (!allowBare) return null;
  // A bare path that names another known bucket is not ours.
  const first = noQuery.replace(/^\/+/, '').split('/')[0];
  if (first && first !== bucket && /-(photos|media|private)$|^avatars$/.test(first)) return null;
  return cleanPath(noQuery);
}

/** Avatar objects are "<userId>-<timestamp>.<ext>" at the bucket root. */
export function isOwnAvatarName(name: unknown, userId: string): boolean {
  return typeof name === 'string' && !!userId && name.startsWith(`${userId}-`) && !name.includes('/');
}

/** Chat uploads live under images/ or voice/. */
export function isChatMediaPath(path: string | null): path is string {
  return !!path && /^(images|voice)\/[^/]+$/.test(path);
}

/** A City Hub document entry is a string or { url, name }. */
export function cityHubDocumentRef(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object' && typeof (entry as { url?: unknown }).url === 'string') {
    return (entry as { url: string }).url;
  }
  return null;
}

/**
 * Split one general post's media into paths to delete and entries to keep.
 * Copies of incident photos (registry source_bucket = incident-photos) are kept.
 */
export function splitCityHubPostMedia(
  post: { id: string; photo_urls?: unknown; document_attachments?: unknown },
  protectedPaths: Set<string>
): { remove: string[]; keepPhotos: string[]; keepDocuments: unknown[] } {
  const remove: string[] = [];
  const keepPhotos: string[] = [];
  const keepDocuments: unknown[] = [];
  const photos = Array.isArray(post.photo_urls) ? post.photo_urls : [];
  for (const stored of photos) {
    const path = objectPathFor(stored, CITY_HUB_BUCKET, true);
    if (path && protectedPaths.has(path)) keepPhotos.push(stored as string);
    else if (path) remove.push(path);
  }
  const docs = Array.isArray(post.document_attachments) ? post.document_attachments : [];
  for (const entry of docs) {
    const path = objectPathFor(cityHubDocumentRef(entry), CITY_HUB_BUCKET, true);
    if (path && protectedPaths.has(path)) keepDocuments.push(entry);
    else if (path) remove.push(path);
  }
  return { remove, keepPhotos, keepDocuments };
}

export function chunk<T>(items: T[], size = REMOVE_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function addPath(plan: PurgePlan, bucket: string, path: string | null) {
  if (!path || !(PURGEABLE_BUCKETS as readonly string[]).includes(bucket)) return;
  const list = (plan.objects[bucket] ||= []);
  if (!list.includes(path)) list.push(path);
}

async function step(label: string, log: string, run: () => Promise<void>) {
  try {
    await run();
  } catch (e) {
    console.error(`${log} media purge [${label}]:`, e instanceof Error ? e.message : String(e));
  }
}

async function listFolder(admin: AdminClient, bucket: string, folder: string, search?: string) {
  const names: string[] = [];
  for (let offset = 0; offset < 20 * PAGE_SIZE; offset += PAGE_SIZE) {
    const { data, error } = await admin.storage
      .from(bucket)
      .list(folder, { limit: PAGE_SIZE, offset, ...(search ? { search } : {}) });
    if (error) throw error;
    // Folders come back with id null; only files are removed.
    for (const entry of data || []) if (entry?.name && entry.id) names.push(entry.name);
    if (!data || data.length < PAGE_SIZE) break;
  }
  return names;
}

/** Read everything needed to purge. Call before chat_messages / users rows are deleted. */
export async function buildAccountMediaPurgePlan(
  admin: AdminClient,
  userId: string,
  log = 'account-delete'
): Promise<PurgePlan> {
  const plan: PurgePlan = { userId, objects: {}, cityHubPosts: [] };
  if (!userId) return plan;

  await step('avatars', log, async () => {
    for (const name of await listFolder(admin, AVATARS_BUCKET, '', userId)) {
      if (isOwnAvatarName(name, userId)) addPath(plan, AVATARS_BUCKET, name);
    }
    const { data } = await admin.from('users').select('avatar_url').eq('id', userId).maybeSingle();
    const path = objectPathFor(data?.avatar_url, AVATARS_BUCKET);
    if (path && isOwnAvatarName(path, userId)) addPath(plan, AVATARS_BUCKET, path);
  });

  await step('chat-media', log, async () => {
    for (let from = 0; from < 200 * PAGE_SIZE; from += PAGE_SIZE) {
      const { data, error } = await admin
        .from('chat_messages')
        .select('id, media_url')
        .eq('sender_id', userId)
        .not('media_url', 'is', null)
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      for (const row of data || []) {
        const path = objectPathFor(row?.media_url, CHAT_MEDIA_BUCKET);
        if (isChatMediaPath(path)) addPath(plan, CHAT_MEDIA_BUCKET, path);
      }
      if (!data || data.length < PAGE_SIZE) break;
    }
  });

  await step('city-hub general posts', log, async () => {
    const { data: posts, error } = await admin
      .from('city_hub_posts')
      .select('id, type, photo_urls, document_attachments')
      .eq('created_by_user_id', userId)
      .eq('type', 'general');
    if (error) throw error;
    const ids = (posts || []).map((p: { id: string }) => p.id);
    if (!ids.length) return;

    // Copies of incident photos stay: incident media is never deleted on account removal.
    const protectedPaths = new Set<string>();
    for (const part of chunk(ids, 200)) {
      const { data: copies, error: copyErr } = await admin
        .from('city_hub_media_copies')
        .select('dest_path, source_bucket')
        .in('post_id', part);
      if (copyErr) throw copyErr; // unknown registry: keep everything for safety
      for (const c of copies || []) {
        if (c?.source_bucket === 'incident-photos' && c.dest_path) protectedPaths.add(c.dest_path);
      }
    }

    for (const post of posts || []) {
      const { remove, keepPhotos, keepDocuments } = splitCityHubPostMedia(post, protectedPaths);
      // Leftover files in the post folder that no column points at (e.g. failed edits).
      try {
        for (const name of await listFolder(admin, CITY_HUB_BUCKET, String(post.id))) {
          const path = `${post.id}/${name}`;
          if (!protectedPaths.has(path) && !remove.includes(path)) remove.push(path);
        }
      } catch (e) {
        console.error(`${log} media purge [city-hub folder]:`, e instanceof Error ? e.message : String(e));
      }
      remove.forEach((path) => addPath(plan, CITY_HUB_BUCKET, path));
      if (remove.length) plan.cityHubPosts.push({ id: post.id, keepPhotos, keepDocuments });
    }
  });

  await step('service listings', log, async () => {
    const { data: listings, error } = await admin
      .from('local_service_listings')
      .select('id, organization_id, photo_paths')
      .eq('owner_user_id', userId);
    if (error) throw error;
    for (const listing of listings || []) {
      const folder = `${listing.organization_id}/services/${listing.id}`;
      const photos = Array.isArray(listing.photo_paths) ? listing.photo_paths : [];
      for (const stored of photos) {
        const path = objectPathFor(stored, COMMUNITY_MEDIA_BUCKET, true);
        // Only this listing's own folder; never another feature's media.
        if (path && path.startsWith(`${folder}/`)) addPath(plan, COMMUNITY_MEDIA_BUCKET, path);
      }
      try {
        for (const name of await listFolder(admin, COMMUNITY_MEDIA_BUCKET, folder)) {
          addPath(plan, COMMUNITY_MEDIA_BUCKET, `${folder}/${name}`);
        }
      } catch (e) {
        console.error(`${log} media purge [services folder]:`, e instanceof Error ? e.message : String(e));
      }
    }
  });

  return plan;
}

/**
 * Remove the planned objects in batches, then clear City Hub references to removed files.
 * Missing objects are fine (remove is idempotent). Never throws.
 */
export async function runAccountMediaPurge(
  admin: AdminClient,
  plan: PurgePlan,
  log = 'account-delete'
): Promise<PurgeResult> {
  const result: PurgeResult = { removed: {}, failed: {}, postsCleared: 0 };
  for (const bucket of PURGEABLE_BUCKETS) {
    const paths = plan?.objects?.[bucket] || [];
    for (const batch of chunk(paths)) {
      try {
        const { error } = await admin.storage.from(bucket).remove(batch);
        if (error) throw error;
        result.removed[bucket] = (result.removed[bucket] || 0) + batch.length;
      } catch (e) {
        result.failed[bucket] = (result.failed[bucket] || 0) + batch.length;
        console.error(`${log} media purge [remove ${bucket}]:`, e instanceof Error ? e.message : String(e));
      }
    }
  }
  for (const post of plan?.cityHubPosts || []) {
    try {
      const { error } = await admin
        .from('city_hub_posts')
        .update({ photo_urls: post.keepPhotos, document_attachments: post.keepDocuments })
        .eq('id', post.id)
        .eq('type', 'general');
      if (error) throw error;
      result.postsCleared += 1;
    } catch (e) {
      console.error(`${log} media purge [city-hub post refs]:`, e instanceof Error ? e.message : String(e));
    }
  }
  console.log(`${log} media purge: removed ${JSON.stringify(result.removed)}, failed ${JSON.stringify(result.failed)}, posts cleared ${result.postsCleared}`);
  return result;
}
