export function compiledReportValidationError(reportDraft) {
  const hasPin =
    Number.isFinite(Number(reportDraft?.pinLat)) &&
    Number.isFinite(Number(reportDraft?.pinLng));
  const hasLocationText = Boolean(reportDraft?.location?.trim());
  const hasLocation = hasLocationText || hasPin;
  if (!reportDraft?.description?.trim() || !hasLocation || !reportDraft?.type) {
    if (!reportDraft?.description?.trim()) return 'Please add a description';
    if (!hasLocation) return 'Add a location in the text field or drop a pin on the map';
    return 'Please choose an incident type';
  }
  return null;
}

export function buildCompiledIncidentInsert(reportDraft, { userId, submittedByName, organizationId, now } = {}) {
  const hasPin =
    Number.isFinite(Number(reportDraft?.pinLat)) &&
    Number.isFinite(Number(reportDraft?.pinLng));
  const pinText = hasPin
    ? `Pinned coordinates: ${Number(reportDraft.pinLat).toFixed(6)}, ${Number(reportDraft.pinLng).toFixed(6)}`
    : null;
  const submittedAt = now ? new Date(now) : new Date();
  const dateFallback = now ? new Date(now) : new Date();
  const dateStr = reportDraft.incidentDate || dateFallback.toISOString().split('T')[0];
  const timeRaw = (reportDraft.incidentTime || '00:00').slice(0, 5);
  const [th, tm] = timeRaw.split(':').map((x) => Number.parseInt(x, 10));
  const safeH = Number.isFinite(th) ? Math.min(23, Math.max(0, th)) : 0;
  const safeM = Number.isFinite(tm) ? Math.min(59, Math.max(0, tm)) : 0;
  const localWhen = new Date(
    `${dateStr}T${String(safeH).padStart(2, '0')}:${String(safeM).padStart(2, '0')}:00`
  );
  const timeLabel = `${String(safeH).padStart(2, '0')}:${String(safeM).padStart(2, '0')}`;
  let bodyText = reportDraft.description.trim();
  bodyText = pinText ? `${bodyText}\n\n${pinText}` : bodyText;
  bodyText = `${bodyText}\n\nIncident occurred (local): ${dateStr} ${timeLabel}`;
  const finalLocation =
    reportDraft.location.trim() ||
    (hasPin
      ? `Pinned location (${Number(reportDraft.pinLat).toFixed(5)}, ${Number(reportDraft.pinLng).toFixed(5)})`
      : '');
  return {
    incident_date: Number.isFinite(localWhen.getTime()) ? localWhen.toISOString() : dateStr,
    location: finalLocation,
    type: reportDraft.type,
    description: bodyText,
    suspect_name: reportDraft.suspectName?.trim() || null,
    status: 'pending',
    submitted_at: submittedAt.toISOString(),
    submitted_by: userId,
    submitted_by_name: submittedByName,
    organization_id: organizationId,
  };
}
