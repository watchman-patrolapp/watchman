/** Pure helpers for the city on the organisation setup form (SA places P6). */

function str(value) {
  return value == null ? "" : String(value).trim();
}

/** CityPicker value for an organisation row: { id, name, province, nearLabel } or null. */
export function orgCityValue(org, citiesById) {
  const id = str(org?.city_id);
  if (!id) return null;
  const row = citiesById instanceof Map ? citiesById.get(id) : null;
  return { id, name: str(row?.name) || "This city", province: str(row?.province), nearLabel: "" };
}

/** Suburbs to offer for a city: that city's, plus any not yet linked to a city. All when no city. */
export function suburbsForCity(suburbs, cityId) {
  const list = Array.isArray(suburbs) ? suburbs : [];
  const id = str(cityId);
  if (!id) return list;
  return list.filter((s) => !str(s?.city_id) || str(s.city_id) === id);
}

/** Keeps the main suburb only if it belongs to the newly picked city. */
export function suburbAfterCityChange(suburbs, suburbId, cityId) {
  const sid = str(suburbId);
  if (!sid) return "";
  return suburbsForCity(suburbs, cityId).some((s) => str(s?.id) === sid) ? sid : "";
}

/** "" when fine, else a friendly message. New organisations need a city; edits keep theirs. */
export function orgCityError(form, editing) {
  if (editing) return "";
  return str(form?.city?.id) ? "" : "Choose the city or town for this organisation.";
}
