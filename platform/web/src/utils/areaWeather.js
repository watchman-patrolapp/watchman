import { SEARCH_BIAS } from "./nominatimLookup";
import { supabase } from "../supabase/client";
import { displayWatchAreaName, watchAreaCenterFromName } from "../config/neighborhoodRegions";

const WEATHER_TTL_MS = 20 * 60 * 1000;
const CITY_FALLBACK = { lat: -33.9608, lng: 25.6022 };

export function weatherLabel(code) {
  const n = Number(code);
  if (n === 0) return "Clear";
  if (n <= 3) return "Partly cloudy";
  if (n <= 48) return "Fog";
  if (n <= 57) return "Drizzle";
  if (n <= 67) return "Rain";
  if (n <= 77) return "Snow";
  if (n <= 82) return "Showers";
  if (n <= 99) return "Thunder";
  return "Local weather";
}

export function isFogCode(code) {
  const n = Number(code);
  return n === 45 || n === 48;
}

export function isRainCode(code) {
  const n = Number(code);
  return (n >= 51 && n <= 67) || (n >= 80 && n <= 82);
}

export function isStormCode(code) {
  const n = Number(code);
  return n >= 95 && n <= 99;
}

export function weatherKind(code, isDay = true) {
  const n = Number(code);
  if (n === 0) return isDay ? "clear" : "clear-night";
  if (n <= 3) return isDay ? "partly" : "partly-night";
  if (n <= 48) return "fog";
  if (n <= 82) return "rain";
  if (n <= 99) return "storm";
  return isDay ? "partly" : "partly-night";
}

function cacheKey(lat, lng) {
  return `nw-area-weather:${Number(lat).toFixed(3)}:${Number(lng).toFixed(3)}`;
}

function readCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.expiresAt || parsed.expiresAt < Date.now()) return null;
    return parsed.data || null;
  } catch {
    return null;
  }
}

function writeCache(key, data, ttlMs = WEATHER_TTL_MS) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ expiresAt: Date.now() + ttlMs, data }));
  } catch {
    /* ignore quota */
  }
}

const HOURLY_TTL_MS = 2 * 60 * 60 * 1000;

