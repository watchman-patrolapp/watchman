/**
 * Share a patrol card to WhatsApp.
 *   1) render the off-screen card to PNG (html-to-image, pixelRatio 3, after fonts load)
 *   2) Web Share with the image file (Android Chrome / iOS Safari / supporting WebViews)
 *   3) fallback: wa.me link with the caption (text only)
 * Only call sharePatrolToWhatsApp from a tap handler (Web Share needs user activation).
 * The patrol is marked shared only when the share sheet / WhatsApp actually opened:
 * an AbortError (user dismissed the share sheet) never marks.
 */
import { toBlob } from "html-to-image";
import { Capacitor } from "@capacitor/core";
import { supabase } from "../supabase/client";
import { buildShareCaption, shareImageFileName } from "./patrolFormat";

export const SHARE_PIXEL_RATIO = 3;

async function waitForFonts() {
  try {
    if (typeof document !== "undefined" && document.fonts?.ready) await document.fonts.ready;
  } catch {
    /* ignore */
  }
}

export async function renderShareCardBlob(node) {
  if (!node) throw new Error("Share card is not ready");
  await waitForFonts();
  // Two frames so a freshly mounted card has laid out.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const blob = await toBlob(node, {
    pixelRatio: SHARE_PIXEL_RATIO,
    cacheBust: true,
    skipFonts: true, // system fonts only; avoids cross-origin stylesheet reads
  });
  if (!blob) throw new Error("Could not create the image");
  return blob;
}

export function whatsAppTextUrl(caption) {
  return `https://wa.me/?text=${encodeURIComponent(caption || "")}`;
}

function isAbort(err) {
  return err?.name === "AbortError" || /abort|cancel/i.test(String(err?.message || err || ""));
}

const NATIVE_SHARE_DIR = "patrol-share";
const NATIVE_KEEP_MS = 24 * 60 * 60 * 1000;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Delete cached share PNGs older than a day (keeps the one being shared). */
async function cleanupNativeShareCache(Filesystem, Directory) {
  try {
    const { files } = await Filesystem.readdir({ path: NATIVE_SHARE_DIR, directory: Directory.Cache });
    const cutoff = Date.now() - NATIVE_KEEP_MS;
    await Promise.all(
      (files || [])
        .filter((f) => f.type !== "directory" && Number(f.mtime || 0) < cutoff)
        .map((f) => Filesystem.deleteFile({ path: `${NATIVE_SHARE_DIR}/${f.name}`, directory: Directory.Cache }).catch(() => {}))
    );
  } catch {
    /* folder does not exist yet */
  }
}

/** Capacitor (Android/iOS app): PNG -> Cache dir -> native share sheet. */
async function shareNative({ blob, caption, fileName }) {
  const [{ Share }, { Filesystem, Directory }] = await Promise.all([import("@capacitor/share"), import("@capacitor/filesystem")]);
  const title = "Share patrol";
  if (blob) {
    let uri = null;
    try {
      await cleanupNativeShareCache(Filesystem, Directory);
      const data = await blobToBase64(blob);
      const res = await Filesystem.writeFile({
        path: `${NATIVE_SHARE_DIR}/${Date.now()}-${fileName}`,
        data,
        directory: Directory.Cache,
        recursive: true,
      });
      uri = res.uri;
    } catch (err) {
      console.warn("Native share: could not write image", err);
    }
    if (uri) {
      try {
        await Share.share({ files: [uri], text: caption, title, dialogTitle: title });
        return { status: "shared" };
      } catch (err) {
        if (isAbort(err)) return { status: "cancelled" };
        console.warn("Native share with image failed, trying text", err);
      }
    }
  }
  try {
    await Share.share({ text: caption, title, dialogTitle: title });
    return { status: "shared" };
  } catch (err) {
    if (isAbort(err)) return { status: "cancelled" };
    console.warn("Native text share failed, falling back to wa.me", err);
  }
  return null;
}

