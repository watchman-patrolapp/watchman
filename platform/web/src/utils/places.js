import { supabase } from "../supabase/client";
import { friendlyError } from "./friendlyError";
import { isRpcNotFoundError } from "./isRpcNotFound";
import {
  normalizeCityResults,
  normalizeHomeArea,
  normalizeMySuburbRequests,
  normalizeSuburbSuggestions,
  normalizeWatchList,
  shouldSearchPlaces,
} from "./placesView";

export const PLACES_NOT_READY_MESSAGE =
  "City search isn't available yet. Please try again a little later.";

/** Error with a member-safe message in `.friendly` (friendlyError reads it). */
function placesFailure(error, fallback) {
  const out = new Error("places request failed");
  out.friendly = isRpcNotFoundError(error) ? PLACES_NOT_READY_MESSAGE : friendlyError(error, fallback);
  out.notReady = isRpcNotFoundError(error);
  return out;
}

async function rpc(name, args, fallback) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw placesFailure(error, fallback);
  return data;
}

export async function searchCities(query, limit = 10) {
  if (!shouldSearchPlaces(query)) return [];
  const data = await rpc("search_cities", { p_q: String(query).slice(0, 80), p_limit: limit }, "Couldn't search cities. Please try again.");
  return normalizeCityResults(data);
}

/** One city by id (for a city chosen at sign-up). Cities are public reference data. */
export async function loadCity(cityId) {
  if (!cityId) return null;
  const { data, error } = await supabase
    .from("cities")
    .select("id, name, province, near_label")
    .eq("id", cityId)
    .maybeSingle();
  if (error || !data) return null;
  return { id: data.id, name: data.name, province: data.province || "", nearLabel: data.near_label || "", formerly: "", alsoKnownAs: "" };
}

export async function listCityWatches(cityId) {
  if (!cityId) return [];
  const data = await rpc("list_city_watches", { p_city_id: cityId }, "Couldn't load the watches. Please try again.");
  return normalizeWatchList(data);
}

export async function suggestSuburbs(cityId, query) {
  if (!cityId || !shouldSearchPlaces(query)) return [];
  const data = await rpc("suggest_suburbs", { p_city_id: cityId, p_q: String(query).slice(0, 80) }, "Couldn't check suburbs. Please try again.");
  return normalizeSuburbSuggestions(data);
}

export async function joinWatch(organizationId) {
  return rpc("join_watch", { p_org_id: organizationId }, "Couldn't join the watch. Please try again.");
}

export async function requestSuburbOrWatch({ cityId, suburbName, confirmNotListed = false, startWatch = false, watchName = null }) {
  const data = await rpc(
    "request_suburb_or_watch",
    {
      p_city_id: cityId,
      p_suburb_name: suburbName,
      p_confirm_not_listed: Boolean(confirmNotListed),
      p_start_watch: Boolean(startWatch),
      p_watch_name: watchName || null,
    },
    "Couldn't send your request. Please try again."
  );
  if (data && Array.isArray(data.suggestions)) {
    return { ...data, suggestions: normalizeSuburbSuggestions(data.suggestions) };
  }
  if (data && Array.isArray(data.watches)) {
    return { ...data, watches: normalizeWatchList(data.watches.map((w) => ({ ...w, suburb: data.name }))) };
  }
  return data;
}

export async function mySuburbRequests() {
  try {
    return normalizeMySuburbRequests(await rpc("my_suburb_requests", {}, ""));
  } catch {
    return [];
  }
}

/** Profile / Choose area: your city, your watch (name + suburb), waits, and whether you can change watch. */
export async function myHomeArea() {
  return normalizeHomeArea(await rpc("my_home_area", {}, "Couldn't load your area. Please try again."));
}

export async function setMyHomeCity(cityId) {
  return rpc("set_my_home_city", { p_city_id: cityId }, "Couldn't save your city. Please try again.");
}

/** Move to another approved watch (or join one if you're not in a watch yet). */
export async function switchMyWatch(orgId) {
  return rpc("switch_my_watch", { p_org_id: orgId }, "Couldn't change your watch. Please try again.");
}
