export const HOTSPOT_KINDS = [
  {
    id: 'break_in',
    group: 'break_in',
    label: 'Confirmed break-in',
    shortLabel: 'Break-in',
    toneClass: 'text-red-600 dark:text-red-400',
    markerClass: 'hotspot-marker--break',
  },
  {
    id: 'attempted_break_in',
    group: 'break_in',
    label: 'Attempted break-in',
    shortLabel: 'Break-in attempt',
    toneClass: 'text-amber-600 dark:text-amber-400',
    markerClass: 'hotspot-marker--attempt',
  },
  {
    id: 'cable_theft',
    group: 'cable',
    label: 'Confirmed cable / infrastructure theft',
    shortLabel: 'Cable theft',
    toneClass: 'text-orange-700 dark:text-orange-400',
    markerClass: 'hotspot-marker--cable',
  },
  {
    id: 'attempted_cable_theft',
    group: 'cable',
    label: 'Attempted cable / infrastructure theft',
    shortLabel: 'Cable attempt',
    toneClass: 'text-amber-700 dark:text-amber-300',
    markerClass: 'hotspot-marker--cable-attempt',
  },
];

const BY_ID = Object.fromEntries(HOTSPOT_KINDS.map((k) => [k.id, k]));

export function hotspotKindMeta(kind) {
  return BY_ID[kind] || BY_ID.break_in;
}

export function hotspotKindLabel(kind, { short = false } = {}) {
  const meta = hotspotKindMeta(kind);
  return short ? meta.shortLabel : meta.label;
}

export function isAttemptedHotspotKind(kind) {
  return kind === 'attempted_break_in' || kind === 'attempted_cable_theft';
}

export function isCableHotspotKind(kind) {
  return kind === 'cable_theft' || kind === 'attempted_cable_theft';
}
