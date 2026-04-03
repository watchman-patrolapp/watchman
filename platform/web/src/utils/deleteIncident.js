import { supabase } from '../supabase/client';

/**
 * Remove objects under incident-photos/{incidentId}/ (paths are incidentId/entryId/filename from IncidentForm).
 */
export async function removeIncidentStorageFolder(incidentId) {
  const bucket = 'incident-photos';
  const paths = [];

  const { data: top, error } = await supabase.storage.from(bucket).list(incidentId, { limit: 1000 });
  if (error) {
    console.warn('Storage list failed:', incidentId, error.message);
    return;
  }
  if (!top?.length) return;

  for (const entry of top) {
    const sub = `${incidentId}/${entry.name}`;
    const { data: inner, error: innerErr } = await supabase.storage.from(bucket).list(sub, { limit: 1000 });
    if (innerErr) continue;
    if (inner?.length) {
      for (const f of inner) {
        paths.push(`${sub}/${f.name}`);
      }
    } else {
      paths.push(sub);
    }
  }

  if (paths.length > 0) {
    const { error: rm } = await supabase.storage.from(bucket).remove(paths);
    if (rm) console.warn('Storage remove:', rm.message);
  }
}

/**
 * Hard-delete incident via admin_delete_incident RPC, then storage cleanup.
 * @returns {{ ok: boolean, error?: string }}
 */
export async function deleteIncidentFully(incidentId) {
  const { error: rpcError } = await supabase.rpc('admin_delete_incident', {
    p_incident_id: incidentId,
  });

  if (rpcError) {
    return { ok: false, error: rpcError.message };
  }

  try {
    await removeIncidentStorageFolder(incidentId);
  } catch (e) {
    console.warn('Post-delete storage cleanup:', e);
  }

  return { ok: true };
}
