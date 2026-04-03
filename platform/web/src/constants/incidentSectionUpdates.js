/** Must match components/evidence/StructuredEvidenceList.jsx (avoid circular imports). */
const EVIDENCE_CATEGORY_ORDER = [
  'scene_photos',
  'suspects',
  'vehicles',
  'physical_evidence',
  'documentation',
  'contextual_intel',
];

const EVIDENCE_CATEGORY_LABELS = {
  scene_photos: 'Scene evidence',
  suspects: 'Suspect profiles',
  vehicles: 'Vehicle evidence',
  physical_evidence: 'Physical evidence',
  documentation: 'Documentation',
  contextual_intel: 'Contextual intelligence',
};

export { EVIDENCE_CATEGORY_ORDER };

/** DB CHECK + app keys for public.incident_section_updates.section_key */
export const INCIDENT_SECTION_KEYS = {
  INCIDENT_DATE: 'incident_date',
  LOCATION: 'location',
  TYPE: 'type',
  DESCRIPTION: 'description',
  SUSPECT: 'suspect',
  VEHICLE: 'vehicle',
  WITNESS: 'witness',
  SAPS_CASE: 'saps_case',
  REPORTING_MEMBER: 'reporting_member',
};

/** @param {string} categoryId e.g. scene_photos, suspects */
export function evidenceCategoryToSectionKey(categoryId) {
  return `evidence_${categoryId}`;
}

export const INCIDENT_SECTION_LABELS = {
  [INCIDENT_SECTION_KEYS.INCIDENT_DATE]: 'Date of incident',
  [INCIDENT_SECTION_KEYS.LOCATION]: 'Location',
  [INCIDENT_SECTION_KEYS.TYPE]: 'Incident type',
  [INCIDENT_SECTION_KEYS.DESCRIPTION]: 'Description',
  [INCIDENT_SECTION_KEYS.SUSPECT]: 'Suspect information',
  [INCIDENT_SECTION_KEYS.VEHICLE]: 'Vehicle information',
  [INCIDENT_SECTION_KEYS.WITNESS]: 'Witness',
  [INCIDENT_SECTION_KEYS.SAPS_CASE]: 'SAPS case number',
  [INCIDENT_SECTION_KEYS.REPORTING_MEMBER]: 'Reporting patrol / member',
};

for (const id of EVIDENCE_CATEGORY_ORDER) {
  INCIDENT_SECTION_LABELS[evidenceCategoryToSectionKey(id)] = EVIDENCE_CATEGORY_LABELS[id];
}

/**
 * Every `section_key` the app may insert or display. Must match Postgres
 * CHECK (section_key IN (...)) on public.incident_section_updates — see
 * supabase/sql/incident_section_updates_constraints.sql and migrations
 * 20260329230000 / 20260329250000.
 *
 * - Details tab: incident_date … reporting_member (narrative form).
 * - Evidence: evidence_{category} for each EVIDENCE_CATEGORY_ORDER slug.
 * - Legacy DB rows may still use `evidence` until migrated to evidence_scene_photos.
 */
export const ALLOWED_INCIDENT_SECTION_KEYS = [
  ...Object.values(INCIDENT_SECTION_KEYS),
  'evidence',
  ...EVIDENCE_CATEGORY_ORDER.map(evidenceCategoryToSectionKey),
];

/** Stable order for print/PDF “Official section updates” */
export const INCIDENT_SECTION_PRINT_ORDER = [
  'incident_date',
  'location',
  'type',
  'description',
  'suspect',
  'vehicle',
  'witness',
  'saps_case',
  'reporting_member',
  ...EVIDENCE_CATEGORY_ORDER.map(evidenceCategoryToSectionKey),
];

export function formatSectionRoleLabel(role) {
  const r = String(role ?? '').trim().toLowerCase();
  if (!r) return 'Member';
  const map = {
    admin: 'Admin',
    committee: 'Committee',
    technical_support: 'Technical support',
    patroller: 'Patroller',
    investigator: 'Investigator',
    volunteer: 'Volunteer',
  };
  return map[r] || r.charAt(0).toUpperCase() + r.slice(1);
}

export function canAddIncidentSectionUpdates(role) {
  const r = String(role ?? '').trim().toLowerCase();
  return ['admin', 'committee', 'technical_support', 'patroller', 'investigator'].includes(r);
}

/** @param {Array<{ section_key: string }>} rows */
export function groupIncidentSectionUpdatesByKey(rows) {
  /** @type {Record<string, typeof rows>} */
  const out = {};
  if (!rows?.length) return out;
  for (const row of rows) {
    const k = row.section_key;
    if (!k) continue;
    if (!out[k]) out[k] = [];
    out[k].push(row);
  }
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }
  return out;
}
