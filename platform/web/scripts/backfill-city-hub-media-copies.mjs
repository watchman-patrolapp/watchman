/**
 * Copy City Hub references that still point at incident-photos or community-media
 * into city-hub-photos. Does not re-upload originals and does not attach photos
 * that were never stored on the post.
 *
 * From platform/web:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-city-hub-media-copies.mjs
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-city-hub-media-copies.mjs --apply
 *
 * Without --apply it only prints how many copies it would make.
 */
import { createClient } from "@supabase/supabase-js";
import {
  CITY_HUB_PHOTO_BUCKET,
  COMMUNITY_MEDIA_BUCKET,
  INCIDENT_PHOTOS_BUCKET,
  resolveMediaRef,
} from "../src/utils/privateMediaPath.js";

const APPLY = process.argv.includes("--apply");
const SOURCE_BUCKETS = new Set([INCIDENT_PHOTOS_BUCKET, COMMUNITY_MEDIA_BUCKET]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  fail("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The key is not printed.");
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function referencesOnPost(post) {
  const found = [];
  for (const value of post.photo_urls || []) {
    const ref = resolveMediaRef(value, null);
    if (ref && SOURCE_BUCKETS.has(ref.bucket)) found.push({ field: "photo", stored: value, ref });
  }
  const docs = Array.isArray(post.document_attachments) ? post.document_attachments : [];
  docs.forEach((doc, index) => {
    const stored = typeof doc === "string" ? doc : doc?.url;
    const ref = resolveMediaRef(stored, null);
    if (ref && SOURCE_BUCKETS.has(ref.bucket)) found.push({ field: "document", index, stored, ref, name: doc?.name });
  });
  return found;
}

async function existingCopy(postId, ref) {
  const { data, error } = await supabase
    .from("city_hub_media_copies")
    .select("dest_path")
    .eq("post_id", postId)
    .eq("source_bucket", ref.bucket)
    .eq("source_path", ref.path)
    .maybeSingle();
  if (error) throw new Error("Could not read the copy registry.");
  return data?.dest_path || null;
}

async function copyOne(postId, ref) {
  const already = await existingCopy(postId, ref);
  if (already) return already;
  const ext = (ref.path.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "jpg";
  const destPath = `${postId}/copy_backfill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const downloaded = await supabase.storage.from(ref.bucket).download(ref.path);
  if (downloaded.error || !downloaded.data) {
    console.error(`Skip ${ref.bucket}/${ref.path}: the file could not be read.`);
    return null;
  }
  const uploaded = await supabase.storage.from(CITY_HUB_PHOTO_BUCKET).upload(destPath, downloaded.data, {
    contentType: downloaded.data.type || undefined,
    upsert: false,
  });
  if (uploaded.error) {
    console.error(`Skip ${ref.bucket}/${ref.path}: the City Hub copy could not be saved.`);
    return null;
  }
  const recorded = await supabase.from("city_hub_media_copies").insert({
    post_id: postId,
    source_bucket: ref.bucket,
    source_path: ref.path,
    dest_path: destPath,
  });
  if (recorded.error) {
    await supabase.storage.from(CITY_HUB_PHOTO_BUCKET).remove([destPath]);
    console.error(`Skip ${ref.bucket}/${ref.path}: the copy registry could not be updated.`);
    return null;
  }
  return destPath;
}

async function main() {
  const { data: posts, error } = await supabase
    .from("city_hub_posts")
    .select("id, status, photo_urls, document_attachments")
    .eq("status", "published");
  if (error) fail("Could not list City Hub posts.");

  let planned = 0;
  let copied = 0;
  let skipped = 0;
  for (const post of posts || []) {
    const refs = referencesOnPost(post);
    if (refs.length === 0) continue;
    planned += refs.length;
    if (!APPLY) {
      console.log(`${post.id}: ${refs.length} file(s) would be copied`);
      continue;
    }
    const photoUrls = [...(post.photo_urls || [])];
    const documents = (Array.isArray(post.document_attachments) ? post.document_attachments : []).map((doc) =>
      typeof doc === "string" ? { url: doc, name: "Document.pdf" } : { ...doc }
    );
    let changed = false;
    for (const item of refs) {
      const dest = await copyOne(post.id, item.ref);
      if (!dest) {
        skipped += 1;
        continue;
      }
      copied += 1;
      if (item.field === "photo") {
        const at = photoUrls.indexOf(item.stored);
        if (at !== -1) photoUrls[at] = dest;
        changed = true;
      } else if (documents[item.index]) {
        documents[item.index] = { ...documents[item.index], url: dest };
        changed = true;
      }
    }
    if (!changed) continue;
    const updated = await supabase
      .from("city_hub_posts")
      .update({ photo_urls: photoUrls, document_attachments: documents })
      .eq("id", post.id);
    if (updated.error) {
      console.error(`Post ${post.id} was copied but its record could not be updated.`);
    }
  }

  if (!APPLY) {
    console.log(planned === 0 ? "No City Hub posts need a copy." : `${planned} file(s) would be copied. Re-run with --apply.`);
    return;
  }
  console.log(`Copied ${copied}. Skipped ${skipped}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "Backfill failed.");
  process.exit(1);
});
