/**
 * Map queue / model confidence to profile_incidents.confidence_score (1–100).
 * Accepts decimals in (0,1] as fractions or 1–100 as integer percent.
 * @param {unknown} raw — e.g. profile_match_queue.match_confidence
 * @returns {number | null}
 */
export function matchQueueConfidenceToScore(raw) {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n > 0 && n <= 1) return Math.max(1, Math.min(100, Math.round(n * 100)));
  if (n >= 1 && n <= 100) return Math.round(n);
  return null;
}
