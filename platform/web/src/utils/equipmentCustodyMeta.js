/** Pure helpers for equipment custody (P3c). No Supabase import. */

export const WRITE_OFF_FOUR_EYES_CENTS = 200_000;
export const HANDOVER_ACCEPT_HOURS = 12;
export const HANDOVER_WINDOW_HOURS = 6;
export const CAS_REMINDER_HOURS = 48;

const CAS_RE = /^cas\s?(\d{1,6})\/(\d{1,2})\/(\d{4})$/i;

/** "" when blank, "CAS n/m/y" when valid, null when the text is not a case number. */
export function normalizeCasNumber(value) {
  const s = String(value || "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  const m = s.match(CAS_RE);
  if (!m) return null;
  return `CAS ${m[1]}/${m[2]}/${m[3]}`;
}

/** null when the field can be submitted. */
export function casNumberError(value) {
  if (!String(value || "").trim()) return null;
  return normalizeCasNumber(value) ? null : "Use the SAPS format, for example CAS 123/10/2026.";
}

/** True when a second admin must approve. A missing price does not cross R2,000. */
export function writeOffNeedsSecondAdmin(cents) {
  const n = Number(cents);
  return Number.isFinite(n) && n >= WRITE_OFF_FOUR_EYES_CENTS;
}

export function formatRandsFromCents(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.round(n));
  const rands = Math.trunc(abs / 100);
  const rem = abs % 100;
  const grouped = String(rands).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}R${rem ? `${grouped}.${String(rem).padStart(2, "0")}` : grouped}`;
}

/** null when blank, undefined when not a rand amount, otherwise cents. */
export function randsInputToCents(value) {
  const s = String(value ?? "").trim().replace(/[R\s,]/g, "");
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  return Math.round(Number(s) * 100);
}

/** 6 digits from a typed code or a scanned watchman:handover:<id>:<code> payload. */
export function parseHandoverCode(text) {
  const s = String(text || "").trim();
  const qr = s.match(/^watchman:handover:[0-9a-f-]{36}:(\d{6})$/i);
  if (qr) return qr[1];
  const digits = s.replace(/\D/g, "");
  return digits.length === 6 ? digits : "";
}

export function handoverCodePayload(transferId, code) {
  return `watchman:handover:${transferId}:${code}`;
}

export const LIABILITY_OPTIONS = Object.freeze([
  { id: "no_fault", label: "No fault" },
  { id: "negligence_warning", label: "Negligence warning" },
  { id: "contribution_requested", label: "Contribution requested" },
]);

export const MAINTENANCE_KIND_LABELS = Object.freeze({
  inspection: "Inspection",
  repair: "Repair",
  service: "Service",
  battery_replaced: "Battery replaced",
  cleaning: "Cleaning",
  calibration: "Calibration",
  other: "Other",
});

const RAW_DB = /syntax error|duplicate key|violates |SQLSTATE|permission denied|relation "|function public\.|column "|invalid input syntax/i;

/** Hide database internals. Known sentences from our SQL still pass through. */
export function friendlyEquipmentError(message, fallback = "Something went wrong. Try again.") {
  const msg = String(message || "").replace(/^ERROR:\s*/i, "").trim();
  if (!msg || RAW_DB.test(msg)) return fallback;
  return msg;
}

/** Friendly text for P3c server errors, or null when this is not one of them. */
export function equipmentCustodyErrorText(error) {
  const msg = String(error?.message || "").replace(/^ERROR:\s*/i, "").trim();
  if (!msg) return null;
  if (/different admin must approve/i.test(msg)) return "A different admin has to approve a write-off of R2,000 or more. No charge was created.";
  if (/only an NW admin can decide liability/i.test(msg)) return "Only an NW admin can record liability. No charge is created.";
  if (/SAPS case number/i.test(msg)) return "Enter a SAPS case number like CAS 123/10/2026, or leave it blank to be reminded later.";
  if (/hand-over has expired|request has expired/i.test(msg)) return "This hand-over has expired.";
  if (/accept responsibility/i.test(msg)) return "Tick the box to accept responsibility for this unit.";
  if (/too many wrong codes/i.test(msg)) return "Too many wrong codes. Ask the holder for a new one.";
  if (/does not match/i.test(msg)) return "That code does not match.";
  if (/6-digit code/i.test(msg)) return "Enter the 6-digit code from the holder.";
  if (/already in progress/i.test(msg)) return "A hand-over is already in progress for this unit.";
  if (/pick a hand-over time/i.test(msg)) return "Pick a hand-over time from now, within the next 7 days.";
  return null;
}
