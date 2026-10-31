import { supabase } from "../supabase/client";
import { COMMUNITY_MEDIA_BUCKET, MAX_COMMUNITY_IMAGE_BYTES, compressImage } from "./communityMedia";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const SEGMENT = /^[A-Za-z0-9_-]+$/;
const XHR_TIMEOUT_MS = 120000;

function seg(value, label) {
  const s = String(value ?? "").trim();
  if (!s || !SEGMENT.test(s)) throw new Error(`Invalid ${label}`);
  return s;
}

function extFor(file) {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

function xhrUpload({ url, token, anonKey, body, contentType, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.timeout = XHR_TIMEOUT_MS;
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let msg = `Upload failed (${xhr.status})`;
        try {
          msg = JSON.parse(xhr.responseText)?.message || msg;
        } catch {
          /* keep default */
        }
        const err = new Error(msg);
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.send(body);
  });
}

/**
 * Upload one image to community-media/{org}/{feature}/{entity}/... with progress.
 * XHR to the Storage REST endpoint (xhr.upload.onprogress); falls back to
 * supabase.storage.upload (no progress) if XHR fails for a non-permission reason.
 * onProgress(0..100). Returns { path }.
 */
export async function uploadCommunityImageWithProgress({ orgId, feature = "needs", entityId, subdir = null, file, index = 0, onProgress }) {
  if (!file) throw new Error("No file selected");
  if (!IMAGE_TYPES.includes(file.type)) throw new Error("Use a JPEG, PNG or WebP image");
  const org = seg(orgId, "organization");
  const entity = seg(entityId, "item");
  const featureSeg = seg(feature, "feature");
  onProgress?.(0);
  const upload = await compressImage(file);
  if (upload.size > MAX_COMMUNITY_IMAGE_BYTES) throw new Error("Image is larger than 8 MB after compression");
  const contentType = upload.type || file.type;
  const path = `${org}/${featureSeg}/${entity}/${subdir ? `${seg(subdir, "folder")}/` : ""}${Date.now()}_${index}.${extFor({ type: contentType })}`;

  const baseUrl = String(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;

  if (baseUrl && anonKey && token && typeof XMLHttpRequest !== "undefined") {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    try {
      await xhrUpload({
        url: `${baseUrl}/storage/v1/object/${COMMUNITY_MEDIA_BUCKET}/${encoded}`,
        token,
        anonKey,
        body: upload,
        contentType,
        onProgress,
      });
      onProgress?.(100);
      return { path };
    } catch (err) {
      // Permission / validation errors would fail the same way; surface them.
      if (err?.status && err.status >= 400 && err.status < 500 && err.status !== 408) throw err;
    }
  }
  const { error } = await supabase.storage
    .from(COMMUNITY_MEDIA_BUCKET)
    .upload(path, upload, { contentType, upsert: false });
  if (error) throw error;
  onProgress?.(100);
  return { path };
}
