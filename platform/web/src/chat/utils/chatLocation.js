/** GeolocationPosition, `{ latitude, longitude }`, or `{ lat, lng }`. */
export function parseChatLocationPosition(position) {
  let latitude;
  let longitude;

  if (position?.coords) {
    ({ latitude, longitude } = position.coords);
  } else if (position?.lat != null && position?.lng != null) {
    ({ lat: latitude, lng: longitude } = position);
  } else if (position?.latitude != null && position?.longitude != null) {
    ({ latitude, longitude } = position);
  } else {
    return { ok: false, reason: 'format' };
  }

  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, reason: 'coordinates', latitude, longitude, lat, lng };
  }
  return { ok: true, lat, lng };
}