export function toJohannesburgHourKey(iso) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:00`;
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather unavailable");
  return res.json();
}

export function buildHourlyWeatherLookup(hourly) {
  const map = new Map();
  const times = hourly?.time || [];
  const temps = hourly?.temperature_2m || [];
  const codes = hourly?.weather_code || [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (!t) continue;
    map.set(t, {
      temperatureC: Number(temps[i]),
      code: codes[i],
    });
  }
  return {
    size: map.size,
    at(iso) {
      const key = toJohannesburgHourKey(iso);
      if (!key) return null;
      const row = map.get(key);
      if (!row || !Number.isFinite(row.temperatureC)) return null;
      return {
        ...row,
        hour: Number(key.slice(11, 13)),
        key,
      };
    },
  };
}

function ingestHourly(target, json, { overwrite = false } = {}) {
  const hourly = json?.hourly;
  if (!hourly?.time) return;
  const temps = hourly.temperature_2m || [];
  const codes = hourly.weather_code || [];
  for (let i = 0; i < hourly.time.length; i++) {
    const t = hourly.time[i];
    if (!t) continue;
    if (target.has(t) && !overwrite) continue;
    target.set(t, {
      temperatureC: Number(temps[i]),
      code: codes[i],
    });
  }
}

export async function fetchAreaHourlyWeather(organizationId, startYmd, endYmd, organizationName) {
  if (!startYmd || !endYmd || startYmd > endYmd) return buildHourlyWeatherLookup({ time: [] });

  const coords = await resolveAreaCoords(organizationId, organizationName);
  const key = `nw-area-weather-hourly:${Number(coords.lat).toFixed(3)}:${Number(coords.lng).toFixed(3)}:${startYmd}:${endYmd}`;
  const cached = readCache(key);
  if (cached) return buildHourlyWeatherLookup(cached);

  const today = toJohannesburgHourKey(new Date()).slice(0, 10);
  const archiveEnd = addDaysYmd(today, -2);
  const byTime = new Map();

  const archiveStop = endYmd < archiveEnd ? endYmd : archiveEnd;
  const wantArchive = startYmd <= archiveStop;
  const wantRecent = endYmd >= addDaysYmd(today, -8);

  const jobs = [];
  if (wantArchive) {
    const url = new URL("https://archive-api.open-meteo.com/v1/archive");
    url.searchParams.set("latitude", String(coords.lat));
    url.searchParams.set("longitude", String(coords.lng));
    url.searchParams.set("start_date", startYmd);
    url.searchParams.set("end_date", archiveStop);
    url.searchParams.set("hourly", "temperature_2m,weather_code");
    url.searchParams.set("timezone", "Africa/Johannesburg");
    jobs.push(
      fetchJson(url.toString())
        .then((json) => ingestHourly(byTime, json))
        .catch(() => null)
    );
  }
  if (wantRecent) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(coords.lat));
    url.searchParams.set("longitude", String(coords.lng));
    url.searchParams.set("hourly", "temperature_2m,weather_code");
    url.searchParams.set("past_days", "8");
    url.searchParams.set("forecast_days", "1");
    url.searchParams.set("timezone", "Africa/Johannesburg");
    jobs.push(
      fetchJson(url.toString())
        .then((json) => ingestHourly(byTime, json, { overwrite: true }))
        .catch(() => null)
    );
  }

  if (jobs.length) await Promise.all(jobs);

  const merged = { time: [], temperature_2m: [], weather_code: [] };
  for (const [t, row] of byTime) {
    const day = t.slice(0, 10);
    if (day < startYmd || day > endYmd) continue;
    merged.time.push(t);
    merged.temperature_2m.push(row.temperatureC);
    merged.weather_code.push(row.code);
  }

  if (merged.time.length) writeCache(key, merged, HOURLY_TTL_MS);
  return buildHourlyWeatherLookup(merged);
}

async function coordsFromSuburb(suburbId) {
  if (!suburbId) return null;
  const { data, error } = await supabase
    .from("suburbs")
    .select("center_lat, center_lng")
    .eq("id", suburbId)
    .maybeSingle();
  if (error || !Number.isFinite(data?.center_lat) || !Number.isFinite(data?.center_lng)) return null;
  return { lat: Number(data.center_lat), lng: Number(data.center_lng) };
}

async function coordsFromSuburbName(name) {
  const label = displayWatchAreaName(name);
  if (!label) return null;
  const { data, error } = await supabase
    .from("suburbs")
    .select("center_lat, center_lng")
    .ilike("name", label)
    .maybeSingle();
  if (error || !Number.isFinite(data?.center_lat) || !Number.isFinite(data?.center_lng)) {
    return watchAreaCenterFromName(label);
  }
  return { lat: Number(data.center_lat), lng: Number(data.center_lng) };
}

export async function resolveAreaCoords(organizationId, organizationName) {
  if (organizationId) {
    const { data: org } = await supabase
      .from("organizations")
      .select("name, primary_suburb_id")
      .eq("id", organizationId)
      .maybeSingle();
    const fromSuburb = await coordsFromSuburb(org?.primary_suburb_id);
    if (fromSuburb) return fromSuburb;
    const fromName = await coordsFromSuburbName(org?.name || organizationName);
    if (fromName) return fromName;
  } else {
    const fromName = await coordsFromSuburbName(organizationName);
    if (fromName) return fromName;
  }

  const { data: city } = await supabase
    .from("cities")
    .select("center_lat, center_lng")
    .ilike("name", "%gqeberha%")
    .limit(1)
    .maybeSingle();
  if (Number.isFinite(city?.center_lat) && Number.isFinite(city?.center_lng)) {
    return { lat: Number(city.center_lat), lng: Number(city.center_lng) };
  }

  return { lat: SEARCH_BIAS.lat || CITY_FALLBACK.lat, lng: SEARCH_BIAS.lng || CITY_FALLBACK.lng };
}

export async function fetchAreaWeather(organizationId, organizationName) {
  const coords = await resolveAreaCoords(organizationId, organizationName);
  const key = cacheKey(coords.lat, coords.lng);
  const cached = readCache(key);
  if (cached) return cached;

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(coords.lat));
  url.searchParams.set("longitude", String(coords.lng));
  url.searchParams.set("current", "temperature_2m,weather_code,is_day");
  url.searchParams.set("timezone", "Africa/Johannesburg");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Weather unavailable");
  const json = await res.json();
  const code = json?.current?.weather_code;
  const isDay = Boolean(json?.current?.is_day);
  const data = {
    temperatureC: Math.round(Number(json?.current?.temperature_2m)),
    code,
    isDay,
    label: weatherLabel(code),
    kind: weatherKind(code, isDay),
  };
  if (!Number.isFinite(data.temperatureC)) throw new Error("Weather unavailable");
  writeCache(key, data);
  return data;
}
