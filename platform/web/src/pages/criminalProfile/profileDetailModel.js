import {
  sanitizeSightingsLogForDb,
  syncLegacyLastSeenFromSightings,
} from '../../utils/criminalProfileSightings.js';

/** Columns the profile editor is allowed to write back. */
export const PROFILE_UPDATE_FIELDS = [
  'primary_name', 'date_of_birth', 'place_of_birth', 'nationality', 'gender',
  'height_cm', 'weight_kg', 'build_type', 'eye_color', 'hair_color', 'complexion',
  'distinguishing_marks', 'photo_urls', 'risk_level', 'status', 'priority',
  'watchlist_flags', 'mo_signature', 'known_aliases', 'id_numbers',
  'first_identified_at',
  'common_presence', 'residence_last_known',
  'gang_affiliation', 'criminal_organization',
  'conviction_history_summary', 'criminal_justice_status',
];

export const ASSOCIATE_RELATIONSHIP_OPTIONS = [
  { value: 'associate', label: 'Associate (general)' },
  { value: 'friend', label: 'Friend' },
  { value: 'romantic_partner', label: 'Romantic partner' },
  { value: 'family_parent', label: 'Family — parent' },
  { value: 'family_child', label: 'Family — child' },
  { value: 'family_sibling', label: 'Family — sibling' },
  { value: 'family_spouse', label: 'Family — spouse' },
  { value: 'gang_member', label: 'Gang — member' },
  { value: 'gang_leader', label: 'Gang — leader' },
  { value: 'gang_recruit', label: 'Gang — recruit' },
  { value: 'accomplice', label: 'Accomplice' },
  { value: 'coordinator', label: 'Coordinator' },
  { value: 'lookout', label: 'Lookout' },
  { value: 'driver', label: 'Driver' },
  { value: 'employer', label: 'Employer' },
  { value: 'employee', label: 'Employee' },
  { value: 'client', label: 'Client' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'neighbor', label: 'Neighbor' },
  { value: 'cellmate', label: 'Cellmate' },
  { value: 'unknown', label: 'Unknown' },
];

export function getRiskColor(level) {
  switch (level?.toLowerCase()) {
    case 'critical': return 'bg-red-600 text-white';
    case 'high': return 'bg-orange-500 text-white';
    case 'medium': return 'bg-yellow-500 text-black';
    case 'low': return 'bg-green-500 text-white';
    default: return 'bg-gray-500 text-white';
  }
}

export function getPriorityColor(priority) {
  switch (priority?.toLowerCase()) {
    case 'immediate': return 'bg-red-700 text-white';
    case 'urgent': return 'bg-red-500 text-white';
    case 'priority': return 'bg-orange-500 text-white';
    case 'routine': return 'bg-blue-500 text-white';
    default: return 'bg-gray-500 text-white';
  }
}

export function getStatusColor(status) {
  switch (status?.toLowerCase()) {
    case 'active': return 'bg-green-500 text-white';
    case 'wanted': return 'bg-red-600 text-white';
    case 'incarcerated': return 'bg-gray-700 text-white';
    case 'deceased': return 'bg-black text-white';
    case 'cleared':
    case 'inactive': return 'bg-gray-500 text-white';
    default: return 'bg-gray-500 text-white';
  }
}

/**
 * Whitelisted column copy of the edit form, plus sightings and the legacy
 * last-seen mirror. `inactive` is stored as `cleared`.
 */
export function buildProfileUpdatePayload(editForm) {
  const updateData = {};
  for (const key of PROFILE_UPDATE_FIELDS) {
    if (!(key in editForm)) continue;
    let val = editForm[key];
    if (key === 'status' && val === 'inactive') val = 'cleared';
    updateData[key] = val;
  }

  const sanitizedSightings = sanitizeSightingsLogForDb(editForm.sightings_log ?? []);
  updateData.sightings_log = sanitizedSightings;
  Object.assign(updateData, syncLegacyLastSeenFromSightings(sanitizedSightings));
  return updateData;
}

export function profileDeleteErrorHint(message) {
  const msg = message || '';
  if (msg.includes('violates foreign key') || msg.includes('23503')) {
    return ' Remove or unlink related records first, or run migrations that set ON DELETE SET NULL on match-queue references.';
  }
  return '';
}

export function excludeAlreadyLinkedProfiles(rows, associatesDraft) {
  const linked = new Set(
    (associatesDraft || []).map((r) => r.other_profile_id || r.associate_profile_id)
  );
  return (rows || []).filter((p) => !linked.has(p.id));
}

/** Title shown on a linked-incident row. */
export function linkedIncidentHeading(incident) {
  const t = incident?.type?.trim();
  if (t) return t;
  const d = incident?.description?.trim();
  if (d) return `${d.slice(0, 72)}${d.length > 72 ? '…' : ''}`;
  return 'Incident';
}
