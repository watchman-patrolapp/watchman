import { supabase } from "../supabase/client";

export const CITY_HUB_PHOTO_BUCKET = "city-hub-photos";
export const MAX_CITY_HUB_PHOTOS = 6;
export const MAX_CITY_HUB_DOCUMENTS = 4;
export const MAX_CITY_HUB_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_CITY_HUB_DOCUMENT_BYTES = 20 * 1024 * 1024;

export function cityHubPhotoList(post) {
  const urls = post?.photo_urls;
  if (!Array.isArray(urls)) return [];
  return urls.filter((url) => typeof url === "string" && url.trim());
}

export function cityHubDocumentList(post) {
  const rows = post?.document_attachments;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (typeof row === "string" && row.trim()) {
        return { url: row.trim(), name: "Document.pdf" };
      }
      const url = typeof row?.url === "string" ? row.url.trim() : "";
      if (!url) return null;
      const name = String(row?.name || "Document.pdf").trim() || "Document.pdf";
      return { url, name };
    })
    .filter(Boolean);
}

function safeFileExt(file, fallback) {
  return (
    String(file?.name?.split(".").pop() || fallback)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 8) || fallback
  );
}

async function uploadCityHubFile(postId, file, index, prefix) {
  const ext = safeFileExt(file, prefix === "doc" ? "pdf" : "jpg");
  const filePath = `${postId}/${prefix}_${Date.now()}_${index}.${ext}`;
  const { error } = await supabase.storage.from(CITY_HUB_PHOTO_BUCKET).upload(filePath, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) {
    throw new Error(
      error.message ||
        `Could not upload ${file.name}. Run the City Hub photos/PDF SQL if the bucket is missing.`
    );
  }
  const { data } = supabase.storage.from(CITY_HUB_PHOTO_BUCKET).getPublicUrl(filePath);
  return data?.publicUrl || "";
}

export async function uploadCityHubPhotos(postId, files) {
  const uploaded = [];
  const list = Array.from(files || []).slice(0, MAX_CITY_HUB_PHOTOS);
  for (let index = 0; index < list.length; index += 1) {
    const file = list[index];
    if (!file?.type?.startsWith("image/")) {
      throw new Error(`${file?.name || "File"} is not an image.`);
    }
    if (file.size > MAX_CITY_HUB_PHOTO_BYTES) {
      throw new Error(`${file.name} is larger than 10MB.`);
    }
    const url = await uploadCityHubFile(postId, file, index, "img");
    if (url) uploaded.push(url);
  }
  return uploaded;
}

export function isCityHubPdf(file) {
  if (!file) return false;
  if (file.type === "application/pdf") return true;
  return String(file.name || "").toLowerCase().endsWith(".pdf");
}

export async function uploadCityHubDocuments(postId, files) {
  const uploaded = [];
  const list = Array.from(files || []).slice(0, MAX_CITY_HUB_DOCUMENTS);
  for (let index = 0; index < list.length; index += 1) {
    const file = list[index];
    if (!isCityHubPdf(file)) {
      throw new Error(`${file?.name || "File"} is not a PDF.`);
    }
    if (file.size > MAX_CITY_HUB_DOCUMENT_BYTES) {
      throw new Error(`${file.name} is larger than 20MB.`);
    }
    const url = await uploadCityHubFile(postId, file, index, "pdf");
    if (url) {
      uploaded.push({
        url,
        name: String(file.name || "Document.pdf").slice(0, 180),
      });
    }
  }
  return uploaded;
}
