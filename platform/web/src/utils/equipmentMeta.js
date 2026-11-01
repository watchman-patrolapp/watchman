/** Pure helpers for the equipment catalogue (P3a). No Supabase import, so node --test can load it. */

export const EQUIPMENT_STATUS_META = Object.freeze({
  available: { label: "Available", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  reserved: { label: "Reserved", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  checked_out: { label: "Checked out", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  in_transfer: { label: "In transfer", tone: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200" },
  overdue: { label: "Overdue", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
  under_repair: { label: "Under repair", tone: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200" },
  damaged: { label: "Damaged", tone: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" },
  lost: { label: "Lost", tone: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200" },
  stolen: { label: "Stolen", tone: "bg-slate-800 text-white dark:bg-slate-600 dark:text-white" },
  retired: { label: "Retired", tone: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
});

export function equipmentStatusMeta(status) {
  return EQUIPMENT_STATUS_META[status] || { label: String(status || "Unknown"), tone: EQUIPMENT_STATUS_META.lost.tone };
}

export const EQUIPMENT_CONDITION_LABELS = Object.freeze({ new: "New", good: "Good", fair: "Fair", poor: "Poor" });

export const EQUIPMENT_LEDGER_EVENT_LABELS = Object.freeze({
  item_created: "Item added",
  item_updated: "Item updated",
  unit_added: "Added to the catalogue",
  unit_updated: "Details updated",
  qr_rotated: "QR label replaced",
  status_changed: "Status changed",
  certification_granted: "Certification granted",
  certification_revoked: "Certification revoked",
});

const CATEGORY_EMOJI = Object.freeze({
  optics: "🔭",
  radios: "📻",
  lighting: "🔦",
  "sirens & alarms": "📢",
  "protective wear": "🦺",
  "first aid": "⛑️",
  cameras: "📷",
  "vehicle kit": "🚗",
});

export function equipmentCategoryEmoji(name) {
  return CATEGORY_EMOJI[String(name || "").trim().toLowerCase()] || "🧰";
}

/** Server asset_tag rule: ^[A-Z0-9][A-Z0-9-]{1,23}$ (upper-cased before saving). */
export function isValidAssetTag(tag) {
  return /^[A-Z0-9][A-Z0-9-]{1,23}$/.test(String(tag || "").trim().toUpperCase());
}

/** "2 free" / "None free" chip text for a catalogue row. */
export function equipmentAvailabilityLabel(item) {
  const free = Math.max(Math.trunc(Number(item?.available_count)) || 0, 0);
  const total = Math.max(Math.trunc(Number(item?.unit_count)) || 0, 0);
  if (!total) return "No units yet";
  return free ? `${free} free` : "None free";
}

/** Pure: filter catalogue rows by category id ("all" = no filter) and a search string. */
export function filterEquipmentCatalogue(items, { categoryId = "all", query = "" } = {}) {
  const q = String(query || "").trim().toLowerCase();
  return (items || []).filter((i) => {
    if (categoryId !== "all" && (i.category_id || "none") !== categoryId) return false;
    if (!q) return true;
    return [i.name, i.description, i.category_name].some((v) => String(v || "").toLowerCase().includes(q));
  });
}

/** Pure: distinct categories present in the catalogue, in server sort order. */
export function equipmentCategoryChips(items) {
  const seen = new Map();
  for (const i of items || []) {
    const id = i.category_id || "none";
    if (!seen.has(id)) seen.set(id, { id, name: i.category_name || "Other", sort: Number(i.category_sort ?? 999) });
  }
  return [...seen.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

/** Extract the token from a scanned URL or a pasted token. */
export function equipmentQrTokenFromText(text) {
  const s = String(text || "").trim();
  const m = s.match(/\/equipment\/u\/([A-Za-z0-9_-]{8,64})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

export function equipmentErrorMessage(error, isNotFound = false, fallback = "Something went wrong.") {
  if (isNotFound) return "The equipment catalogue is not switched on yet (run the P3a SQL in Supabase first).";
  const msg = String(error?.message || "").replace(/^ERROR:\s*/i, "").trim();
  if (/not found/i.test(msg)) return "That equipment was not found.";
  if (/forbidden/i.test(msg)) return "You can't manage equipment here.";
  if (/not authenticated/i.test(msg)) return "Please sign in again.";
  if (/no organization/i.test(msg)) return "Choose a neighbourhood first.";
  return msg || fallback;
}

export const EQUIPMENT_FUNDING_LABELS = Object.freeze({
  donation: "Donation",
  fundraiser: "Fundraiser",
  committee_funds: "Committee funds",
  sponsor: "Sponsor",
  grant: "Grant",
  loan: "On loan",
  other: "Other",
});

export const MAX_EQUIPMENT_PHOTOS = 5;

/** Gallery paths for an item row: photo_paths (new) or the single cover (older rows). */
export function equipmentItemPhotoPaths(item) {
  const list = Array.isArray(item?.photo_paths) ? item.photo_paths.filter(Boolean) : [];
  if (list.length) return list.slice(0, MAX_EQUIPMENT_PHOTOS);
  return item?.photo_path ? [item.photo_path] : [];
}

/** Absolute URL printed in a QR label. */
export function equipmentQrUrl(origin, token) {
  if (!token) return "";
  return `${String(origin || "").replace(/\/+$/, "")}/equipment/u/${encodeURIComponent(token)}`;
}

/** "Up to 12 hours" / "Up to 3 days" / null. */
export function formatLoanLimit(hours) {
  const h = Math.trunc(Number(hours));
  if (!Number.isFinite(h) || h <= 0) return null;
  if (h % 24 === 0) {
    const d = h / 24;
    return `Up to ${d} day${d === 1 ? "" : "s"}`;
  }
  return `Up to ${h} hour${h === 1 ? "" : "s"}`;
}

/** Cents -> "1500" / "1500.50" for a rands input ("" when empty). */
export function centsToRandsInput(cents) {
  if (cents == null || cents === "") return "";
  const n = Number(cents);
  if (!Number.isFinite(n)) return "";
  return n % 100 ? (n / 100).toFixed(2) : String(n / 100);
}

/** Card badge for a catalogue row: { label, tone }. */
export function equipmentAvailabilityBadge(item) {
  const label = equipmentAvailabilityLabel(item);
  const free = Number(item?.available_count) > 0;
  const total = Number(item?.unit_count) > 0;
  if (item?.is_archived) return { label: "Archived", tone: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200" };
  if (free) return { label, tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" };
  if (total) return { label, tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" };
  return { label, tone: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" };
}

/** Split label rows into A4 sheets (default 3 x 8 = 24 per page). */
export function paginateLabels(rows, perPage = 24) {
  const out = [];
  const size = Math.max(1, Math.trunc(perPage) || 24);
  for (let i = 0; i < (rows || []).length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
