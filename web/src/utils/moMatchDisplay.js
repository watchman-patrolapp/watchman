/**
 * MO (modus operandi) match percentage must come from a real source — e.g.
 * `profile_incidents.confidence_score` when viewing a profile in incident context.
 * Never invent a default percentage in list/search views.
 */

/**
 * @param {unknown} raw — Typically `stats.moConfidence` (number | null | undefined)
 * @returns {{ display: string, assessed: boolean, percent: number | null }}
 */
export function formatMoMatchConfidence(raw) {
  if (raw == null || raw === '') {
    return { display: '—', assessed: false, percent: null };
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    return { display: '—', assessed: false, percent: null };
  }
  const clamped = Math.max(0, Math.min(100, Math.round(n)));
  return { display: `${clamped}%`, assessed: true, percent: clamped };
}

/**
 * Tooltip copy for the MO Match stat on profile cards.
 * @param {boolean} assessed
 */
export function moMatchCardTitle(assessed) {
  return assessed
    ? 'Confidence score from the profile–incident link.'
    : 'Not assessed here. Open a linked incident to see a confidence score from that link.';
}
