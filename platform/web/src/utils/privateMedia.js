import { useEffect, useState } from "react";
import { supabase } from "../supabase/client";
import {
  CITY_HUB_PHOTO_BUCKET,
  resolveMediaRef,
} from "./privateMediaPath";

export const SIGNED_URL_TTL_SECONDS = 60 * 60;
const REFRESH_BEFORE_EXPIRY_SECONDS = 120;

const signedUrlCache = new Map();

export const MEDIA_UNAVAILABLE = "Photo unavailable";

export function friendlyMediaMessage(kind) {
  if (kind === "upload") return "That file could not be saved. Try again.";
  if (kind === "share") return "Could not share to City Hub. Try again.";
  if (kind === "copy") return "The post was published, but the selected photos could not be copied.";
  if (kind === "remove") return "The post was updated, but an attachment could not be removed.";
  return MEDIA_UNAVAILABLE;
}

function cacheKey(ref) {
  return `${ref.bucket}:${ref.path}`;
}

function readCache(ref) {
  const hit = signedUrlCache.get(cacheKey(ref));
  if (!hit) return "";
  if (hit.expiresAt <= Date.now()) {
    signedUrlCache.delete(cacheKey(ref));
    return "";
  }
  return hit.url;
}

function writeCache(ref, url) {
  signedUrlCache.set(cacheKey(ref), {
    url,
    expiresAt: Date.now() + (SIGNED_URL_TTL_SECONDS - REFRESH_BEFORE_EXPIRY_SECONDS) * 1000,
  });
}

export async function resolveSignedMediaUrl(stored, defaultBucket = null) {
  const ref = resolveMediaRef(stored, defaultBucket);
  if (!ref) return null;
  const cached = readCache(ref);
  if (cached) return cached;
  try {
    const { data, error } = await supabase.storage
      .from(ref.bucket)
      .createSignedUrl(ref.path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    writeCache(ref, data.signedUrl);
    return data.signedUrl;
  } catch {
    return null;
  }
}

function listKey(storedList, defaultBucket) {
  const list = Array.isArray(storedList) ? storedList : [];
  return JSON.stringify([
    defaultBucket || "",
    list.map((value) => (value == null ? "" : String(value))),
  ]);
}

function syncSignedList(key) {
  const [bucket, stored] = JSON.parse(key);
  return stored.map((value) => {
    const ref = resolveMediaRef(value, bucket || null);
    if (!ref) return null;
    return readCache(ref) || "";
  });
}

/**
 * Signed URLs aligned with `storedList`. A cache hit is available on the first
 * render. `""` means still loading, `null` means the file cannot be shown.
 */
export function useSignedMediaSrcList(storedList, defaultBucket = null) {
  const key = listKey(storedList, defaultBucket);
  const [resolved, setResolved] = useState(() => syncSignedList(key));

  useEffect(() => {
    let cancelled = false;
    const sync = syncSignedList(key);
    setResolved(sync);
    const [bucket, stored] = JSON.parse(key);
    const pending = stored
      .map((value, index) => ({ value, index }))
      .filter((item) => sync[item.index] === "");
    if (pending.length === 0) return undefined;
    Promise.all(
      pending.map(async (item) => [item.index, await resolveSignedMediaUrl(item.value, bucket || null)])
    ).then((pairs) => {
      if (cancelled) return;
      setResolved((prev) => {
        const next = prev.slice();
        for (const [index, url] of pairs) next[index] = url;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return resolved;
}

export function useSignedMediaSrc(stored, defaultBucket = null) {
  const [resolved] = useSignedMediaSrcList([stored], defaultBucket);
  return resolved;
}

export async function copyMediaToCityHub(postId, stored, defaultBucket) {
  const ref = resolveMediaRef(stored, defaultBucket);
  if (!postId || !ref) return null;
  if (ref.bucket !== "incident-photos" && ref.bucket !== "community-media") return null;
  const ext = (ref.path.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "jpg";
  const destPath = `${postId}/copy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const downloaded = await supabase.storage.from(ref.bucket).download(ref.path);
  if (downloaded.error || !downloaded.data) return null;
  const uploaded = await supabase.storage.from(CITY_HUB_PHOTO_BUCKET).upload(destPath, downloaded.data, {
    contentType: downloaded.data.type || undefined,
    upsert: false,
  });
  if (uploaded.error) return null;
  const recorded = await supabase.rpc("record_city_hub_media_copy", {
    p_post_id: postId,
    p_source_bucket: ref.bucket,
    p_source_path: ref.path,
    p_dest_path: destPath,
  });
  if (recorded.error) {
    await supabase.storage.from(CITY_HUB_PHOTO_BUCKET).remove([destPath]);
    return null;
  }
  return destPath;
}

/** Remove City Hub copies and direct attachments for a post. Originals are not touched. */
export async function removeCityHubPostMedia(postId) {
  if (!postId) return { ok: false };
  const paths = new Set();
  const listedCopies = await supabase.rpc("list_city_hub_media_copy_paths", { p_post_id: postId });
  if (Array.isArray(listedCopies.data)) {
    listedCopies.data.forEach((path) => {
      if (path) paths.add(path);
    });
  }
  const folder = await supabase.storage.from(CITY_HUB_PHOTO_BUCKET).list(String(postId), { limit: 1000 });
  (folder.data || []).forEach((entry) => {
    if (entry?.name && entry.id) paths.add(`${postId}/${entry.name}`);
  });
  const missingRegistry = Boolean(
    listedCopies.error &&
      /could not find the function|schema cache|PGRST202/i.test(String(listedCopies.error.message || listedCopies.error.code || ""))
  );
  if (paths.size === 0) return { ok: missingRegistry || (!listedCopies.error && !folder.error) };
  const removed = await supabase.storage.from(CITY_HUB_PHOTO_BUCKET).remove([...paths]);
  return { ok: !removed.error };
}
