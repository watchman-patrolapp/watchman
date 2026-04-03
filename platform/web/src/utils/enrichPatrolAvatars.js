/**
 * Attach patrol_avatar_url for active_patrols rows.
 * Prefer RPC get_active_patroller_avatars() (SECURITY DEFINER) so patroller avatars work under users RLS.
 */
import { isRpcNotFoundError } from './isRpcNotFound';

let avatarsRpcTriedAndMissing = false;

function normalizePhone(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

export async function enrichPatrolRowsWithAvatars(supabase, patrolRows) {
  const list = patrolRows || [];
  if (list.length === 0) return [];

  let avatarById = {};
  let phoneById = {};

  if (!avatarsRpcTriedAndMissing) {
    const { data: rpcRows, error: rpcError } = await supabase.rpc('get_active_patroller_avatars');
    if (!rpcError && Array.isArray(rpcRows)) {
      avatarById = Object.fromEntries(
        rpcRows.map((r) => [r.user_id, r.avatar_url ?? null])
      );
      phoneById = Object.fromEntries(
        rpcRows.map((r) => [r.user_id, normalizePhone(r.phone)])
      );
    } else if (isRpcNotFoundError(rpcError)) {
      avatarsRpcTriedAndMissing = true;
    }
  }

  if (Object.keys(avatarById).length === 0 && list.length > 0) {
    const ids = [...new Set(list.map((p) => p.user_id).filter(Boolean))];
    let users;
    let error;
    ({ data: users, error } = await supabase.from('users').select('id, avatar_url, phone').in('id', ids));
    const missingPhoneCol =
      error?.code === 'PGRST204' &&
      typeof error?.message === 'string' &&
      error.message.toLowerCase().includes('phone');
    if (missingPhoneCol) {
      ({ data: users, error } = await supabase.from('users').select('id, avatar_url').in('id', ids));
    }
    if (error) {
      if (!avatarsRpcTriedAndMissing) {
        console.warn('enrichPatrolRowsWithAvatars: users fallback failed', error);
      }
      return list.map((p) => ({ ...p, patrol_avatar_url: null, patroller_phone: null }));
    }
    avatarById = Object.fromEntries((users || []).map((u) => [u.id, u.avatar_url ?? null]));
    phoneById = Object.fromEntries(
      (users || []).map((u) => [u.id, normalizePhone(u.phone)])
    );
  }

  return list.map((p) => ({
    ...p,
    patrol_avatar_url: avatarById[p.user_id] ?? null,
    patroller_phone: phoneById[p.user_id] ?? null,
  }));
}
