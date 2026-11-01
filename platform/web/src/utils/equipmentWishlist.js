import { supabase } from "../supabase/client";
import { isRpcNotFoundError } from "./isRpcNotFound";
import { COMMUNITY_MEDIA_BUCKET } from "./communityMedia";
import { normalizeAppRole } from "../auth/staffRoles";
import { canAccessPlatformConsole } from "../auth/platformRoles";

/** RPC wrappers for P2 (needs board). Each returns { data, error }. No money flows here. */

export const WISHLIST_STATUS_META = Object.freeze({
  needed: { label: "Needed", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  acquired: { label: "Acquired", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  cancelled: { label: "Cancelled", tone: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200" },
});

export const WISHLIST_PRIORITY_META = Object.freeze({
  urgent: { label: "Urgent", tone: "bg-red-600 text-white dark:bg-red-500" },
  high: { label: "High priority", tone: "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200" },
  normal: { label: "Normal", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200" },
  low: { label: "Low priority", tone: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200" },
});

export const OFFER_KINDS = Object.freeze([
  { value: "contribute_item", label: "I can give this item" },
  { value: "lend_item", label: "I can lend one" },
  { value: "source_at_cost", label: "I can source it at cost" },
  { value: "contribute_cost", label: "I'd like to contribute towards the cost" },
  { value: "other_help", label: "Other help" },
]);

/** Offer kinds that never carry an item quantity (money is arranged privately, outside the app). */
export const NO_QUANTITY_OFFER_KINDS = Object.freeze(["contribute_cost"]);

export const CONTRIBUTE_COST_HELP =
  "The committee will contact you privately to arrange your contribution. Never share bank details in the app.";

export const OFFER_KIND_CHIP = Object.freeze({
  contribute_cost: {
    label: "Cost contribution",
    tone: "bg-violet-100 text-violet-800 ring-1 ring-violet-300 dark:bg-violet-900/40 dark:text-violet-200 dark:ring-violet-700",
  },
});

export const OFFER_STATUS_META = Object.freeze({
  new: { label: "Pending", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  acknowledged: { label: "Seen by committee", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  accepted: { label: "Accepted", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  declined: { label: "Declined", tone: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" },
  withdrawn: { label: "Withdrawn", tone: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200" },
  fulfilled: { label: "Fulfilled", tone: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200" },
});

export const OPEN_OFFER_STATUSES = ["new", "acknowledged", "accepted"];

export const OFFER_NOTE_HINT =
  "Don't include payment or personal ID details. The committee will contact you in the app or by phone.";

/** Server: can_manage_wishlist (NW admin, equipment custodian, global/platform staff). */
export const WISHLIST_MANAGER_ROLES = ["admin", "technical_support", "nw_admin"];

export function canManageWishlist(role, platformRole, caps = []) {
  if (canAccessPlatformConsole(platformRole)) return true;
  if (WISHLIST_MANAGER_ROLES.includes(normalizeAppRole(role))) return true;
  return Array.isArray(caps) && caps.includes("equipment_custodian");
}

/** Client mirror of the server note screen (9+ digit runs or payment wording). */
export function noteLooksLikePaymentDetails(note) {
  const s = String(note || "");
  return /\d{9,}/.test(s) || /(account\s*(number|no\.?|#)|\biban\b|\bcard\b|\bswift\b|\bbranch\s+code\b)/i.test(s);
}

export function wishlistPhotoUrl(path) {
  if (!path) return null;
  const { data } = supabase.storage.from(COMMUNITY_MEDIA_BUCKET).getPublicUrl(path);
  return data?.publicUrl ?? null;
}

/** Only https links, for rel="noopener noreferrer" external opening. */
export function safeStoreUrl(url) {
  const s = String(url || "").trim();
  return /^https:\/\/\S+$/i.test(s) ? s : null;
}

/** "R 1 250" style, labelled est. by callers. Informational only. */
export function formatEstPrice(cents) {
  if (cents == null || cents === "") return null;
  const n = Number(cents) / 100;
  if (!Number.isFinite(n)) return null;
  return `R ${n.toLocaleString("en-ZA", { maximumFractionDigits: n % 1 ? 2 : 0 })}`;
}

export const MAX_WISHLIST_PHOTOS = 5;

/** Gallery paths (first = cover). Falls back to the single legacy photo_path. */
export function wishlistItemPhotoPaths(item) {
  const list = Array.isArray(item?.photo_paths) ? item.photo_paths.filter(Boolean) : [];
  if (list.length) return list.slice(0, MAX_WISHLIST_PHOTOS);
  return item?.photo_path ? [item.photo_path] : [];
}

/** Pure: est. value already in hand vs the full est. value, over priced "needed" items. */
export function wishlistNeededProgressCents(items) {
  let inHand = 0;
  let target = 0;
  for (const item of items || []) {
    if (item?.status !== "needed") continue;
    const t = wishlistItemTotals(item);
    if (!t) continue;
    target += t.fullCents;
    inHand += t.fullCents - t.remainingCents;
  }
  return { inHandCents: inHand, targetCents: target, pct: target ? Math.round((inHand / target) * 100) : 0 };
}

/** Pure: acquired progress for the "X of Y acquired" bar. */
export function wishlistAcquiredPct(acquired, needed) {
  const n = Math.max(Math.trunc(Number(needed)) || 0, 1);
  const a = Math.min(Math.max(Math.trunc(Number(acquired)) || 0, 0), n);
  return { acquired: a, needed: n, pct: Math.round((a / n) * 100) };
}

function wholeNonNeg(v) {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Pure: estimated totals for one item, in integer cents (no float drift).
 * remainingQty = max(needed - acquired, 0); only "needed" items have anything remaining.
 * Returns null when no price is set.
 */
export function wishlistItemTotals(item) {
  const price = item?.est_unit_price_cents;
  if (price == null || price === "") return null;
  const unit = Math.round(Number(price));
  if (!Number.isFinite(unit) || unit < 0) return null;
  const needed = wholeNonNeg(item.quantity_needed);
  const acquired = Math.min(wholeNonNeg(item.quantity_acquired), needed);
  const remainingQty = item.status === "needed" ? needed - acquired : 0;
  return {
    unitCents: unit,
    remainingQty,
    fullCents: unit * needed,
    remainingCents: unit * remainingQty,
  };
}

/** Pure: sum of remaining est. cents over distinct "needed" items with a price (dedup by id). */
export function wishlistStillNeededCents(items) {
  const seen = new Set();
  let total = 0;
  let priced = 0;
  for (const item of items || []) {
    if (!item || item.status !== "needed" || seen.has(item.id)) continue;
    seen.add(item.id);
    const t = wishlistItemTotals(item);
    if (!t) continue;
    priced += 1;
    total += t.remainingCents;
  }
  return { cents: total, pricedCount: priced, itemCount: seen.size };
}

export function randsToCents(value) {
  const s = String(value ?? "").replace(/[\sR,]/gi, "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100);
}

/** Covered cents for one item from list_wishlist_ledger_totals (0 if none/unavailable). */
export async function getWishlistItemCoveredCents(itemId) {
  if (!itemId) return 0;
  const { data } = await supabase.rpc("list_wishlist_ledger_totals");
  const t = (data || []).find((r) => r.item_id === itemId);
  return Math.max(Number(t?.covered_cents) || 0, 0);
}

/** Pure: pledge summary for the offer dialog. Money in cents; pct null when nothing is left to cover. */
export function wishlistPledgeSummary(item, coveredCents, pledgeCents) {
  const totals = wishlistItemTotals(item);
  const covered = Math.max(Number(coveredCents) || 0, 0);
  if (!totals || totals.unitCents <= 0) return { priced: false, covered };
  const outstanding = totals.remainingCents;
  const stillToCover = Math.max(outstanding - covered, 0);
  const pledge = pledgeCents > 0 ? pledgeCents : 0;
  const pct = pledge && stillToCover > 0 ? Math.min(100, Math.max(1, Math.round((pledge / stillToCover) * 100))) : null;
  return {
    priced: true,
    fullCents: totals.fullCents,
    outstandingCents: outstanding,
    covered,
    stillToCover,
    pledge,
    pct,
    exceeds: pledge > 0 && pledge > stillToCover,
  };
}

/** Lock-screen push to the org's Needs managers (server-verified, once per offer). Fire and forget. */
export async function notifyWishlistOfferPush(offerId) {
  if (!offerId) return;
  try {
    await supabase.functions.invoke("notify-resident-event", { body: { type: "wishlist_offer", offerId } });
  } catch (err) {
    console.warn("notify-resident-event (wishlist_offer):", err?.message || err);
  }
}

export async function listWishlistItems({ status = null, itemId = null } = {}) {
  const [{ data, error }, totals] = await Promise.all([
    supabase.rpc("list_wishlist_items", { p_status: status, p_item_id: itemId }),
    supabase.rpc("list_wishlist_ledger_totals"),
  ]);
  // Ledger totals are optional (older DB): missing RPC just means nothing recorded.
  const byItem = new Map((totals?.data || []).map((t) => [t.item_id, t]));
  const merged = (data || []).map((i) => {
    const t = byItem.get(i.id);
    return {
      ...i,
      received_cents: Number(t?.received_cents || 0),
      spent_cents: Number(t?.spent_cents || 0),
      covered_cents: Number(t?.covered_cents || 0),
      balance_cents: Number(t?.balance_cents || 0),
    };
  });
  return { data: merged, error };
}

/* ---------- Transparent ledger (append-only; amounts entered by managers only) ---------- */

export const LEDGER_KIND_META = Object.freeze({
  contribution_received: {
    label: "Contribution",
    icon: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    amount: "text-emerald-700 dark:text-emerald-300",
  },
  purchase: {
    label: "Purchase",
    icon: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
    amount: "text-rose-700 dark:text-rose-300",
  },
  correction: {
    label: "Correction",
    icon: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    amount: "text-amber-700 dark:text-amber-300",
  },
});

/** Same maths as list_wishlist_ledger_totals: corrections reduce the kind they correct. */
export function wishlistLedgerSummary(rows) {
  let received = 0;
  let spent = 0;
  for (const r of rows || []) {
    const c = Number(r.amount_cents) || 0;
    if (r.kind === "contribution_received") received += c;
    else if (r.kind === "purchase") spent += c;
    else if (r.kind === "correction" && r.corrects_kind === "purchase") spent -= c;
    else if (r.kind === "correction") received -= c;
  }
  const receivedCents = Math.max(received, 0);
  const spentCents = Math.max(spent, 0);
  return { receivedCents, spentCents, balanceCents: receivedCents - spentCents };
}

/** Covered vs the full estimate (unit price x qty needed). pct is 0..100. */
export function wishlistCoverage(item) {
  const covered = Math.max(Number(item?.covered_cents) || 0, 0);
  const unit = Number(item?.est_unit_price_cents) || 0;
  const target = unit > 0 ? unit * Math.max(Number(item?.quantity_needed) || 1, 1) : 0;
  const pct = target > 0 ? Math.min(100, Math.round((covered / target) * 100)) : 0;
  return { covered, target, pct };
}

export async function listWishlistLedger(itemId) {
  const { data, error } = await supabase.rpc("list_wishlist_ledger", { p_item_id: itemId });
  return { data: data || [], error };
}

export async function recordWishlistContribution(itemId, { amountCents, entryDate = null, offerId = null, note = null }) {
  const { data, error } = await supabase.rpc("record_wishlist_contribution", {
    p_item_id: itemId,
    p_amount_cents: amountCents,
    p_entry_date: entryDate || null,
    p_offer_id: offerId || null,
    p_note: note?.trim() || null,
  });
  return { data, error };
}

export async function recordWishlistPurchase(itemId, { amountCents, entryDate = null, note = null, receiptPath = null }) {
  const { data, error } = await supabase.rpc("record_wishlist_purchase", {
    p_item_id: itemId,
    p_amount_cents: amountCents,
    p_entry_date: entryDate || null,
    p_note: note?.trim() || null,
    p_receipt_path: receiptPath || null,
  });
  return { data, error };
}

export async function recordWishlistCorrection(entryId, { amountCents, reason }) {
  const { data, error } = await supabase.rpc("record_wishlist_correction", {
    p_entry_id: entryId,
    p_amount_cents: amountCents,
    p_reason: reason?.trim() || null,
  });
  return { data, error };
}

export async function upsertWishlistItem(item) {
  const { data, error } = await supabase.rpc("upsert_wishlist_item", {
    p_id: item.id || null,
    p_title: item.title,
    p_reason: item.reason || null,
    p_photo_path: item.photoPath || null,
    p_quantity_needed: item.quantityNeeded ?? 1,
    p_est_unit_price_cents: item.estUnitPriceCents ?? null,
    p_store_url: item.storeUrl || null,
    p_product_code: item.productCode || null,
    p_priority: item.priority || "normal",
    p_category_hint: item.categoryHint || null,
  });
  return { data, error };
}

export async function setWishlistItemPhotos(id, paths) {
  const { data, error } = await supabase.rpc("set_wishlist_item_photos", { p_id: id, p_paths: paths || [] });
  return { data, error };
}

export const MAX_PLEDGE_RANDS = 1000000;
export const PLEDGE_HINT =
  "Optional. Only the NW admins see this. Your amount is counted only once the committee confirms receipt.";

/** Whole rands 1..1,000,000 -> cents; "" -> null; anything else -> NaN. */
export function pledgeRandsToCents(value) {
  const s = String(value ?? "").replace(/[\sR,]/gi, "").trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) return NaN;
  const n = Number(s);
  return n >= 1 && n <= MAX_PLEDGE_RANDS ? n * 100 : NaN;
}

/** My own offer's kind and pledge (RLS: own offers only). */
export async function getMyOffer(offerId) {
  if (!offerId) return null;
  const { data } = await supabase
    .from("equipment_wishlist_offers")
    .select("kind, pledged_amount_cents")
    .eq("id", offerId)
    .maybeSingle();
  return data ?? null;
}

/** Kind of one of my own offers (RLS: own offers only). */
export async function getMyOfferKind(offerId) {
  if (!offerId) return null;
  const { data } = await supabase.from("equipment_wishlist_offers").select("kind").eq("id", offerId).maybeSingle();
  return data?.kind ?? null;
}

/** Names of the org's active NW admins for a cost contribution (no contact details). */
export async function listContributionContacts(itemId) {
  const { data, error } = await supabase.rpc("list_org_contribution_contacts", { p_item_id: itemId });
  return { names: (data || []).map((r) => r.full_name).filter(Boolean), error };
}

/** "Jane Doe (NW admin) or John Smith (NW admin)"; falls back to "the committee". */
export function contributionContactText(names) {
  const list = (names || []).map((n) => `${n} (NW admin)`);
  if (!list.length) return "the committee";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} or ${list[list.length - 1]}`;
}

export function contributionThanksText(names) {
  return `Thank you! Please contact ${contributionContactText(names)} to arrange your contribution.`;
}

/** Partial acquisition: 0..quantity_needed; server flips needed/acquired from the count. */
export async function setWishlistItemAcquired(id, qty) {
  const { data, error } = await supabase.rpc("set_wishlist_item_acquired", { p_item_id: id, p_qty: qty });
  return { data, error };
}

export async function setWishlistItemStatus(id, { status = null, quantityAcquired = null, note = null } = {}) {
  const { data, error } = await supabase.rpc("set_wishlist_item_status", {
    p_id: id,
    p_status: status,
    p_quantity_acquired: quantityAcquired,
    p_note: note?.trim() || null,
  });
  return { data, error };
}

export async function createWishlistOffer(itemId, { kind = "contribute_item", quantity = null, note = null, showName = false, pledgeCents = null } = {}) {
  const { data, error } = await supabase.rpc("create_wishlist_offer", {
    p_item_id: itemId,
    p_kind: kind,
    p_quantity: NO_QUANTITY_OFFER_KINDS.includes(kind) ? null : quantity || null,
    p_note: note?.trim() || null,
    p_show_name: kind === "contribute_cost" && Boolean(showName),
    p_pledge_cents: kind === "contribute_cost" && pledgeCents ? pledgeCents : null,
  });
  return { data, error };
}

export async function withdrawWishlistOffer(offerId) {
  const { error } = await supabase.rpc("withdraw_wishlist_offer", { p_offer_id: offerId });
  return { data: null, error };
}

export async function respondWishlistOffer(offerId, status, note = null) {
  const { error } = await supabase.rpc("respond_wishlist_offer", {
    p_offer_id: offerId,
    p_status: status,
    p_note: note?.trim() || null,
  });
  return { data: null, error };
}

export async function listWishlistOffers({ itemId = null, includeClosed = false } = {}) {
  const { data, error } = await supabase.rpc("list_wishlist_offers", {
    p_item_id: itemId,
    p_include_closed: Boolean(includeClosed),
  });
  return { data: data || [], error };
}

export function wishlistErrorMessage(error, fallback = "Something went wrong.") {
  if (isRpcNotFoundError(error)) return "Run the needs board SQL (P2) in Supabase first.";
  const msg = String(error?.message || "").replace(/^ERROR:\s*/i, "").trim();
  if (/pledge is only allowed/i.test(msg)) return "A pledge can only be added to a cost contribution.";
  if (/pledge must be/i.test(msg)) return "Pledge must be whole rands from R 1 to R 1,000,000.";
  if (/append-only/i.test(msg)) return "Ledger entries can't be changed. Record a correction instead.";
  if (/reason is required/i.test(msg)) return "Give a reason for the correction.";
  if (/correction exceeds/i.test(msg)) return "That correction is more than what is left on the entry.";
  if (/invalid receipt path/i.test(msg)) return "The receipt upload went to the wrong folder. Try again.";
  if (/amount must be/i.test(msg)) return "Enter an amount more than R 0.";
  if (/in the future/i.test(msg)) return "The date can't be in the future.";
  if (/payment details/i.test(msg)) return "Please don't share payment details. The committee will contact you.";
  if (/no longer needed/i.test(msg)) return "This item is no longer needed.";
  if (/already offered/i.test(msg)) return "You already offered to help with this item.";
  if (/offer limit/i.test(msg)) return "You can send up to 5 offers a day. Try again tomorrow.";
  if (/no neighbourhood selected/i.test(msg)) return "Choose a neighbourhood first (Choose area).";
  if (/not found/i.test(msg)) return "That item or offer was not found.";
  if (/forbidden/i.test(msg)) return "You can't manage Neighbourhood Watch Needs here.";
  return msg || fallback;
}