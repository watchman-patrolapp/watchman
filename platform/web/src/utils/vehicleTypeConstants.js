/**
 * Canonical vehicle_type values stored in user_vehicles / profiles / active_patrols.
 * Light mobility: same UX as on foot (no make/reg/colour form fields); distinct types for icons and labels.
 */

export const LIGHT_MOBILITY_TYPES = [
  'on_foot',
  'golf_cart',
  'segway',
  'electric_scooter',
  'drone',
  'horse',
];

/** Default make_model / patrol display line for light-mobility types */
export const LIGHT_MOBILITY_DEFAULT_MODEL = {
  on_foot: 'On foot',
  golf_cart: 'Golf cart',
  segway: 'Segway',
  electric_scooter: 'Electric scooter',
  drone: 'Drone - Aerial Surveillance',
  horse: 'Horse',
};

export const CANONICAL_VEHICLE_TYPES = [
  'car',
  'bicycle',
  'motorcycle',
  'boat',
  ...LIGHT_MOBILITY_TYPES,
  'truck',
  'bus',
  'emergency',
];

export function normalizeVehicleTypeKey(type) {
  if (type == null) return '';
  return String(type).trim().toLowerCase().replace(/-/g, '_').replace(/\s+/g, '_');
}

export function isLightMobilityVehicleType(type) {
  return LIGHT_MOBILITY_TYPES.includes(normalizeVehicleTypeKey(type));
}

export function getLightMobilityDefaultModel(type) {
  const t = normalizeVehicleTypeKey(type);
  return LIGHT_MOBILITY_DEFAULT_MODEL[t] ?? 'On foot';
}

export function getVehicleTypePublicLabel(normalizedType) {
  const t = normalizeVehicleTypeKey(normalizedType);
  if (LIGHT_MOBILITY_DEFAULT_MODEL[t]) return LIGHT_MOBILITY_DEFAULT_MODEL[t];
  const labels = {
    car: 'Car',
    bicycle: 'Bicycle',
    motorcycle: 'Motorcycle',
    boat: 'Boat',
    truck: 'Truck',
    bus: 'Bus',
    emergency: 'Emergency vehicle',
  };
  return labels[t] || t.replace(/_/g, ' ');
}

export function isCanonicalVehicleType(value) {
  return CANONICAL_VEHICLE_TYPES.includes(normalizeVehicleTypeKey(value));
}

/**
 * Ordered options for add-vehicle UI and registration (value + labels).
 * Icons live in the Vehicles page — map by `value` there.
 * Optional `shortLabel` for tight grids (e.g. drone).
 */
export const VEHICLE_FORM_OPTIONS = [
  { value: 'car', label: 'Car' },
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'boat', label: 'Boat' },
  { value: 'bicycle', label: 'Bicycle' },
  { value: 'on_foot', label: 'On Foot' },
  { value: 'golf_cart', label: 'Golf Cart' },
  { value: 'segway', label: 'Segway' },
  { value: 'electric_scooter', label: 'Electric Scooter' },
  { value: 'drone', label: 'Drone — Aerial Surveillance', shortLabel: 'Drone' },
  { value: 'horse', label: 'Horse' },
];

/** Registration dropdown: value + label only (derived — do not duplicate). */
export const REGISTER_VEHICLE_TYPE_OPTIONS = VEHICLE_FORM_OPTIONS.map(({ value, label }) => ({
  value,
  label,
}));

/** Map markers / popups — single emoji per normalized type */
export function mapVehicleTypeToEmoji(normalizedType) {
  const t = normalizeVehicleTypeKey(normalizedType);
  const m = {
    on_foot: '🚶',
    golf_cart: '🛺',
    segway: '🛴',
    electric_scooter: '🛵',
    drone: '🚁',
    horse: '🐴',
    bicycle: '🚲',
    motorcycle: '🏍️',
    boat: '⛵',
    car: '🚗',
    truck: '🚚',
    bus: '🚌',
    emergency: '🚑',
  };
  return m[t] || '🚗';
}
