/**
 * Incident GPS columns (incidents.latitude / longitude / location_accuracy). They only exist once
 * the Android Auto migration has been applied, so writers retry without them when they are missing.
 */

/** The three columns for a finite, in-range fix; {} otherwise. Accepts {latitude, longitude, accuracy}. */
export function coordsColumns(coords) {
  const latitude = Number(coords?.latitude);
  const longitude = Number(coords?.longitude);
  if (
    coords?.latitude == null ||
    coords?.longitude == null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return {};
  }
  const accuracy = Number(coords.accuracy);
  return {
    latitude,
    longitude,
    location_accuracy: coords.accuracy != null && Number.isFinite(accuracy) && accuracy >= 0
      ? Math.round(accuracy * 10) / 10
      : null,
  };
}

/** True when an insert/update failed only because the coordinate columns are not there yet. */
export function isMissingCoordColumnError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const text = `${err.message || ''} ${err.details || ''} ${err.hint || ''}`.toLowerCase();
  if (code === '42703' || code === 'PGRST204') return true;
  return (
    /\b(latitude|longitude|location_accuracy)\b/.test(text) &&
    /(column|schema cache|could not find)/.test(text)
  );
}
