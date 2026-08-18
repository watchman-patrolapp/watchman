import { isGlobalAppRole } from "../auth/roleMatrix";

export function userBelongsToOrganization(user, organizationId, memberUserIds = new Set()) {
  if (!user?.id || !organizationId) return false;
  if (isGlobalAppRole(user.role)) return false;
  return user.organization_id === organizationId || memberUserIds.has(user.id);
}

export function filterUsersForOrganization(users, organizationId, memberUserIds = new Set()) {
  if (!organizationId) return [];
  return (users || []).filter((user) => userBelongsToOrganization(user, organizationId, memberUserIds));
}
