/**
 * Ballpark patrol fuel cost from vehicle class + GPS kilometres.
 * Neighbourhood stop-start uses more than a highway combined cycle — we apply a
 * modest patrol factor. Figures are typical SA mixed-urban values, not a lab test.
 */

import {
  getVehicleTypePublicLabel,
  isLightMobilityVehicleType,
  normalizeVehicleTypeKey,
} from "./vehicleTypeConstants.js";
import { summarizeGpsMileage } from "./patrolHistoryRoute.js";

export const DEFAULT_PETROL_ZAR_PER_LITRE = 22.5;
export const PETROL_PRICE_MIN = 16;
export const PETROL_PRICE_MAX = 32;
export const PATROL_CONSUMPTION_FACTOR = 1.18;
/** Prefer GPS as soon as a real neighbourhood loop is on the track. */
export const MIN_GPS_KM = 0.3;

const ZERO_FUEL_TYPES = new Set([
  "on_foot",
  "bicycle",
  "golf_cart",
  "segway",
  "electric_scooter",
  "drone",
  "horse",
]);

/**
 * Combined-cycle L/100km, then multiplied by PATROL_CONSUMPTION_FACTOR in resolve.
 * More specific keyword lists first.
 */
const FUEL_CLASSES = [
  {
    id: "hybrid",
    label: "hybrid",
    lPer100: 5.4,
    keywords: ["hybrid", "prius", "corolla cross hybrid", "rav4 hybrid"],
  },
  {
    id: "motorcycle",
    label: "motorcycle",
    lPer100: 4.5,
    types: ["motorcycle"],
    keywords: ["motorcycle", "motorbike", "scooter", "cb500", "ninja", "africa twin"],
  },
  {
    id: "small-hatch",
    label: "small hatchback",
    lPer100: 6.5,
    keywords: [
      "polo", "fiesta", "yaris", "i20", "i10", "picanto", "spark", "sandero",
      "corsa", "swift", "jazz", "aygo", "vw up", "up!", "atos", "figo", "kwid",
      "ignis", "baleno", "starlet",
    ],
  },
  {
    id: "compact",
    label: "compact sedan / hatch",
    lPer100: 7.3,
    keywords: [
      "corolla", "civic", "cerato", "elantra", "jetta", "golf", "auris",
      "sentra", "almera", "ballade", "focus", "mazda3", "mazda 3", "i30",
      "leon", "octavia", "astra", "308", "megane", "rio",
    ],
  },
  {
    id: "family",
    label: "family sedan",
    lPer100: 8.5,
    keywords: ["camry", "accord", "passat", "sonata", "superb", "mondeo", "magentis"],
  },
  {
    id: "crossover",
    label: "compact SUV / crossover",
    lPer100: 8.9,
    keywords: [
      "rav4", "rav 4", "sportage", "tucson", "x-trail", "xtrail", "qashqai",
      "tiguan", "kuga", "cx-5", "cx5", "cx-3", "vitara", "creta", "seltos",
      "venue", "duster", "captur", "hr-v", "hrv", "c-hr", "chr", "korando",
      "jimny", "renegade", "ecosport", "eco sport", "grand i10",
    ],
  },
  {
    id: "suv",
    label: "SUV",
    lPer100: 11.4,
    keywords: [
      "fortuner", "pajero", "prado", "land cruiser", "landcruiser", "patrol",
      "everest", "mu-x", "mux", "trailblazer", "discovery", "defender",
      "wrangler", "range rover", "rangerover", "touareg", "cayenne", "x5",
      "q7", "sorento", "santa fe", "santafe", "palisade", "highlander",
    ],
  },
  {
    id: "bakkie-4x4",
    label: "double-cab 4x4",
    lPer100: 12.0,
    keywords: ["4x4", "4wd", "double cab 4", "dc 4x4", "d/c 4x4"],
  },
  {
    id: "bakkie",
    label: "bakkie / pickup",
    lPer100: 10.4,
    types: ["truck"],
    keywords: [
      "hilux", "ranger", "amarok", "triton", "navara", "bt-50", "bt50",
      "bakkie", "ldv", "saveiro", "np300", "d-max", "dmax", "canyon",
      "single cab", "double cab", "extra cab", "pickup", "bakkie",
    ],
  },
  {
    id: "van",
    label: "van / minibus",
    lPer100: 11.2,
    types: ["bus"],
    keywords: [
      "quantum", "hiace", "kombi", "transporter", "staria", "h1", "minibus",
      "sprinter", "crafter", "kangoo", "caddy", "town ace", "townace",
    ],
  },
  {
    id: "emergency",
    label: "emergency vehicle",
    lPer100: 12.5,
    types: ["emergency"],
    keywords: ["ambulance", "fire engine"],
  },
  {
    id: "car-default",
    label: "average passenger car",
    lPer100: 8.3,
    fallback: true,
  },
];

