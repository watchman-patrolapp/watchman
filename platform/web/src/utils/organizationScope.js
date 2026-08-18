import { useCallback, useMemo } from "react";
import { useActiveOrganization } from "../auth/useActiveOrganization";

/** Empty UUID so an unscoped query returns no rows instead of every neighborhood. */
const NO_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000000";

let workingOrganizationId = null;
let workingOrganizationName = "";

export function setWorkingOrganization(organization) {
  workingOrganizationId = organization?.id || null;
  workingOrganizationName = organization?.name || "";
}

export function getWorkingOrganizationId() {
  return workingOrganizationId;
}

export function getWorkingOrganizationIncludeUnscoped() {
  return /theescombe/i.test(workingOrganizationName);
}

export function useScopedOrganization() {
  const { activeOrganizationId, activeOrganization } = useActiveOrganization();
  const includeUnscoped = shouldIncludeUnscopedProfiles(activeOrganization);
  const scope = useCallback(
    (query) => scopeToOrganization(query, activeOrganizationId, includeUnscoped),
    [activeOrganizationId, includeUnscoped]
  );
  return useMemo(
    () => ({
      activeOrganizationId,
      activeOrganization,
      includeUnscoped,
      scope,
    }),
    [activeOrganizationId, activeOrganization, includeUnscoped, scope]
  );
}

export function shouldIncludeUnscopedProfiles(organization) {
  return /theescombe/i.test(organization?.name || "");
}

export function scopeToOrganization(query, organizationId, includeUnscoped = false) {
  if (!organizationId) {
    return query.eq("organization_id", NO_ORGANIZATION_ID);
  }
  if (includeUnscoped) {
    return query.or(`organization_id.eq.${organizationId},organization_id.is.null`);
  }
  return query.eq("organization_id", organizationId);
}

export function belongsToActiveOrganization(row, organizationId, includeUnscoped = false) {
  if (!organizationId) return false;
  if (row?.organization_id === organizationId) return true;
  return Boolean(includeUnscoped && row?.organization_id == null);
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
