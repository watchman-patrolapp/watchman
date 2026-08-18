const storageKey = (userId) => `nwp.activeOrganizationId.${userId || "anon"}`;

export function readStoredActiveOrganizationId(userId) {
  try {
    return localStorage.getItem(storageKey(userId)) || "";
  } catch {
    return "";
  }
}

export function writeStoredActiveOrganizationId(userId, organizationId) {
  try {
    const key = storageKey(userId);
    if (organizationId) localStorage.setItem(key, organizationId);
    else localStorage.removeItem(key);
  } catch {
    /* ignore quota / private mode */
  }
}
