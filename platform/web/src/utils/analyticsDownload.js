/**
 * Saving and printing analytics reports. Web: CSV download + browser print (Save as PDF).
 * Android app: CSV through the native share sheet; printing isn't available in the app WebView.
 */
import { Capacitor } from "@capacitor/core";

const EXPORT_DIR = "analytics-exports";

export function canPrintReport() {
  try {
    return !Capacitor.isNativePlatform() && typeof window !== "undefined" && typeof window.print === "function";
  } catch {
    return false;
  }
}

async function shareCsvNative(csv, fileName) {
  const [{ Share }, { Filesystem, Directory, Encoding }] = await Promise.all([import("@capacitor/share"), import("@capacitor/filesystem")]);
  try {
    const { files } = await Filesystem.readdir({ path: EXPORT_DIR, directory: Directory.Cache });
    await Promise.all((files || []).map((f) => Filesystem.deleteFile({ path: `${EXPORT_DIR}/${f.name}`, directory: Directory.Cache }).catch(() => {})));
  } catch {
    // Folder doesn't exist yet.
  }
  const res = await Filesystem.writeFile({ path: `${EXPORT_DIR}/${fileName}`, data: csv, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
  try {
    await Share.share({ files: [res.uri], title: "Analytics export", dialogTitle: "Save or send the analytics CSV" });
  } catch (err) {
    if (/cancel/i.test(String(err?.message || err))) return "cancelled";
    throw err;
  }
  return "shared";
}

/** Returns "downloaded" | "shared" | "cancelled"; throws on failure. */
export async function saveCsv(csv, fileName) {
  if (Capacitor.isNativePlatform()) return shareCsvNative(csv, fileName);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Prints the report in light mode at a fixed page width so charts redraw to fit A4 landscape.
 * The `analytics-printing` class (see index.css) also reveals the print header.
 */
export async function printReport() {
  const root = document.documentElement;
  const wasDark = root.classList.contains("dark");
  root.classList.add("analytics-printing");
  if (wasDark) root.classList.remove("dark");
  const restore = () => {
    root.classList.remove("analytics-printing");
    if (wasDark) root.classList.add("dark");
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  try {
    await nextFrame();
    await nextFrame();
    await wait(350); // let the charts re-measure at print width
    window.print();
  } finally {
    // Most browsers block in print(); afterprint covers the rest.
    setTimeout(restore, 500);
  }
}
