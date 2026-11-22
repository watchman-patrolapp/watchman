/**
 * Terms acceptance gate: pure helpers (no React, no Supabase) so they can be unit-tested.
 *
 * Bump CURRENT_TERMS_VERSION whenever the Terms of Use or the Privacy Policy change
 * materially. Every member is then asked to accept again before using the app.
 */
export const CURRENT_TERMS_VERSION = "2026-11-21";

/**
 * Profile fields the gate reads. termsColumnPresent is false until the
 * terms_acceptance SQL has been run, so the gate fails open instead of locking everyone out.
 */
export function termsFieldsFromUsersRow(row) {
  const present = Boolean(row) && Object.prototype.hasOwnProperty.call(row, "terms_version");
  return {
    termsColumnPresent: present,
    termsVersion: present ? row.terms_version ?? null : null,
    termsAcceptedAt: present ? row.terms_accepted_at ?? null : null,
  };
}

/** The two sign-up metadata keys the gate needs (Register.jsx writes them). */
export function termsSignupMetadataFrom(authUser) {
  const meta = authUser?.user_metadata || {};
  return {
    terms_version: meta.terms_version ?? null,
    terms_accepted_at: meta.terms_accepted_at ?? null,
  };
}

/** True when sign-up metadata shows this exact version was accepted on the Register form. */
export function acceptedAtSignup(authMetadata, version = CURRENT_TERMS_VERSION) {
  if (!authMetadata || typeof authMetadata !== "object") return false;
  return authMetadata.terms_version === version && Boolean(authMetadata.terms_accepted_at);
}

/**
 * What the gate should do for this user.
 *   "pass"   let the app render (accepted, or we cannot tell yet: fail open)
 *   "signup" accepted on the Register form; record it silently
 *   "ask"    show the acceptance screen
 */
export function termsGateDecision({
  user,
  online = true,
  acceptedLocally = null,
  version = CURRENT_TERMS_VERSION,
} = {}) {
  if (!user) return "pass";
  if (acceptedLocally === version) return "pass";
  // Profile not loaded yet, offline cache, or SQL not run: never block.
  if (!user.profileLoaded || user.profileFromCache) return "pass";
  if (user.termsColumnPresent !== true) return "pass";
  if (user.termsVersion === version) return "pass";
  if (!online) return "pass";
  if (acceptedAtSignup(user.termsSignupMetadata ?? user.user_metadata, version)) return "signup";
  return "ask";
}
