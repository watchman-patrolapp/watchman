/**
 * City / watch / suburb picker helpers (SA places, phase P3). Pure functions; unit-tested.
 * Payloads are trimmed to the fields the UI shows: watch lists never carry counts or contacts.
 */

export const PLACES_MIN_QUERY = 2;
export const PLACES_DEBOUNCE_MS = 250;
export const SUBURB_NAME_MAX = 80;

/** Lower case, accents folded, punctuation as spaces, single spaces (close to place_name_key in SQL). */
export function placeQueryKey(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True when a typed search is long enough to send. */
export function shouldSearchPlaces(text) {
  return placeQueryKey(text).length >= PLACES_MIN_QUERY;
}

/** Tidy a typed suburb name the way the server does: trim, single spaces, max 80 characters. */
export function cleanPlaceName(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, SUBURB_NAME_MAX);
}

const str = (v) => (typeof v === "string" ? v.trim() : "");

/** search_cities rows -> { id, name, province, provinceCode, nearLabel, placeType, formerly, alsoKnownAs }. */
export function normalizeCityResults(data) {
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => ({
      id: str(row?.id),
      name: str(row?.name),
      province: str(row?.province),
      provinceCode: str(row?.province_code),
      nearLabel: str(row?.near_label),
      placeType: str(row?.place_type),
      formerly: str(row?.formerly),
      alsoKnownAs: str(row?.also_known_as),
    }))
    .filter((row) => row.id && row.name);
}

/** "Makhanda, Eastern Cape" or "Middelburg (near Steynsburg), Eastern Cape". */
export function cityOptionLabel(city) {
  const name = str(city?.name);
  if (!name) return "";
  const near = str(city?.nearLabel);
  const province = str(city?.province);
  const head = near ? `${name} (${near})` : name;
  return province ? `${head}, ${province}` : head;
}

/** "(formerly Grahamstown)" when the search matched an old name, "(also called Ibhayi)" for an alternate. */
export function cityOptionNote(city) {
  const formerly = str(city?.formerly);
  if (formerly && placeQueryKey(formerly) !== placeQueryKey(city?.name)) return `(formerly ${formerly})`;
  const aka = str(city?.alsoKnownAs);
  if (aka && placeQueryKey(aka) !== placeQueryKey(city?.name)) return `(also called ${aka})`;
  return "";
}

const MY_STATES = new Set(["active", "pending"]);

/** list_city_watches rows -> { id, name, suburb, myStatus }. Anything else in the payload is dropped. */
export function normalizeWatchList(data) {
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => ({
      id: str(row?.organization_id),
      name: str(row?.name),
      suburb: str(row?.suburb),
      myStatus: MY_STATES.has(row?.my_status) ? row.my_status : "",
    }))
    .filter((row) => row.id && row.name);
}

/** Filter a city's watches by a typed suburb or name (client side, for long lists). */
export function filterWatches(watches, text) {
  const key = placeQueryKey(text);
  if (!key) return watches;
  return watches.filter((w) => placeQueryKey(`${w.name} ${w.suburb}`).includes(key));
}

const MATCHES = new Set(["exact", "prefix", "similar"]);

/** suggest_suburbs rows -> { id, name, match, beingSetUp, watches: [{ id, name, myStatus }] }. */
export function normalizeSuburbSuggestions(data) {
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => ({
      id: str(row?.suburb_id),
      name: str(row?.name),
      match: MATCHES.has(row?.match) ? row.match : "similar",
      beingSetUp: row?.state === "being_set_up",
      watches: normalizeWatchList(
        Array.isArray(row?.watches) ? row.watches.map((w) => ({ ...w, suburb: row?.name })) : []
      ),
    }))
    .filter((row) => row.id && row.name);
}

/**
 * What the "My suburb isn't listed" form allows right now.
 * - exact: the typed name already exists (Join it instead; no Create).
 * - needsConfirm: close spellings exist; Create only after "It's not one of these".
 */