function round1(n) {
  return Math.round(n * 10) / 10;
}

function hasKeyword(text, keyword) {
  const escaped = String(keyword)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

export function resolveFuelProfile(vehicleType, makeModel) {
  const type = normalizeVehicleTypeKey(vehicleType);
  if (isLightMobilityVehicleType(type) || ZERO_FUEL_TYPES.has(type)) {
    return {
      kind: "none",
      id: type || "none",
      label: getVehicleTypePublicLabel(type || "on_foot"),
      lPer100: 0,
      lPer100Patrol: 0,
    };
  }
  if (type === "boat") {
    return {
      kind: "unsupported",
      id: "boat",
      label: "Boat",
      lPer100: 0,
      lPer100Patrol: 0,
    };
  }

  const text = `${makeModel || ""} ${type || ""}`.toLowerCase().replace(/[_-]+/g, " ");
  for (const cls of FUEL_CLASSES) {
    if (cls.fallback) continue;
    if (cls.types?.includes(type)) {
      return withPatrolBurn(cls);
    }
    const keys = [...(cls.keywords || [])].sort((a, b) => b.length - a.length);
    if (keys.some((k) => hasKeyword(text, k))) return withPatrolBurn(cls);
  }
  const fallback = FUEL_CLASSES.find((c) => c.fallback) || FUEL_CLASSES[FUEL_CLASSES.length - 1];
  return withPatrolBurn(fallback);
}

function withPatrolBurn(cls) {
  return {
    kind: "fuel",
    id: cls.id,
    label: cls.label,
    lPer100: cls.lPer100,
    lPer100Patrol: round1(cls.lPer100 * PATROL_CONSUMPTION_FACTOR),
  };
}

export function formatApproxRand(amount) {
  if (!Number.isFinite(amount) || amount < 0.5) return "R0";
  const rounded = amount < 80 ? Math.round(amount) : Math.round(amount / 10) * 10;
  return `~R${rounded.toLocaleString("en-ZA")}`;
}

export function formatLitres(litres) {
  if (!Number.isFinite(litres) || litres <= 0) return "0 L";
  if (litres < 10) return `~${round1(litres)} L`;
  return `~${Math.round(litres)} L`;
}

export function clampPetrolPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PETROL_ZAR_PER_LITRE;
  return Math.min(PETROL_PRICE_MAX, Math.max(PETROL_PRICE_MIN, Math.round(n * 10) / 10));
}

export const MANUAL_KM_MAX = 50000;
export const MANUAL_L_PER_100_MIN = 1;
export const MANUAL_L_PER_100_MAX = 30;

/**
 * User-typed calculator: km × L/100 km × R/L.
 */
export function estimateManualFuel(input = {}) {
  const km = Math.min(MANUAL_KM_MAX, Math.max(0, Number(input.km) || 0));
  const lPer100 = Math.min(
    MANUAL_L_PER_100_MAX,
    Math.max(0, Number(input.lPer100) || 0)
  );
  const rawPrice = Number(input.priceZarPerLitre);
  const price = Number.isFinite(rawPrice) && rawPrice > 0
    ? Math.min(40, Math.max(10, Math.round(rawPrice * 10) / 10))
    : DEFAULT_PETROL_ZAR_PER_LITRE;
  const litres = km > 0 && lPer100 > 0 ? (km / 100) * lPer100 : 0;
  return {
    km,
    lPer100,
    litres,
    rand: litres * price,
    priceZarPerLitre: price,
  };
}

