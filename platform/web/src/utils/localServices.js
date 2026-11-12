import { isRpcNotFoundError } from "./isRpcNotFound.js";

// Pure helpers for the Local services directory. No Supabase import so node:test can load this file.

export const SERVICES_TAB = "services";
export const EMERGENCY_TAB = "emergency";
export const MAX_SERVICE_PHOTOS = 6;
export const MAX_ACTIVE_LISTINGS = 3;

export const SAVE_FALLBACK = "Could not save your listing. Try again.";
export const LOAD_FALLBACK = "Could not load local services. Try again.";
export const NEIGHBOUR_FALLBACK = "Could not update neighbouring suburbs. Try again.";
export const SQL_MISSING_MESSAGE = "Run the local services SQL in Supabase first.";

export const PRICE_RANGES = [
  { value: "", label: "Not stated" },
  { value: "budget", label: "Budget" },
  { value: "mid", label: "Mid-range" },
  { value: "premium", label: "Premium" },
  { value: "quote", label: "Quote on request" },
];

export const STATUS_LABELS = {
  pending: "Waiting for approval",
  published: "Live",
  paused: "Paused",
  hidden: "Hidden by a moderator",
  removed: "Removed",
};

const FRIENDLY_RULES = [
  ["up to 3 active listings", "You can have up to 3 active listings. Pause or remove one first."],
  ["agree to publish", "Please agree to share your contact details with members of this Neighbourhood Watch."],
  ["hidden; a moderator must restore", "This listing is hidden. A moderator must restore it."],
  ["needs moderator approval", "This listing needs moderator approval before it goes live."],
  ["please give a reason", "Please give a reason."],
  ["cannot change this listing", "You cannot change this listing to that status."],
  ["listing details are required", "Please fill in the listing details."],
  ["not authenticated", "Please sign in again."],
  ["not found", "We could not find that listing."],
];

/** Map an RPC/storage error to friendly copy. Never returns the raw message. */
export function friendlyServiceError(error, fallback = SAVE_FALLBACK) {
  if (!error) return fallback;
  if (isRpcNotFoundError(error)) return SQL_MISSING_MESSAGE;
  const msg = String(error?.message ?? error ?? "").toLowerCase();
  for (const [needle, copy] of FRIENDLY_RULES) {
    if (msg.includes(needle)) return copy;
  }
  return fallback;
}

/** Digits-only phone in international form for wa.me; SA `0xx…` becomes `27xx…`. Returns "" if unusable. */
export function normaliseSaPhone(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  const plus = s.startsWith("+");
  s = s.replace(/\D/g, "");
  if (!s) return "";
  if (!plus && s.startsWith("00")) s = s.slice(2);
  else if (!plus && s.startsWith("0")) s = `27${s.slice(1)}`;
  if (s.length < 9 || s.length > 15) return "";
  return s;
}

export function whatsappUrl(raw) {
  const n = normaliseSaPhone(raw);
  return n ? `https://wa.me/${n}` : "";
}

export function telUrl(raw) {
  const n = normaliseSaPhone(raw);
  return n ? `tel:+${n}` : "";
}

/** First name only (neighbour rows never show a surname). */
export function firstNameOnly(fullName) {
  const first = String(fullName ?? "").trim().split(/\s+/)[0];
  return first || "A neighbour";
}

/** Comma/newline separated text -> unique lowercase tags (2–30 chars, max 12). */
export function parseTags(text) {
  const seen = new Set();
  for (const part of String(text ?? "").split(/[,\n]/)) {
    const t = part.trim().toLowerCase();
    if (t.length >= 2 && t.length <= 30) seen.add(t);
  }
  return [...seen].slice(0, 12);
}

/** hours_json is always an object. Free text lives under `note`. */
export function hoursToJson(note) {
  const text = String(note ?? "").trim();
  return text ? { note: text.slice(0, 200) } : {};
}

export function hoursFromJson(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && typeof value.note === "string") {
    return value.note;
  }
  return "";
}

/** Build the upsert payload. serves_whole_city is never sent. */
export function buildListingPayload(form, photoPaths) {
  return {
    title: String(form.title ?? "").trim(),
    business_name: String(form.business_name ?? "").trim(),
    description: String(form.description ?? "").trim(),
    category_slug: form.category_slug,
    tags: parseTags(form.tags),
    contact_name: String(form.contact_name ?? "").trim(),
    phone: String(form.phone ?? "").trim(),
    whatsapp: String(form.whatsapp ?? "").trim(),
    email: String(form.email ?? "").trim(),
    website: String(form.website ?? "").trim(),
    service_area: String(form.service_area ?? "").trim(),
    hours_json: hoursToJson(form.hours),
    price_range: form.price_range || "",
    price_note: String(form.price_note ?? "").trim(),
    photo_paths: photoPaths ?? [],
    show_to_neighbours: Boolean(form.show_to_neighbours),
    consent_publish_contact: Boolean(form.consent_publish_contact),
  };
}

export function validateListingForm(form) {
  if (String(form.title ?? "").trim().length < 3) return "Give your service a title (at least 3 characters).";
  if (!form.category_slug) return "Choose a category.";
  if (String(form.description ?? "").trim().length < 10) return "Describe your service (at least 10 characters).";
  const hasContact = ["phone", "whatsapp", "email", "website"].some((k) => String(form[k] ?? "").trim());
  if (!hasContact) return "Add at least one way to contact you.";
  if (!form.consent_publish_contact) return "Please agree to share your contact details.";
  return "";
}

/** Contacts page tab from `?tab=`. Anything unknown is Emergency. */
export function parseContactsTab(search) {
  const value = new URLSearchParams(search || "").get("tab");
  return value === SERVICES_TAB ? SERVICES_TAB : EMERGENCY_TAB;
}

/** `neighbours=1` turns the include-neighbours box on. Default off. */
export function parseIncludeNeighbours(search) {
  return new URLSearchParams(search || "").get("neighbours") === "1";
}

/** The checkbox is hidden entirely when the org has no neighbours. */
export function showNeighboursCheckbox(neighbours) {
  return Array.isArray(neighbours) && neighbours.length > 0;
}

/** Value to pass as p_include_neighbours: only when the box is visible and on. */
export function effectiveIncludeNeighbours(search, neighbours) {
  return showNeighboursCheckbox(neighbours) && parseIncludeNeighbours(search);
}

/** Return search params with neighbours set/cleared, preserving the rest. */
export function withIncludeNeighbours(params, on) {
  const next = new URLSearchParams(params);
  if (on) next.set("neighbours", "1");
  else next.delete("neighbours");
  return next;
}

/** Suburb badge text for a result row, or "" for own-neighbourhood rows. */
export function neighbourBadge(row) {
  return row?.is_neighbour ? String(row.suburb_name || "Neighbouring suburb") : "";
}
