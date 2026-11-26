/** Empty UUID so an unscoped query returns no rows instead of every neighborhood. */
const NO_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000000";

let workingOrganizationId = null;

export function setWorkingOrganization(organization) {
  workingOrganizationId = organization?.id || null;
}

export function getWorkingOrganizationId() {
  return workingOrganizationId;
}

/**
 * Legacy unscoped rows are backfilled onto the first watch by SA places R5.
 * includeUnscoped stays in the helpers so existing callers compile, and is always false.
 */
export function getWorkingOrganizationIncludeUnscoped() {
  return false;
}

export function shouldIncludeUnscopedProfiles() {
  return false;
}

export function scopeToOrganization(query, organizationId) {
  if (!organizationId) {
    return query.eq("organization_id", NO_ORGANIZATION_ID);
  }
  return query.eq("organization_id", organizationId);
}

export function belongsToActiveOrganization(row, organizationId) {
  if (!organizationId) return false;
  return row?.organization_id === organizationId;
}

/** For services and hooks that cannot call React hooks. */
export function applyWorkingOrganizationScope(query) {
  return scopeToOrganization(
    query,
    getWorkingOrganizationId(),
    getWorkingOrganizationIncludeUnscoped()
  );
}

export function messageBelongsToWorkingOrganization(row) {
  return belongsToActiveOrganization(
    row,
    getWorkingOrganizationId(),
    getWorkingOrganizationIncludeUnscoped()
  );
}