/**
 * @param {{
 *   vehicleType?: string,
 *   makeModel?: string,
 *   gpsKm?: number,
 *   totalMinutes?: number,
 *   totalPatrols?: number,
 *   routeCount?: number,
 *   priceZarPerLitre?: number,
 * }} input
 */
export function estimatePatrolFuel(input = {}) {
  const profile = resolveFuelProfile(input.vehicleType, input.makeModel || input.carType);
  const price = clampPetrolPrice(input.priceZarPerLitre ?? DEFAULT_PETROL_ZAR_PER_LITRE);
  const gpsKm = Math.max(0, Number(input.gpsKm) || 0);
  const routeCount = Number(input.routeCount) || 0;
  const totalPatrols = Number(input.totalPatrols) || 0;
  const displayName = String(input.makeModel || input.carType || "").trim();

  if (profile.kind !== "fuel") {
    return {
      kind: profile.kind,
      profile,
      displayName: displayName || profile.label,
      priceZarPerLitre: price,
      km: 0,
      kmSource: "none",
      litres: 0,
      rand: 0,
      gpsKm,
      routeCount,
      totalPatrols,
    };
  }

  const usedGps = gpsKm >= MIN_GPS_KM;
  const km = usedGps ? gpsKm : 0;
  const litres = km > 0 ? (km / 100) * profile.lPer100Patrol : 0;
  const rand = litres * price;

  return {
    kind: "fuel",
    profile,
    displayName: displayName || profile.label,
    priceZarPerLitre: price,
    km,
    kmSource: usedGps ? "gps" : "none",
    gpsKm,
    litres,
    rand,
    routeCount,
    totalPatrols,
    untracked: usedGps && totalPatrols > routeCount,
  };
}

export function volunteerVehicleFromRow(row, fallbackCarType) {
  if (!row && !fallbackCarType) return null;
  return {
    vehicleType: row?.vehicleType || row?.vehicle_type || "car",
    makeModel: row?.makeModel || row?.make_model || fallbackCarType || "",
    carType: row?.carType || row?.car_type || fallbackCarType || "",
  };
}

export function mergeFuelVehicles({ userRows = [], rpcRows = [], selfUser = null } = {}) {
  const map = {};
  for (const u of userRows) {
    if (!u?.id) continue;
    if (u.car_type) map[u.id] = volunteerVehicleFromRow(null, u.car_type);
  }
  for (const r of rpcRows) {
    if (!r?.user_id) continue;
    map[r.user_id] = volunteerVehicleFromRow(r, r.car_type || map[r.user_id]?.carType);
  }
  if (selfUser?.id) {
    const primary = selfUser.vehicles?.find((v) => v.is_primary) || selfUser.vehicles?.[0];
    if (primary) {
      map[selfUser.id] = volunteerVehicleFromRow(primary, selfUser.carType);
    } else if (selfUser.carType) {
      map[selfUser.id] = volunteerVehicleFromRow(null, selfUser.carType);
    }
  }
  return map;
}

export function fuelDistanceNote(estimate, periodLabel = "all time") {
  if (!estimate || estimate.kind !== "fuel" || estimate.kmSource !== "gps") return "";
  const when = String(periodLabel || "all time");
  const whenLower = when.toLowerCase();
  const tracks = estimate.routeCount || 0;
  const extra = estimate.untracked
    ? " Older patrols without a saved GPS track are not in this total."
    : "";
  return `Derived from GPS data — ${Math.round(estimate.gpsKm).toLocaleString("en-ZA")} km driven on patrol ${whenLower === "all time" ? "(all time)" : whenLower} from ${tracks} GPS track${tracks === 1 ? "" : "s"}. Same source as Patrol routes.${extra}`;
}

export { summarizeGpsMileage };
