/** Pure helpers for equipment borrowing (P3b). No Supabase import, so node --test can load it. */

export const LOAN_STATUS_META = Object.freeze({
  requested: { label: "Requested", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  approved: { label: "Ready to collect", tone: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200" },
  active: { label: "With you", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  overdue: { label: "Overdue", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
  returned: { label: "Returned", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  rejected: { label: "Declined", tone: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" },
  cancelled: { label: "Cancelled", tone: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
  expired: { label: "Expired", tone: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
  transferred: { label: "Handed on", tone: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200" },
  issue_reported: { label: "Issue reported", tone: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" },
});

/** Chip for a loan row; an active loan past due shows as Overdue. */
export function loanStatusMeta(loan) {
  const status = loan?.status;
  if (status === "active" && loan?.is_overdue) return LOAN_STATUS_META.overdue;
  return LOAN_STATUS_META[status] || { label: String(status || "Unknown"), tone: LOAN_STATUS_META.cancelled.tone };
}

export const OPEN_LOAN_STATUSES = Object.freeze(["requested", "approved", "active"]);

export function isOpenLoan(loan) {
  return OPEN_LOAN_STATUSES.includes(loan?.status);
}

export const ISSUE_KIND_LABELS = Object.freeze({ damage: "Damage", theft: "Theft", malfunction: "Not working" });

export const TRANSFER_STATUS_LABELS = Object.freeze({
  requested: "Waiting for the holder",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
});

/** Default loan length when an item has no limit (matches the server: 7 days). */
export const DEFAULT_LOAN_HOURS = 168;

/** Value for <input type="datetime-local"> in local time: "2026-11-01T18:30". */
export function toDateTimeLocalValue(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Suggested return time for a borrow request: now + the item limit (or 7 days), rounded up to the hour. */
export function defaultReturnDate(maxLoanHours, now = new Date()) {
  const h = Math.trunc(Number(maxLoanHours));
  const hours = Number.isFinite(h) && h > 0 ? h : DEFAULT_LOAN_HOURS;
  const d = new Date(now.getTime() + hours * 3600_000);
  if (d.getMinutes() || d.getSeconds() || d.getMilliseconds()) {
    d.setHours(d.getHours() + 1, 0, 0, 0);
  }
  return d;
}

/** Latest return time the server accepts: now + limit (or 720 h) + 7 days to collect. */
export function latestReturnDate(maxLoanHours, now = new Date()) {
  const h = Math.trunc(Number(maxLoanHours));
  const hours = (Number.isFinite(h) && h > 0 ? h : 720) + 168;
  return new Date(now.getTime() + hours * 3600_000);
}

/** null when fine, else a short message for the borrow form. */
export function validateReturnDate(value, maxLoanHours, now = new Date()) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Choose a valid return date.";
  if (d.getTime() <= now.getTime()) return "The return date must be in the future.";
  if (d.getTime() > latestReturnDate(maxLoanHours, now).getTime()) return "That is longer than this item can be borrowed.";
  return null;
}

/** "Due in 3 h" / "Due in 2 days" / "Overdue by 5 h" / "". */
export function formatDueIn(dueAt, now = new Date()) {
  if (!dueAt) return "";
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return "";
  const diff = due.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const hours = Math.round(abs / 3600_000);
  let span;
  if (abs < 3600_000) span = `${Math.max(1, Math.round(abs / 60_000))} min`;
  else if (hours < 48) span = `${hours} h`;
  else span = `${Math.round(hours / 24)} days`;
  return diff >= 0 ? `Due in ${span}` : `Overdue by ${span}`;
}

/** Badge number for an admin: requests + to collect + overdue + open issues. */
export function equipmentAdminBadgeCount(counts) {
  if (!counts?.can_manage) return 0;
  const n = (k) => Math.max(Math.trunc(Number(counts[k])) || 0, 0);
  return n("requests") + n("to_collect") + n("overdue") + n("issues");
}

/** Badge number for a patroller's My gear link: incoming transfers + ready to collect + own overdue. */
export function equipmentMyBadgeCount(counts) {
  const n = (k) => Math.max(Math.trunc(Number(counts?.[k])) || 0, 0);
  return n("incoming_transfers") + n("my_ready") + n("my_overdue");
}

/** Friendly text for P3b server errors; null when not a known loan error. */
export function equipmentLoanErrorText(error) {
  const msg = String(error?.message || "").replace(/^ERROR:\s*/i, "").trim();
  if (!msg) return null;
  if (/^training sign-off required/i.test(msg)) return "You need a training sign-off for this item. Ask your NW admin.";
  if (/already have an open request/i.test(msg)) return "You already have an open request or loan for this item.";
  if (/^no unit is available/i.test(msg)) return "No unit is free right now. Try again later.";
  if (/request limit reached/i.test(msg)) return "Too many requests today. Try again tomorrow.";
  if (/latest holder/i.test(msg)) return "Only the latest person who had this unit can report an issue.";
  return null;
}

/**
 * Statuses a manager may set outside the loan flow (server: set_equipment_unit_status_admin).
 * Reserved / in-transfer units go through the desk; a unit on loan can only be written off.
 */
const ADMIN_UNIT_STATUS_TARGETS = Object.freeze({
  available: ["under_repair", "damaged", "lost", "stolen", "retired"],
  checked_out: ["damaged", "lost", "stolen"],
  overdue: ["damaged", "lost", "stolen"],
  under_repair: ["available", "retired"],
  damaged: ["under_repair", "available", "retired"],
  lost: ["available", "retired"],
  stolen: ["available", "retired"],
});

export function adminUnitStatusTargets(status) {
  return ADMIN_UNIT_STATUS_TARGETS[status] || [];
}

/** True when the change ends someone's loan (the server then requires a note). */
export function adminStatusEndsLoan(fromStatus) {
  return fromStatus === "checked_out" || fromStatus === "overdue";
}

/** Split my loans into open (requested/approved/active) and past. */
export function splitMyLoans(rows) {
  const open = [];
  const past = [];
  for (const r of rows || []) (isOpenLoan(r) ? open : past).push(r);
  return { open, past };
}
