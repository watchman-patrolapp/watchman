/**
 * Supabase Auth `User` includes `role: 'authenticated' | 'anon' | …` (JWT / auth-level).
 * That is NOT `public.users.role` (admin, patroller, committee, …).
 * Spreading `session.user` into React state caused RequireRole to deny access on refresh
 * before `users` row hydration overwrote `role`.
 */

const SUPABASE_AUTH_ONLY_ROLES = new Set(['authenticated', 'anon', 'anonymous'])

/**
 * True when `role` is a real app role from `public.users`, not the transient JWT role.
 */
export function hasHydratedAppRole(role) {
  if (role == null || String(role).trim() === '') return false
  const r = String(role).trim().toLowerCase()
  if (SUPABASE_AUTH_ONLY_ROLES.has(r)) return false
  return true
}

/**
 * Build a user object from `session.user` without copying JWT `role` (wait for profile fetch).
 */
export function sessionUserForAppState(sessionUser, extra = {}) {
  if (!sessionUser) return null
  const { role: _jwtRole, ...rest } = sessionUser
  return {
    ...rest,
    ...extra,
    uid: sessionUser.id,
    role: undefined,
  }
}
