import { supabase } from "../supabase/client";
import { fetchInChunks } from "./fetchInChunks";
import { INCIDENT_PAGE_SIZE, incidentKeysetOr } from "./incidentKeyset";

function groupByIncident(rows) {
  const map = {};
  for (const row of rows || []) {
    const key = row?.incident_id;
    if (!key) continue;
    if (!map[key]) map[key] = [];
    map[key].push(row);
  }
  for (const list of Object.values(map)) {
    list.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  }
  return map;
}

async function loadRelated(table, ids) {
  const run = () =>
    fetchInChunks(ids, (chunk) =>
      supabase.from(table).select("*").in("incident_id", chunk).order("created_at", { ascending: true })
    );
  try {
    return { rows: await run(), error: null };
  } catch {
    try {
      return { rows: await run(), error: null };
    } catch (retryError) {
      return { rows: [], error: retryError };
    }
  }
}

export function approvedIncidentsQueryKey(organizationId, includeUnscoped) {
  return ["incidents", "approved", organizationId || null, Boolean(includeUnscoped)];
}

/** One keyset page of approved incidents, plus chunked evidence and section updates. */
export async function fetchApprovedIncidentPage({ scope, pageParam }) {
  let query = scope(supabase.from("incidents").select("*"))
    .eq("status", "approved")
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(INCIDENT_PAGE_SIZE);

  if (pageParam?.submitted_at && pageParam?.id) {
    const orFilter = incidentKeysetOr(pageParam);
    if (orFilter) query = query.or(orFilter);
  } else if (pageParam?.id && !pageParam?.submitted_at) {
    query = query.is("submitted_at", null).lt("id", pageParam.id);
  }

  const { data, error } = await query;
  if (error) throw error;

  const raw = data || [];
  const ids = raw.map((row) => row.id).filter(Boolean);
  let evidenceFailed = false;
  let updatesFailed = false;
  let evidenceMap = {};
  let updatesMap = {};
  if (ids.length) {
    const [evidence, updates] = await Promise.all([
      loadRelated("incident_evidence", ids),
      loadRelated("incident_section_updates", ids),
    ]);
    evidenceFailed = Boolean(evidence.error);
    updatesFailed = Boolean(updates.error);
    evidenceMap = groupByIncident(evidence.rows);
    updatesMap = groupByIncident(updates.rows);
  }

  const rows = raw.map((row) => ({
    ...row,
    evidenceRows: evidenceFailed ? null : evidenceMap[row.id] || [],
    evidenceUnknown: evidenceFailed,
    sectionUpdates: updatesFailed ? [] : updatesMap[row.id] || [],
    updatesUnknown: updatesFailed,
  }));
  const last = raw[raw.length - 1];
  const nextCursor =
    raw.length === INCIDENT_PAGE_SIZE && last
      ? { submitted_at: last.submitted_at || null, id: last.id }
      : null;

  return { rows, evidenceFailed, updatesFailed, nextCursor };
}
