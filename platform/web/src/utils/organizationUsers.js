import { isGlobalAppRole } from "../auth/roleMatrix";

export function userBelongsToOrganization(
  user,
  organizationId,
  memberUserIds = new Set(),
  { includeUnlinked = false } = {}
) {
  if (!user?.id || !organizationId) return false;
  if (isGlobalAppRole(user.role)) return false;
  if (user.organization_id === organizationId || memberUserIds.has(user.id)) return true;
  return Boolean(includeUnlinked && !user.organization_id);
}

export function filterUsersForOrganization(
  users,
  organizationId,
  memberUserIds = new Set(),
  options = {}
) {
  if (!organizationId) return [];
  return (users || []).filter((user) =>
    userBelongsToOrganization(user, organizationId, memberUserIds, options)
  );
}
