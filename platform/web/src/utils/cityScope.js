import { supabase } from "../supabase/client";
import { cityResult } from "./cityScopeView.js";

export { cityResult };

/**
 * The signed-in person's city: the city of the organisation they are working in, else the city
 * they live in, else the platform fallback (the database's default_city_id(), which is caller-based
 * from SA places P6). Never guesses a city by name. Returns { id: null, name: "" } if unknown.
 */
export async function fetchParentCity(activeOrganizationId = null) {
  try {
    if (activeOrganizationId) {
      const byOrg = await fetchOrganizationCities([activeOrganizationId]);
      const own = byOrg.get(activeOrganizationId);
      if (own?.id) return own;
    }
    const { data: cityId, error } = await supabase.rpc("default_city_id");
    if (error || !cityId) return cityResult(null);
    const { data: city } = await supabase.from("cities").select("id, name").eq("id", cityId).maybeSingle();
    return cityResult(city);
  } catch {
    /* cities table or RLS not ready */
  }
  return cityResult(null);
}

/**
 * City for each organisation (its own city, else its main suburb's city): Map orgId -> { id, name }.
 * Empty map if the tables are not readable yet.
 */
export async function fetchOrganizationCities(orgIds) {
  const ids = [...new Set((orgIds || []).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  try {
    const { data: orgs, error } = await supabase
      .from("organizations")
      .select("id, city_id, primary_suburb_id")
      .in("id", ids);
    if (error || !Array.isArray(orgs)) return out;
    const suburbIds = orgs.filter((o) => !o.city_id && o.primary_suburb_id).map((o) => o.primary_suburb_id);
    const suburbCity = new Map();
    if (suburbIds.length) {
      const { data: subs } = await supabase.from("suburbs").select("id, city_id").in("id", suburbIds);
      for (const s of subs || []) if (s?.city_id) suburbCity.set(s.id, s.city_id);
    }
    const cityIds = [...new Set(orgs.map((o) => o.city_id || suburbCity.get(o.primary_suburb_id)).filter(Boolean))];
    if (!cityIds.length) return out;
    const { data: cities } = await supabase.from("cities").select("id, name").in("id", cityIds);
    const names = new Map((cities || []).map((c) => [c.id, c.name]));
    for (const o of orgs) {
      const cid = o.city_id || suburbCity.get(o.primary_suburb_id);
      if (cid && names.get(cid)) out.set(o.id, { id: cid, name: names.get(cid) });
    }
  } catch {
    /* not readable yet */
  }
  return out;
}
