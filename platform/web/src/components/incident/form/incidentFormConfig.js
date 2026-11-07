import { FaCamera, FaCar, FaTools, FaFileAlt, FaEye, FaUserSecret } from "react-icons/fa";
import { normalizeMediaUrls } from "../../evidence/StructuredEvidenceList";
import { watchDayStamp, parsePatrolTime } from "../../../utils/watchTime";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const INCIDENT_TYPES = [
  "Suspicious Activity",
  "Theft",
  "Vandalism",
  "Noise Complaint",
  "Suspicious Vehicle",
  "Other"
];

export const INCIDENT_DRAFT_STORAGE_KEY = "nwp_incident_report_draft_v1";

export const EMPTY_EVIDENCE = () => ({
  scene_photos: [],
  suspects: [],
  vehicles: [],
  physical_evidence: [],
  documentation: [],
  contextual_intel: [],
});

export function incidentDateInputValue(raw) {
  if (!raw) return watchDayStamp();
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = parsePatrolTime(s);
  return d ? watchDayStamp(d) : watchDayStamp();
}

/** Rebuild form evidence state from incident_evidence rows (admin edit / hydration). */
export function mapDbEvidenceToFormState(rows) {
  const next = EMPTY_EVIDENCE();
  if (!rows?.length) return next;

  const idSeen = new Set();
  const candidates = [];
  for (const row of rows) {
    if (!row) continue;
    if (row.id != null) {
      if (idSeen.has(row.id)) continue;
      idSeen.add(row.id);
    }
    const cat = row.category;
    if (!Object.prototype.hasOwnProperty.call(next, cat)) continue;
    candidates.push(row);
  }

  const logical = new Map();
  for (const row of candidates) {
    const cat = row.category;
    const fid = row.metadata?._formEntryId;
    const key =
      fid != null && String(fid).length > 0
        ? `${cat}::${String(fid)}`
        : row.id != null
          ? `id::${row.id}`
          : null;
    if (key == null) continue;
    const prev = logical.get(key);
    if (!prev) {
      logical.set(key, row);
      continue;
    }
    const tRow = parsePatrolTime(row.created_at)?.getTime() || 0;
    const tPrev = parsePatrolTime(prev.created_at)?.getTime() || 0;
    const primary = tRow >= tPrev ? row : prev;
    const secondary = tRow >= tPrev ? prev : row;
    const mergedUrls = [
      ...new Set([
        ...normalizeMediaUrls(primary.media_urls),
        ...normalizeMediaUrls(secondary.media_urls),
      ]),
    ];
    logical.set(key, {
      ...primary,
      media_urls: mergedUrls.length > 0 ? mergedUrls : primary.media_urls,
      description:
        primary.description?.trim() || secondary.description?.trim() || '',
    });
  }

  const collapsed = [...logical.values()].sort(
    (a, b) => (parsePatrolTime(a.created_at)?.getTime() || 0) - (parsePatrolTime(b.created_at)?.getTime() || 0)
  );

  for (const row of collapsed) {
    const cat = row.category;
    const meta = { ...(row.metadata || {}) };
    delete meta._formEntryId;
    const formId = row.metadata?._formEntryId || `db_${row.id}`;
    const linked_profile_id = meta.linked_profile_id || null;
    const linked_profile_name = meta.linked_profile_name || null;
    const linked_profile_risk = meta.linked_profile_risk || null;
    const linked_connection_type = meta.linked_connection_type || null;
    const linked_confidence_score =
      meta.linked_confidence_score != null && meta.linked_confidence_score !== ''
        ? Math.max(1, Math.min(100, Number(meta.linked_confidence_score)))
        : null;
    if (cat === 'suspects') {
      delete meta.linked_profile_id;
      delete meta.linked_profile_name;
      delete meta.linked_profile_risk;
      delete meta.linked_connection_type;
      delete meta.linked_confidence_score;
    }
    next[cat].push({
      id: formId,
      category: cat,
      description: row.description || "",
      metadata: meta,
      files: [],
      media_urls: normalizeMediaUrls(row.media_urls),
      ...(cat === 'suspects' && linked_profile_id
        ? {
            linked_profile_id,
            linked_profile_name,
            linked_profile_risk,
            ...(linked_connection_type ? { linked_connection_type } : {}),
            ...(linked_confidence_score != null && Number.isFinite(linked_confidence_score)
              ? { linked_confidence_score }
              : {}),
          }
        : {}),
    });
  }
  return next;
}

/** Serializable evidence (File objects cannot be stored). */
export function evidenceForStorage(evidence) {
  const out = {};
  for (const key of Object.keys(evidence)) {
    out[key] = (evidence[key] || []).map((entry) => ({
      ...entry,
      files: [],
    }));
  }
  return out;
}

export const EVIDENCE_CATEGORIES = [
  {id: 'scene_photos', label: 'Scene Evidence', description: 'General photos of incident location, damage, or environment', icon: FaCamera, allowMultipleEntries: false},
  {id: 'suspects', label: 'Suspect Profiles', description: 'Photos and descriptions of identified or suspicious persons', icon: FaUserSecret, allowMultipleEntries: true},
  {id: 'vehicles', label: 'Vehicle Evidence', description: 'Suspicious vehicles, license plates, or vehicle damage', icon: FaCar, allowMultipleEntries: true},
  {id: 'physical_evidence', label: 'Physical Evidence', description: 'Tools, footprints, damage, stolen items left behind', icon: FaTools, allowMultipleEntries: false},
  {id: 'documentation', label: 'Documentation', description: 'SAPS forms, insurance docs, receipts, serial numbers', icon: FaFileAlt, allowMultipleEntries: false},
  {id: 'contextual_intel', label: 'Contextual Intelligence', description: 'Suspicious activity nearby (e.g., 2am walkers near cable theft)', icon: FaEye, allowMultipleEntries: true}
];

export const INITIAL_FORM = {
  incidentDate: watchDayStamp(),
  location: "",
  type: "",
  description: "",
  suspectName: "",
  suspectDescription: "",
  vehicleInfo: "",
  sapsCaseNumber: "",
  witnessPresent: false,
  witnessName: "",
  witnessUserId: null,
  witnessAvatarUrl: null,
};