export function suburbRequestState({ name = "", suggestions = [], confirmed = false, loading = false } = {}) {
  const clean = cleanPlaceName(name);
  const key = placeQueryKey(clean);
  const exact = suggestions.find((s) => placeQueryKey(s.name) === key) || null;
  const tooShort = key.length < PLACES_MIN_QUERY;
  const needsConfirm = !exact && suggestions.length > 0;
  const canSubmit = !loading && !tooShort && !exact && (!needsConfirm || confirmed);
  let hint = "";
  if (tooShort) hint = "Type your suburb's name.";
  else if (loading) hint = "Checking for suburbs with that name…";
  else if (exact) hint = `${exact.name} is already listed. Join it above.`;
  else if (needsConfirm && !confirmed) hint = "Is it one of these? If not, tick the box to ask for a new suburb.";
  else hint = "We'll send your suburb for approval.";
  return { clean, exact, tooShort, needsConfirm, canSubmit, hint };
}

/** Friendly copy for a request_suburb_or_watch result. */
export function requestResultCopy(result) {
  const status = result?.status;
  if (status === "requested") {
    const suburb = str(result?.suburb) || "your suburb";
    return {
      tone: "success",
      title: "Sent for approval",
      body: `We'll review ${suburb} and its watch, usually within a few days. You'll see it here once it's approved.`,
    };
  }
  if (status === "exists") {
    const name = str(result?.name) || "That suburb";
    return result?.state === "being_set_up"
      ? { tone: "info", title: `${name} is being set up`, body: "Someone has already asked for it. You'll be able to join once it's approved." }
      : { tone: "info", title: `${name} is already listed`, body: "Join one of its watches instead." };
  }
  if (status === "confirm_needed") {
    return { tone: "info", title: "Is it one of these?", body: "We found suburbs with a similar name. If yours isn't one of them, tick the box and send again." };
  }
  return null;
}

/** Friendly copy for a join_watch result. */
export function joinResultCopy(result) {
  const name = str(result?.name) || "the watch";
  if (result?.status === "joined") return { tone: "success", title: `Welcome to ${name}`, body: "You're in. Your dashboard now shows this watch." };
  if (result?.status === "already_member") return { tone: "info", title: `You're already in ${name}`, body: "" };
  if (result?.status === "pending") return { tone: "info", title: `Your request to join ${name} is waiting`, body: "" };
  return null;
}

/** my_suburb_requests rows -> { id, suburb, city, state, mergedInto }. */
export function normalizeMySuburbRequests(data) {
  if (!Array.isArray(data)) return [];
  const states = new Set(["pending", "approved", "merged", "not_approved"]);
  return data
    .map((row) => ({
      id: str(row?.suburb_id),
      suburb: str(row?.suburb),
      city: str(row?.city),
      state: states.has(row?.state) ? row.state : "pending",
      mergedInto: str(row?.merged_into),
    }))
    .filter((row) => row.id && row.suburb);
}

export function mySuburbRequestLabel(row) {
  const where = row.city ? `${row.suburb}, ${row.city}` : row.suburb;
  switch (row.state) {
    case "approved":
      return `${where}: approved`;
    case "merged":
      return row.mergedInto ? `${where}: joined to ${row.mergedInto}` : `${where}: joined to an existing suburb`;
    case "not_approved":
      return `${where}: not approved`;
    default:
      return `${where}: waiting for approval`;
  }
}

/**
 * Sign-up: does the chosen city use the existing area list (today's Gqeberha flow)?
 * Other cities skip it; their watches show after the account exists (D6).
 */
export function cityUsesSignupAreaList(chosenCityId, signupCityId) {
  return Boolean(chosenCityId) && Boolean(signupCityId) && String(chosenCityId) === String(signupCityId);
}

// ---------------------------------------------------------------------------
// SA places P4: Profile / Choose area
// ---------------------------------------------------------------------------

