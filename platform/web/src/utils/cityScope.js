import { supabase } from "../supabase/client";
import { DEFAULT_CITY_FULL_NAME } from "../config/neighborhoodRegions";

export { DEFAULT_CITY_FULL_NAME };

/**
 * Parent city for every neighborhood in this deployment.
 * Falls back to the Gqeberha label if the cities table is empty or SQL is not applied yet.
 */
export async function fetchParentCity() {
  try {
    const { data: named, error: namedErr } = await supabase
      .from("cities")
      .select("id, name")
      .ilike("name", "%gqeberha%")
      .limit(1)
      .maybeSingle();
    if (!namedErr && named?.name) return { id: named.id, name: named.name };

    const { data, error } = await supabase
      .from("cities")
      .select("id, name")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data?.name) return { id: data.id, name: data.name };
  } catch {
    /* cities table or RLS not ready */
  }
  return { id: null, name: DEFAULT_CITY_FULL_NAME };
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
