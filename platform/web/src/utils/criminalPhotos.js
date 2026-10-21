import { useEffect, useState } from 'react';
import { supabase } from '../supabase/client';

export const CRIMINAL_PHOTOS_BUCKET = 'criminal-photos';

const SIGNED_URL_TTL_SECONDS = 60 * 60;
const signedUrlCache = new Map();

/**
 * Object path inside criminal-photos, or null when `storedUrl` is some other image.
 * Profiles keep the public object URL (`getPublicUrl`) as a stable id. Signing
 * happens at display time so a private bucket still shows the existing files.
 */
export function criminalPhotoObjectPath(storedUrl) {
  if (typeof storedUrl !== 'string') return null;
  const trimmed = storedUrl.trim();
  if (!trimmed || trimmed.startsWith('blob:') || trimmed.startsWith('data:')) return null;

  const withoutHash = trimmed.split('#')[0];
  const withoutQuery = withoutHash.split('?')[0];
  const marker = `/${CRIMINAL_PHOTOS_BUCKET}/`;
  const markerAt = withoutQuery.lastIndexOf(marker);
  let raw = null;
  if (markerAt !== -1) {
    raw = withoutQuery.slice(markerAt + marker.length);
  } else if (withoutQuery.startsWith('criminal-profiles/')) {
    raw = withoutQuery;
  }
  if (!raw || raw.startsWith('/') || raw.includes('..')) return null;

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  if (!decoded || decoded.startsWith('/') || decoded.includes('..')) return null;
  return decoded;
}

export function isCriminalPhotoReference(storedUrl) {
  return criminalPhotoObjectPath(storedUrl) != null;
}

function cachedSignedUrl(path) {
  const hit = signedUrlCache.get(path);
  if (!hit) return '';
  if (hit.expiresAt <= Date.now()) {
    signedUrlCache.delete(path);
    return '';
  }
  return hit.url;
}

/**
 * Signed URL for a criminal-photos object. Other URLs (incident photos, blob
 * previews) pass through. If signing fails, the stored URL is returned so a
 * still-public bucket keeps rendering until this migration is applied.
 */
export async function resolveCriminalPhotoUrl(storedUrl) {
  if (!storedUrl) return '';
  const path = criminalPhotoObjectPath(storedUrl);
  if (!path) return storedUrl;

  const cached = cachedSignedUrl(path);
  if (cached) return cached;

  try {
    const { data, error } = await supabase.storage
      .from(CRIMINAL_PHOTOS_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (!error && data?.signedUrl) {
      signedUrlCache.set(path, {
        url: data.signedUrl,
        expiresAt: Date.now() + (SIGNED_URL_TTL_SECONDS - 120) * 1000,
      });
      return data.signedUrl;
    }
  } catch {
    // Permission or network failure: caller falls back to the stored URL.
  }
  return storedUrl;
}

export function useCriminalPhotoSrcList(urls) {
  const list = Array.isArray(urls) ? urls : [];
  const key = list.map((url) => url || '').join('\n');
  const [signedBySource, setSignedBySource] = useState({});

  useEffect(() => {
    const sources = key ? key.split('\n') : [];
    const criminal = sources.filter((url) => isCriminalPhotoReference(url));
    if (criminal.length === 0) return undefined;
    let cancelled = false;
    Promise.all(
      criminal.map(async (url) => [url, await resolveCriminalPhotoUrl(url)])
    ).then((pairs) => {
      if (cancelled) return;
      setSignedBySource((prev) => {
        const next = { ...prev };
        for (const [url, resolved] of pairs) next[url] = resolved;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return list.map((url) => {
    if (!url || !isCriminalPhotoReference(url)) return url || '';
    return signedBySource[url] || '';
  });
}

export async function removeCriminalPhoto(storedUrl) {
  const path = criminalPhotoObjectPath(storedUrl);
  if (!path) return { error: null };
  return supabase.storage.from(CRIMINAL_PHOTOS_BUCKET).remove([path]);
}