/** my_home_area payload -> { city, citySaved, watch, waiting, canChangeWatch }. Never carries counts. */
export function normalizeHomeArea(data) {
  const c = data?.city;
  const w = data?.watch;
  const city = c && str(c.id) && str(c.name)
    ? { id: str(c.id), name: str(c.name), province: str(c.province), provinceCode: str(c.province_code), nearLabel: str(c.near_label), formerly: "", alsoKnownAs: "" }
    : null;
  const watch = w && str(w.organization_id) && str(w.name)
    ? { id: str(w.organization_id), name: str(w.name), suburb: str(w.suburb), cityId: str(w.city_id), myRole: str(w.my_role) }
    : null;
  const waiting = Array.isArray(data?.waiting)
    ? data.waiting
        .map((x) => ({ id: str(x?.organization_id), name: str(x?.name), suburb: str(x?.suburb) }))
        .filter((x) => x.id && x.name)
    : [];
  return { city, citySaved: data?.city_saved === true, watch, waiting, canChangeWatch: data?.can_change_watch === true };
}

/** "Theescombe Neighbourhood Watch · Theescombe" (suburb left out when it repeats the name). */
export function homeWatchLine(watch) {
  if (!watch?.name) return "";
  const suburb = str(watch.suburb);
  if (!suburb || placeQueryKey(watch.name).includes(placeQueryKey(suburb))) return watch.name;
  return `${watch.name} · ${suburb}`;
}

/** True when the person's watch is in a different city from the one they say they live in. */
export function watchInOtherCity(area) {
  return Boolean(area?.watch?.cityId && area?.city?.id && area.watch.cityId !== area.city.id);
}

/** Confirm text before moving from one watch to another. */
export function switchConfirmText(fromWatch, toWatch) {
  const to = toWatch?.name || "this watch";
  if (!fromWatch?.name) return `Join ${to}?`;
  return `Move from ${fromWatch.name} to ${to}?\nYou'll leave ${fromWatch.name} and its groups straight away.`;
}

/** Friendly copy after switch_my_watch. */
export function switchResultCopy(result) {
  const name = str(result?.name) || "the watch";
  if (result?.status === "switched") {
    return { tone: "success", title: `You've moved to ${name}`, body: result?.from_name ? `You're no longer in ${result.from_name}.` : "" };
  }
  if (result?.status === "joined") return { tone: "success", title: `Welcome to ${name}`, body: "You're in. Your dashboard now shows this watch." };
  if (result?.status === "already_member") return { tone: "info", title: `You're already in ${name}`, body: "" };
  return null;
}

/** Friendly copy after set_my_home_city. */
export function cityChangeCopy(result, hasWatch) {
  if (result?.status !== "saved") return null;
  const city = str(result?.city) || "your city";
  if (result?.watch_in_other_city) {
    return { tone: "info", title: `Saved: you live in ${city}`, body: `Your watch is in another city. Pick a watch in ${city} below to move.` };
  }
  return { tone: "success", title: `Saved: you live in ${city}`, body: hasWatch ? "" : `Now pick your watch in ${city}.` };
}

/**
 * Staff "Choose an area": group areas under their city, filtered by typed text
 * (area or city name). Areas with no known city go last under "Other areas".
 */
export function groupAreasByCity(orgs, cityByOrg, filter = "") {
  const list = Array.isArray(orgs) ? orgs : [];
  const map = cityByOrg instanceof Map ? cityByOrg : new Map();
  const k = placeQueryKey(filter);
  const groups = new Map();
  for (const org of list) {
    if (!org?.id) continue;
    const city = map.get(org.id) || null;
    const cityName = city?.name || "";
    if (k && !placeQueryKey(`${org.name || ""} ${cityName}`).includes(k)) continue;
    const gk = city?.id || "";
    if (!groups.has(gk)) groups.set(gk, { cityId: gk, cityName: cityName || "Other areas", orgs: [] });
    groups.get(gk).orgs.push(org);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, orgs: [...g.orgs].sort((a, b) => placeQueryKey(a.name).localeCompare(placeQueryKey(b.name))) }))
    .sort((a, b) => (a.cityId ? 0 : 1) - (b.cityId ? 0 : 1) || placeQueryKey(a.cityName).localeCompare(placeQueryKey(b.cityName)));
}
