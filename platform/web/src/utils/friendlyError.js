// Turns raw errors (database, network, code) into plain messages that are safe to show members.
export const GENERIC_ERROR = "Something went wrong. Please try again.";
const OFFLINE = "You seem to be offline. Check your connection and try again.";
const SESSION = "Your session has expired. Please sign in again.";
const NO_PERMISSION = "You don't have permission to do that.";
const DUPLICATE = "That's already been saved.";
const NOT_READY = "This feature isn't available yet. Please try again later.";

const RULES = [
  [/failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet_disconnected/i, OFFLINE],
  [/\bjwt\b|refresh token|invalid claim|not authenticated/i, SESSION],
  [/row-level security|permission denied|insufficient_privilege|\b42501\b/i, NO_PERMISSION],
  [/duplicate key|\b23505\b/i, DUPLICATE],
  [/pgrst\d{3}|schema cache|could not find the (function|table)|\b42883\b|\b42p01\b|bucket not found|\bsql\b|supabase|migration/i, NOT_READY],
];

const TECHNICAL =
  /violates|null value in column|invalid input syntax|syntax error|sqlstate|postgres|relation "|column "|does not exist|typeerror|referenceerror|cannot read propert|undefined is not|is not a function|unexpected token|non-2xx|edge function|status code \d{3}|<!doctype|<html|\bat [\w.$<>]+ \(|\{\s*"/i;

function ruleFor(text) {
  for (const [re, friendly] of RULES) if (re.test(text)) return friendly;
  return null;
}

function isTechnical(text) {
  return Boolean(ruleFor(text)) || TECHNICAL.test(text) || text.length > 220;
}

/** Cleans a message string. Keeps a friendly lead-in like "Delete failed:" and swaps the raw part. */
export function friendlyMessage(text, fallback = GENERIC_ERROR) {
  if (typeof text !== "string" || !text.trim()) return fallback;
  if (!isTechnical(text)) return text;
  const cut = text.indexOf(": ");
  if (cut > 0 && cut <= 80) {
    const lead = text.slice(0, cut).trim();
    if (!isTechnical(lead)) {
      const rest = text.slice(cut + 2);
      return `${lead}. ${ruleFor(rest) || "Please try again."}`;
    }
  }
  return ruleFor(text) || fallback;
}

/** Friendly text for an Error, a Supabase error object, or a string. */
export function friendlyError(error, fallback = GENERIC_ERROR) {
  if (error && typeof error === "object" && typeof error.friendly === "string" && error.friendly.trim()) {
    return error.friendly;
  }
  const text = typeof error === "string" ? error : error?.message;
  const code = error && typeof error === "object" ? String(error.code || "") : "";
  if (code) {
    const byCode = ruleFor(code);
    if (byCode) return byCode;
  }
  return friendlyMessage(text, fallback);
}
