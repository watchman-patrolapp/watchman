/**
 * App roles that can open the admin panel and staff-only tools (not assignable to
 * `technical_support` via User Management UI — set in Supabase only).
 */
export const ADMIN_PANEL_ROLES = ['admin', 'committee', 'technical_support'];

export function normalizeAppRole(role) {
  if (role == null || String(role).trim() === '') return '';
  let r = String(role).trim().toLowerCase();
  if (r === 'patrol') return 'patroller';
  // DB / manual entry variants
  r = r.replace(/\s+/g, '_').replace(/-/g, '_');
  if (r === 'technicalsupport') return 'technical_support';
  if (r === 'tech_support') return 'technical_support';
  return r;
}

export function canAccessAdminPanel(role) {
  const r = normalizeAppRole(role);
  return ADMIN_PANEL_ROLES.includes(r);
}

/** Incidents / feedback alert hooks (dashboard + mobile dock). */
export function isStaffForModerationAlerts(role) {
  return canAccessAdminPanel(role);
}
