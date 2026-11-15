/** Public contact for privacy, POPIA, and account-deletion requests. */
export const DEFAULT_PRIVACY_CONTACT_EMAIL = "africuz@gmail.com";

export function getPrivacyContactEmail() {
  return (import.meta.env.VITE_PRIVACY_CONTACT_EMAIL || "").trim() || DEFAULT_PRIVACY_CONTACT_EMAIL;
}

export function privacyMailto({ subject, body } = {}) {
  const email = getPrivacyContactEmail();
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  const query = params.toString();
  return query ? `mailto:${email}?${query}` : `mailto:${email}`;
}
