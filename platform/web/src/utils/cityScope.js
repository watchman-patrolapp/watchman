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
