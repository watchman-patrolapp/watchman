import { supabase } from '../supabase/client';
import { isRpcNotFoundError } from './isRpcNotFound';

/** Roles included in patroller/staff directory (matches list_patrollers_for_sightings RPC). */
export const PATROLLER_DIRECTORY_ROLES = new Set([
  'patroller',
  'investigator',
  'committee',
  'admin',
  'technical_support',
]);

export function normalizePatrollerDirectoryRow(row) {
  if (!row || typeof row !== 'object') return null;
  const id = row.id;
  if (id == null) return null;
  return {
    id,
    full_name: row.full_name != null ? String(row.full_name) : '',
    email: row.email != null ? String(row.email) : '',
    avatar_url: row.avatar_url || null,
    role: row.role != null ? String(row.role) : '',
  };
}

/**
 * @returns {Promise<{ members: ReturnType<typeof normalizePatrollerDirectoryRow>[], errorHint: string | null }>}
 */
export async function loadPatrollerDirectoryMembers() {
  const applyRows = (rows) => {
    const out = [];
    for (const r of rows || []) {
      const n = normalizePatrollerDirectoryRow(r);
      if (n) out.push(n);
    }
    return out;
  };

  const filterByRole = (rows) =>
    applyRows(rows).filter((m) =>
      PATROLLER_DIRECTORY_ROLES.has(String(m.role || '').toLowerCase().trim())
    );

  try {
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('list_patrollers_for_sightings');
      if (!rpcError && Array.isArray(rpcData) && rpcData.length > 0) {
        return { members: applyRows(rpcData), errorHint: null };
      }
      if (rpcError && !isRpcNotFoundError(rpcError)) {
        console.warn('list_patrollers_for_sightings:', rpcError.message);
      }
    } catch (e) {
      console.warn('list_patrollers_for_sightings:', e);
    }

    const { data, error } = await supabase.from('users').select('id, full_name, email, avatar_url, role');
    if (error) throw error;
    const filtered = filterByRole(data);
    if (filtered.length === 0 && (data || []).length > 0) {
      return {
        members: [],
        errorHint:
          'No patrollers, investigators, committee, or admin accounts were found. Use “someone else” below or ask an admin to assign roles.',
      };
    }
    return { members: filtered, errorHint: null };
  } catch (e2) {
    console.warn('Patroller directory fallback (users):', e2?.message || e2);
    return {
      members: [],
      errorHint:
        'Could not load the member directory. Ensure the database migration for list_patrollers_for_sightings is applied, or check your connection.',
    };
  }
}
