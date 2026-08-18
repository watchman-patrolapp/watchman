export function normalizePlatformRole(role) {
  if (role == null) return "none";
  const value = String(role).trim().toLowerCase();
  if (!value) return "none";
  if (value === "owner") return "platform_owner";
  if (value === "ops") return "platform_ops";
  if (value === "support") return "platform_support";
  return value;
}

export function canAccessPlatformConsole(platformRole) {
  const role = normalizePlatformRole(platformRole);
  return role === "platform_owner" || role === "platform_ops" || role === "platform_support";
}

export function isPlatformOwner(platformRole) {
  return normalizePlatformRole(platformRole) === "platform_owner";
}
