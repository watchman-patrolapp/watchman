/**
 * MO Match on profile cards is only shown when callers pass `stats.moConfidence`
 * (e.g. a dedicated MO assessment). Do not pass link confidence here — it duplicated
 * “Link confidence” on incident pages and looked like a separate MO score.
 * Search/list views omit `moConfidence` so this shows “—”.
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
    ? 'MO-style confidence passed for this card (if used).'
    : 'No MO match score on this card. Intelligence search uses counts only; link confidence appears on the incident page when a profile is tied to that report.';
}
