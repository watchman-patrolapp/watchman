import { supabase } from "../supabase/client";

export const COMMUNITY_MEDIA_BUCKET = "community-media";
export const COMMUNITY_PRIVATE_BUCKET = "community-private";
export const COMMUNITY_MEDIA_FEATURES = ["needs", "equipment", "services", "events", "lost-found"];
export const MAX_COMMUNITY_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_COMMUNITY_PRIVATE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1600;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PRIVATE_TYPES = [...IMAGE_TYPES, "application/pdf"];

// Same pattern as utils/cityHubPhotos.js.
function safeFileExt(file, fallback) {
  return (
    String(file?.name?.split(".").pop() || fallback)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 8) || fallback
  );
}

function safeSegment(value, label) {
  const s = String(value ?? "").trim();
  if (!s || !/^[A-Za-z0-9_-]+$/.test(s)) throw new Error(`Invalid ${label}`);
  return s;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    img.src = url;
  });
}

/** Downscale to <= 1600 px on the long edge (canvas). Returns the original file if no resize is needed or possible. */
export async function compressImage(file, maxEdge = MAX_IMAGE_EDGE, quality = 0.85) {
  if (!file || !IMAGE_TYPES.includes(file.type) || typeof document === "undefined") return file;
  try {
    const img = await loadImage(file);
    const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
    if (!longEdge || longEdge <= maxEdge) return file;
    const scale = maxEdge / longEdge;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const outType = file.type === "image/png" ? "image/png" : file.type;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, outType, quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name, { type: outType, lastModified: Date.now() });
  } catch {
    return file;
  }
}

/**
 * Upload an image to community-media at {orgId}/{feature}/{entityId}/{timestamp}_{n}.{ext}.
 * Storage policy only accepts paths inside the caller's own organization.
 */
export async function uploadCommunityImage({ orgId, feature, entityId, file, index = 0 }) {
  if (!file) throw new Error("No file selected");
  if (!IMAGE_TYPES.includes(file.type)) throw new Error("Use a JPEG, PNG or WebP image");
  if (!COMMUNITY_MEDIA_FEATURES.includes(feature)) throw new Error("Invalid feature");
  const org = safeSegment(orgId, "organization");
  const entity = safeSegment(entityId, "item");
  const upload = await compressImage(file);
  if (upload.size > MAX_COMMUNITY_IMAGE_BYTES) throw new Error("Image is larger than 8 MB");
  const ext = safeFileExt(upload, "jpg");
  const path = `${org}/${feature}/${entity}/${Date.now()}_${index}.${ext}`;
  const { error } = await supabase.storage
    .from(COMMUNITY_MEDIA_BUCKET)
    .upload(path, upload, { contentType: upload.type, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from(COMMUNITY_MEDIA_BUCKET).getPublicUrl(path);
  return { path, publicUrl: data?.publicUrl ?? null };
}

/** Upload to the private bucket. `subPath` is relative to {orgId}/, e.g. "equipment/<unit>/invoice". */
export async function uploadPrivateFile({ orgId, subPath, file, index = 0 }) {
  if (!file) throw new Error("No file selected");
  if (!PRIVATE_TYPES.includes(file.type)) throw new Error("Use an image or a PDF");
  const org = safeSegment(orgId, "organization");
  const segments = String(subPath ?? "")
    .split("/")
    .filter(Boolean)
    .map((s) => safeSegment(s, "path"));
  if (segments.length === 0) throw new Error("Invalid path");
  const upload = file.type === "application/pdf" ? file : await compressImage(file);
  if (upload.size > MAX_COMMUNITY_PRIVATE_BYTES) throw new Error("File is larger than 10 MB");
  const ext = safeFileExt(upload, upload.type === "application/pdf" ? "pdf" : "jpg");
  const path = `${org}/${segments.join("/")}/${Date.now()}_${index}.${ext}`;
  const { error } = await supabase.storage
    .from(COMMUNITY_PRIVATE_BUCKET)
    .upload(path, upload, { contentType: upload.type, upsert: false });
  if (error) throw error;
  return { path };
}

/** Short-lived signed URL for a community-private object (default 5 minutes). */
export async function getSignedUrl(path, expiresIn = 300) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(COMMUNITY_PRIVATE_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data?.signedUrl ?? null;
}
