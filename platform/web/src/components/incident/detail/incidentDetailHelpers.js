import { format } from 'date-fns';
import { parsePatrolTime } from '../../../utils/watchTime';

export function formatIncidentWhen(value, pattern = 'MMM dd, yyyy HH:mm') {
  const d = parsePatrolTime(value);
  if (!d) {
    const s = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      try {
        return format(new Date(`${s}T12:00:00+02:00`), pattern.includes('HH') ? 'MMM dd, yyyy' : pattern);
      } catch {
        return s;
      }
    }
    return '—';
  }
  try {
    return format(d, pattern);
  } catch {
    return '—';
  }
}

/**
 * `incident_suspects` is populated for every structured suspect submit; `incident_evidence` rows can be
 * missing (older flows, failed insert, or evidence_id mismatch). Merge so the report still shows suspect entries.
 */
/** Normalize profile_incidents.confidence_score (DB may return number or string). */
export function parseStoredLinkConfidence(raw) {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(100, Math.round(n)));
}

/**
 * When profile_incidents.confidence_score is null, use suspect evidence metadata.
 * Prefer the most recently created row with a score (not MAX), so lowering confidence to 90 is not beaten by an older 100.
 */
export function confidenceScoreFromSuspectEvidence(evidenceRows, profileId) {
  if (profileId == null) return null;
  const want = String(profileId);
  let best = null;
  let bestT = -Infinity;
  for (const row of evidenceRows || []) {
    if (row?.category !== "suspects") continue;
    const lid = row.metadata?.linked_profile_id;
    if (lid == null || String(lid) !== want) continue;
    const raw = row.metadata?.linked_confidence_score;
    if (raw == null || raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    const clamped = Math.max(1, Math.min(100, Math.round(n)));
    const t = parsePatrolTime(row.updated_at || row.created_at)?.getTime() || 0;
    if (best == null || t >= bestT) {
      best = clamped;
      bestT = t;
    }
  }
  return best;
}

export function mergeIncidentSuspectsIntoEvidence(evidenceRows, suspectRows) {
  const list = [...(evidenceRows || [])];
  const evidenceIds = new Set(list.map((r) => r?.id).filter(Boolean));
  for (const s of suspectRows || []) {
    if (s.evidence_id != null && evidenceIds.has(s.evidence_id)) continue;
    const meta = {};
    if (s.estimated_age != null && s.estimated_age !== '') meta.age = s.estimated_age;
    if (s.clothing_description) meta.clothing = s.clothing_description;
    if (s.direction_last_seen) meta.direction = s.direction_last_seen;
    if (s.time_observed) meta.timeObserved = s.time_observed;
    list.push({
      id: `__incident_suspect__${s.id}`,
      incident_id: s.incident_id,
      category: 'suspects',
      description: s.description?.trim() || '',
      metadata: meta,
      media_urls: s.photo_urls,
      submitted_by: null,
      created_at: s.created_at,
    });
  }
  return list;
}
