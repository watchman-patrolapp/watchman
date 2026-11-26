import { useCallback, useMemo } from "react";
import { useActiveOrganization } from "../auth/useActiveOrganization";
import {
  shouldIncludeUnscopedProfiles,
  scopeToOrganization,
} from "./organizationScopeCore";

export {
  setWorkingOrganization,
  getWorkingOrganizationId,
  getWorkingOrganizationIncludeUnscoped,
  shouldIncludeUnscopedProfiles,
  scopeToOrganization,
  belongsToActiveOrganization,
  applyWorkingOrganizationScope,
  messageBelongsToWorkingOrganization,
} from "./organizationScopeCore";

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
