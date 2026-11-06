export const INCIDENT_PHOTOS_BUCKET = "incident-photos";
export const COMMUNITY_MEDIA_BUCKET = "community-media";
export const CITY_HUB_PHOTO_BUCKET = "city-hub-photos";

export const PRIVATE_MEDIA_BUCKETS = [
  INCIDENT_PHOTOS_BUCKET,
  COMMUNITY_MEDIA_BUCKET,
  CITY_HUB_PHOTO_BUCKET,
];

function sanitizeObjectPath(raw) {
  if (!raw) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  if (
    !decoded ||
    decoded.startsWith("/") ||
    decoded.includes("..") ||
    decoded.includes("\\") ||
    decoded.includes("\0")
  ) {
    return null;
  }
  return decoded;
}

/**
 * Turn a stored public URL or object path into `{ bucket, path }`.
 * Bare paths need `defaultBucket` because they do not name a bucket.
 * A URL for a different bucket returns null.
 */
export function resolveMediaRef(stored, defaultBucket = null) {
  if (typeof stored !== "string") return null;
  const trimmed = stored.trim();
  if (!trimmed || trimmed.startsWith("blob:") || trimmed.startsWith("data:")) return null;

  const noQuery = trimmed.split("#")[0].split("?")[0];

  for (const bucket of PRIVATE_MEDIA_BUCKETS) {
    const marker = `/${bucket}/`;
    const at = noQuery.lastIndexOf(marker);
    if (at !== -1) {
      const path = sanitizeObjectPath(noQuery.slice(at + marker.length));
      return path ? { bucket, path } : null;
    }
    const prefix = `${bucket}/`;
    if (noQuery.startsWith(prefix)) {
      const path = sanitizeObjectPath(noQuery.slice(prefix.length));
      return path ? { bucket, path } : null;
    }
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(noQuery)) return null;
  if (!defaultBucket || !PRIVATE_MEDIA_BUCKETS.includes(defaultBucket)) return null;
  const path = sanitizeObjectPath(noQuery.replace(/^\/+/, ""));
  return path ? { bucket: defaultBucket, path } : null;
}

/** `bucket/object/path` so a mixed column can remember which bucket a file came from. */
export function prefixedMediaRef(stored, defaultBucket) {
  const ref = resolveMediaRef(stored, defaultBucket);
  if (!ref) return null;
  return `${ref.bucket}/${ref.path}`;
}

/** Object path only. Use when the column is known to belong to one bucket. */
export function bareMediaPath(stored, defaultBucket) {
  return resolveMediaRef(stored, defaultBucket)?.path ?? null;
}