/**
 * @returns {Promise<{ status: 'shared' | 'fallback' | 'cancelled' | 'error', error?: Error }>}
 */
export async function sharePatrolToWhatsApp({ node, blob: readyBlob, caption, fileName = "patrol.png" }) {
  let file = null;
  try {
    // Prefer the blob pre-rendered when the sheet opened, so the tap's user
    // activation is still valid when navigator.share runs.
    const blob = readyBlob || (await renderShareCardBlob(node));
    file = new File([blob], fileName, { type: "image/png" });
  } catch (err) {
    console.warn("Share card render failed, sharing text only", err);
  }

  if (Capacitor.isNativePlatform()) {
    let blob = readyBlob || null;
    if (!blob && file) blob = file;
    const res = await shareNative({ blob, caption, fileName });
    if (res) return res;
    try {
      window.open(whatsAppTextUrl(caption), "_system");
      return { status: "fallback" };
    } catch (err) {
      return { status: "error", error: err };
    }
  }

  const nav = typeof navigator !== "undefined" ? navigator : null;
  if (nav?.share) {
    const withFile = file ? { files: [file], text: caption } : null;
    const canFile = withFile && (!nav.canShare || nav.canShare({ files: [file] }));
    try {
      if (canFile) {
        await nav.share(withFile);
        return { status: "shared" };
      }
      if (!file) {
        await nav.share({ text: caption });
        return { status: "shared" };
      }
    } catch (err) {
      if (isAbort(err)) return { status: "cancelled" };
      console.warn("Web Share failed, falling back to wa.me", err);
    }
  }

  try {
    const w = window.open(whatsAppTextUrl(caption), "_blank", "noopener,noreferrer");
    if (!w) window.location.href = whatsAppTextUrl(caption);
    return { status: "fallback" };
  } catch (err) {
    return { status: "error", error: err };
  }
}

export async function markPatrolShared(shareRef, kind) {
  const { data, error } = await supabase.rpc("mark_patrol_shared", { p_share_ref: shareRef, p_kind: kind });
  if (error) throw error;
  return data;
}

export async function fetchPatrolShare(shareRef) {
  const { data, error } = await supabase.rpc("get_patrol_share", { p_share_ref: shareRef });
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data || null;
}

export async function fetchMyPendingPatrolShares() {
  const { data, error } = await supabase.rpc("list_my_pending_patrol_shares");
  if (error) throw error;
  return data || [];
}

export { buildShareCaption };

/**
 * True when this device can hand an image file to the share sheet
 * (Capacitor native, or Web Share Level 2 with files: Android Chrome, iOS Safari).
 * Desktop browsers usually return false; the sheet then offers Copy/Download.
 */
export function canShareImageFiles() {
  try {
    if (Capacitor.isNativePlatform()) return true;
    const nav = typeof navigator !== "undefined" ? navigator : null;
    if (!nav?.share || !nav?.canShare || typeof File === "undefined") return false;
    const probe = new File([new Uint8Array([0])], "probe.png", { type: "image/png" });
    return Boolean(nav.canShare({ files: [probe] }));
  } catch {
    return false;
  }
}

/** Async Clipboard API with image support (Chrome/Edge, Safari, Firefox 127+), secure context only. */
export function canCopyImageToClipboard() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext !== false &&
    typeof window.ClipboardItem !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  );
}

/** Put the PNG on the clipboard. Does not mark the patrol as shared. */
export async function copyImageToClipboard(blob) {
  if (!blob) throw new Error("Image is not ready");
  if (!canCopyImageToClipboard()) throw new Error("Copying images is not supported in this browser");
  const png = blob.type === "image/png" ? blob : new Blob([blob], { type: "image/png" });
  await navigator.clipboard.write([new window.ClipboardItem({ "image/png": png })]);
}

/** Save the PNG through a temporary link. Does not mark the patrol as shared. */
export function downloadImage(blob, fileName) {
  if (!blob) throw new Error("Image is not ready");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || "watchman-patrol.png";
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export { shareImageFileName };
