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
  ["only verified households", "Only verified households can rate services."],
  ["cannot review your own", "You cannot review your own listing."],
  ["please choose a rating", "Please choose a rating from 1 to 5."],
  ["review limit reached", "You have reached today's review limit. Try again tomorrow."],
  ["please write a short reply", "Please write a short reply."],
  ["not authenticated", "Please sign in again."],
  ["not found", "We could not find that listing."],
];

export const REVIEW_MAX_CHARS = 1000;
export const REPLY_MAX_CHARS = 600;
export const REVIEW_SAVE_FALLBACK = "Could not save your review. Try again.";
export const REVIEW_LOAD_FALLBACK = "Could not load reviews. Try again.";
export const REVIEW_GUIDELINE =
  "Describe your experience. Do not accuse anyone of a crime here — report crimes to SAPS or the watch.";
export const VERIFY_TO_RATE_MESSAGE = "Verify your household to rate neighbours' services.";

export const SERVICE_MODERATION_FILTERS = [
  { key: "pending", label: "Pending" },
  { key: "published", label: "Published" },
  { key: "hidden", label: "Hidden" },
  { key: "reported", label: "Reported" },
];

/** Unknown filter keys fall back to Pending. */
export function parseModerationFilter(value) {
  const key = String(value ?? "").toLowerCase();
  return SERVICE_MODERATION_FILTERS.some((f) => f.key === key) ? key : "pending";
}

/** Clamp a star rating to an integer 1–5, or 0 when unusable. */
export function clampRating(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.min(5, n);
}

/** Payload for upsert_service_review. Vouch only counts when the reviewer used the service. */
export function buildReviewPayload(listingId, form) {
  const used = Boolean(form?.used_service);
  return {
    p_listing_id: listingId,
    p_rating: clampRating(form?.rating),
    p_body: String(form?.body ?? "").trim().slice(0, REVIEW_MAX_CHARS) || null,
    p_used_service: used,
    p_vouch: used && Boolean(form?.vouch),
  };
}

export function validateReviewForm(form) {
  if (!clampRating(form?.rating)) return "Please choose a rating from 1 to 5.";
  if (String(form?.body ?? "").length > REVIEW_MAX_CHARS) return "Keep your review under 1000 characters.";
  return "";
}

/** Who may rate: verified residents who do not own the listing. */
export function reviewViewerState({ isVerified, isOwner }) {
  if (isOwner) return "owner";
  return isVerified ? "can_review" : "needs_verification";
}

/** Reviewer label: first name + street only. */
export function reviewerLabel(row) {
  const name = firstNameOnly(row?.reviewer_first_name);
  const street = String(row?.reviewer_street ?? "").trim();
  return street ? `${name}, ${street}` : name;
}

export function ratingSummary(row) {
  const count = Number(row?.rating_count) || 0;
  if (!count) return "No ratings yet";
  const avg = Number(row?.avg_rating) || 0;
  return `${avg.toFixed(1)} (${count} rating${count === 1 ? "" : "s"})`;
}

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
