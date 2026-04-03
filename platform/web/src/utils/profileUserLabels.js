/**
 * Resolve display names for criminal_profiles.created_by / updated_by (user UUID strings).
 */

import { isRpcNotFoundError } from './isRpcNotFound';

export function userDisplayLabelFromRow(row) {
  if (!row) return null;
  const n = (row.full_name || '').trim();
  if (n) return n;
  const e = (row.email || '').trim();
  if (e) return e;
  return null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isLikelyUserUuid(id) {
  if (id == null) return false;
  return UUID_RE.test(String(id).trim());
}

export function collectUserIdsFromProfiles(profiles) {
  const set = new Set();
  for (const p of profiles || []) {
    if (!p || typeof p !== 'object') continue;
    if (p.created_by && isLikelyUserUuid(p.created_by)) set.add(String(p.created_by).trim());
    if (p.updated_by && isLikelyUserUuid(p.updated_by)) set.add(String(p.updated_by).trim());
  }
  return [...set];
}

function rowsToLabelMap(rows) {
  const out = {};
  for (const row of rows || []) {
    if (row?.id == null) continue;
    const label = userDisplayLabelFromRow(row);
    out[String(row.id)] = label || `${String(row.id).slice(0, 8)}…`;
  }
  return out;
}

/** @param {import('@supabase/supabase-js').SupabaseClient} supabase */
export async function fetchUserLabelMap(supabase, userIds) {
  const ids = [
    ...new Set(
      (userIds || []).map((id) => String(id).trim()).filter((id) => isLikelyUserUuid(id))
    ),
  ];
  if (!ids.length) return {};

  const { data: rpcData, error: rpcError } = await supabase.rpc('user_labels_for_audit', {
    p_user_ids: ids,
  });

  if (!rpcError && Array.isArray(rpcData)) {
    return rowsToLabelMap(rpcData);
  }

  if (rpcError && !isRpcNotFoundError(rpcError)) {
    console.warn('user_labels_for_audit:', rpcError.message);
  }

  const { data, error } = await supabase.from('users').select('id, full_name, email').in('id', ids);
  if (error || !data) return {};
  return rowsToLabelMap(data);
}

export function formatAuditDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

/** True if the row was edited after creation (or updated_by is set and differs from creator). */
export function profileHasDistinctUpdate(profile) {
  if (!profile?.updated_at) return false;
  const u = new Date(profile.updated_at).getTime();
  if (!Number.isFinite(u)) return false;
  const c = profile.created_at ? new Date(profile.created_at).getTime() : NaN;
  if (!Number.isFinite(c)) return true;
  if (u - c > 2000) return true;
  const ub = profile.updated_by != null && String(profile.updated_by).trim() !== '';
  const cb = profile.created_by != null && String(profile.created_by).trim() !== '';
  if (ub && cb && String(profile.updated_by).trim() !== String(profile.created_by).trim()) return true;
  return false;
}

export function resolveUserLabel(id, labelMap) {
  if (id == null || String(id).trim() === '') return 'Unknown';
  const key = String(id).trim();
  const m = labelMap || {};
  if (m[key]) return m[key];
  if (isLikelyUserUuid(key)) return `${key.slice(0, 8)}…`;
  return key;
}
