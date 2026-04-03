import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { FaPlus } from 'react-icons/fa';
import PatrollerPhotoPreview from '../patrol/PatrollerPhotoPreview';
import IncidentUpdateCard from '../incident/IncidentUpdateCard';
import {
  evidenceCategoryToSectionKey,
  INCIDENT_SECTION_LABELS,
} from '../../constants/incidentSectionUpdates';
import { connectionTypeLabel } from '../../data/profileIncidentLinkTaxonomy';

export const EVIDENCE_CATEGORY_LABELS = {
  scene_photos: 'Scene evidence',
  suspects: 'Suspect profiles',
  vehicles: 'Vehicle evidence',
  physical_evidence: 'Physical evidence',
  documentation: 'Documentation',
  contextual_intel: 'Contextual intelligence',
};

/** Same order as the incident report form — avoids chronological interleaving (e.g. scene cards between contextual entries). */
export const EVIDENCE_CATEGORY_ORDER = [
  'scene_photos',
  'suspects',
  'vehicles',
  'physical_evidence',
  'documentation',
  'contextual_intel',
];

function categoryDisplayOrder(category) {
  const i = EVIDENCE_CATEGORY_ORDER.indexOf(category);
  return i === -1 ? EVIDENCE_CATEGORY_ORDER.length : i;
}

const METADATA_LABELS = {
  age: 'Approx. age',
  clothing: 'Clothing description',
  direction: 'Direction of travel',
  timeObserved: 'Time observed',
  licensePlate: 'License plate',
  vehicleDetails: 'Make / model / color',
  potentiallyRelated: 'Potentially related to incident',
  location: 'Location observed',
};

export function normalizeMediaUrls(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.filter(Boolean) : raw ? [raw] : [];
    } catch {
      return raw ? [raw] : [];
    }
  }
  return [];
}

function normalizeMetadata(raw) {
  if (!raw || typeof raw !== 'object') return {};
  if (Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(([key]) => !String(key).startsWith('_'))
  );
}

function extractSuspectLinkMeta(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return { cleanMetadata: metadata || {}, linkMeta: null };
  }
  const linkMeta = {
    linkedProfileId: metadata.linked_profile_id || null,
    linkedProfileName: metadata.linked_profile_name || null,
    linkedProfileRisk: metadata.linked_profile_risk || null,
    linkedConnectionType: metadata.linked_connection_type || null,
    linkedConfidenceScore:
      metadata.linked_confidence_score != null && metadata.linked_confidence_score !== ''
        ? Number(metadata.linked_confidence_score)
        : null,
  };
  const cleanMetadata = { ...metadata };
  delete cleanMetadata.linked_profile_id;
  delete cleanMetadata.linked_profile_name;
  delete cleanMetadata.linked_profile_risk;
  delete cleanMetadata.linked_connection_type;
  delete cleanMetadata.linked_confidence_score;
  return {
    cleanMetadata,
    linkMeta: linkMeta.linkedProfileId ? linkMeta : null,
  };
}

function formatMetadataDisplayValue(value) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Older migrations stored this line; hide it in the UI so end users only see real narrative. */
function shouldShowEvidenceDescription(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return false;
  return t !== 'Migrated from legacy incident photo roll-up.';
}

/** Drop duplicate incident_evidence rows if the same id appears twice in the array. */
function dedupeEvidenceRowsById(rows) {
  const list = rows || [];
  const seen = new Set();
  const out = [];
  for (const row of list) {
    if (!row) continue;
    if (row.id != null) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
    }
    out.push(row);
  }
  return out;
}

/**
 * Same form entry can be inserted twice (double submit / re-save), producing two DB rows with the same
 * metadata._formEntryId. Collapse to one row (latest created_at) for display and stable React keys.
 */
/** Rows synthesized from `incident_suspects` when no matching `incident_evidence` exists — not real UUIDs. */
export function isSyntheticSuspectEvidenceRow(item) {
  return Boolean(item && String(item.id ?? '').startsWith('__incident_suspect__'));
}

function dedupeEvidenceRowsByLogicalEntry(rows) {
  const list = dedupeEvidenceRowsById(rows);
  const map = new Map();
  for (const row of list) {
    const cat = row.category || '';
    const fid = row.metadata?._formEntryId;
    const key =
      fid != null && String(fid).length > 0
        ? `${cat}::${String(fid)}`
        : row.id != null
          ? `id::${row.id}`
          : null;
    if (key == null) continue;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, row);
      continue;
    }
    const tRow = new Date(row.created_at || 0);
    const tPrev = new Date(prev.created_at || 0);
    const primary = tRow >= tPrev ? row : prev;
    const secondary = tRow >= tPrev ? prev : row;
    const mergedUrls = [
      ...new Set([
        ...normalizeMediaUrls(primary.media_urls),
        ...normalizeMediaUrls(secondary.media_urls),
      ]),
    ];
    map.set(key, {
      ...primary,
      media_urls: mergedUrls.length > 0 ? mergedUrls : primary.media_urls,
      description:
        primary.description?.trim() || secondary.description?.trim() || '',
    });
  }
  return [...map.values()];
}

/**
 * Renders incident_evidence rows like the report form: category title, description, metadata, then images.
 * @param {object[]} items — rows from incident_evidence
 * @param {string[]} [emptyFallbackUrls] — legacy incidents.media_urls when no structured rows
 * @param {boolean} [compact] — slightly tighter padding (cards in queues)
 * @param {string} [categoryFilter] — if set, only this category (e.g. scene_photos); legacy fallback only applies to scene_photos
 * @param {boolean} [suppressCategoryHeading] — when categoryFilter is set, hide repeating category title on each card
 * @param {object[]} [incidentSectionUpdates] — updates for this evidence section (same section_key); rows with target_evidence_id render under that entry
 * @param {boolean} [canAddEntryUpdates]
 * @param {(evidenceId: string, entryLabel: string) => void} [onAddEntryUpdate]
 * @param {() => void} [onMigrateLegacyPhotos] — when set, legacy scene block shows a control to create structured rows
 * @param {boolean} [migrateLegacyBusy]
 */
export default function StructuredEvidenceList({
  items,
  emptyFallbackUrls = [],
  compact = false,
  categoryFilter = null,
  suppressCategoryHeading = false,
  incidentSectionUpdates = null,
  canAddEntryUpdates = false,
  onAddEntryUpdate,
  onOpenLinkedProfile,
  onMigrateLegacyPhotos,
  migrateLegacyBusy = false,
}) {
  const [lightbox, setLightbox] = useState(null);
  const sorted = useMemo(() => {
    const deduped = dedupeEvidenceRowsByLogicalEntry(items);
    const filtered =
      categoryFilter && String(categoryFilter).length > 0
        ? deduped.filter((r) => r.category === categoryFilter)
        : deduped;
    return [...filtered].sort((a, b) => {
      const oa = categoryDisplayOrder(a.category);
      const ob = categoryDisplayOrder(b.category);
      if (oa !== ob) return oa - ob;
      return new Date(a.created_at || 0) - new Date(b.created_at || 0);
    });
  }, [items, categoryFilter]);

  if (sorted.length === 0) {
    const legacy = normalizeMediaUrls(emptyFallbackUrls);
    const legacyAllowed =
      !categoryFilter || categoryFilter === 'scene_photos';
    if (legacy.length === 0 || !legacyAllowed) {
      if (categoryFilter) {
        return (
          <p className="text-sm text-gray-500 dark:text-gray-400 italic">
            No entries in this category in the original submission.
          </p>
        );
      }
      return null;
    }
    return (
      <>
        <div className="mb-4">
          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Legacy upload — photos were not stored as structured evidence rows.
            </p>
            {typeof onMigrateLegacyPhotos === 'function' && (
              <button
                type="button"
                onClick={() => onMigrateLegacyPhotos()}
                disabled={migrateLegacyBusy}
                className="shrink-0 rounded-lg border border-amber-600/60 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-500/50 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/50"
              >
                {migrateLegacyBusy ? 'Saving…' : 'Convert to structured scene evidence'}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {legacy.map((url, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() =>
                  setLightbox({
                    id: Date.now(),
                    urls: legacy,
                    index: idx,
                    title: 'Evidence photo',
                  })
                }
                className="p-0 border-0 bg-transparent rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
              >
                <img
                  src={url}
                  alt={`Evidence ${idx + 1}`}
                  className="w-20 h-20 object-cover rounded-lg border border-gray-200 dark:border-gray-700 hover:opacity-90 transition"
                />
              </button>
            ))}
          </div>
        </div>
        <PatrollerPhotoPreview
          key={lightbox ? `ev-${lightbox.id}` : 'ev-closed'}
          open={!!lightbox}
          onClose={() => setLightbox(null)}
          name={lightbox?.title}
          imageUrls={lightbox?.urls}
          initialIndex={lightbox?.index ?? 0}
        />
      </>
    );
  }

  const pad = compact ? 'p-4' : 'p-6';

  return (
    <>
    <div className="space-y-4">
      {sorted.map((item, rowIndex) => {
        const mediaUrls = normalizeMediaUrls(item.media_urls);
        const metadata = normalizeMetadata(item.metadata);
        const { cleanMetadata, linkMeta } =
          item.category === 'suspects'
            ? extractSuspectLinkMeta(metadata)
            : { cleanMetadata: metadata, linkMeta: null };
        const title =
          EVIDENCE_CATEGORY_LABELS[item.category] ||
          item.category?.replace(/_/g, ' ') ||
          'Evidence';

        const rowKey =
          item.id != null ? String(item.id) : `ev-row-${rowIndex}`;

        const headingText = suppressCategoryHeading
          ? `Entry ${rowIndex + 1}`
          : title;

        const entryLabel = suppressCategoryHeading
          ? `Entry ${rowIndex + 1}`
          : title;

        const entryUpdates =
          incidentSectionUpdates?.filter(
            (u) =>
              u.target_evidence_id &&
              item.id != null &&
              String(u.target_evidence_id) === String(item.id)
          ) || [];

        const nextItem = sorted[rowIndex + 1];
        const isLastInCategory =
          !nextItem || nextItem.category !== item.category;

        // Inline category-wide notes only when rendering the full evidence list (e.g. incident list card).
        // On incident detail, each category uses categoryFilter + IncidentSectionPanel for section-wide updates.
        const categoryWideEvidenceUpdates =
          !categoryFilter &&
          isLastInCategory &&
          item.category &&
          incidentSectionUpdates?.length
            ? incidentSectionUpdates.filter((u) => {
                if (u.target_evidence_id) return false;
                const sk = String(u.section_key || '');
                const expected = evidenceCategoryToSectionKey(item.category);
                if (sk === expected) return true;
                if (sk === 'evidence' && item.category === 'scene_photos')
                  return true;
                return false;
              })
            : [];

        const showEntry =
          canAddEntryUpdates &&
          typeof onAddEntryUpdate === 'function' &&
          item.id != null &&
          !isSyntheticSuspectEvidenceRow(item);

        return (
          <div key={rowKey} className="space-y-2">
            <div
              className={`bg-gray-50 dark:bg-gray-900/40 rounded-xl border border-gray-200 dark:border-gray-700 ${pad}`}
            >
              <div className="flex justify-between items-start gap-2 mb-2">
                <h4 className="font-semibold text-gray-900 dark:text-white">{headingText}</h4>
                {item.created_at && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {format(new Date(item.created_at), 'dd MMM yyyy HH:mm')}
                  </span>
                )}
              </div>

              {shouldShowEvidenceDescription(item.description) ? (
                <p className="text-sm text-gray-700 dark:text-gray-300 mb-3 whitespace-pre-wrap">
                  {item.description}
                </p>
              ) : !String(item.description ?? '').trim() ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 italic">No description</p>
              ) : null}

              {linkMeta && (
                <div className="mb-3 rounded-lg border border-teal-200 bg-teal-50 p-3 text-xs dark:border-teal-800 dark:bg-teal-900/20">
                  <p className="font-medium text-teal-800 dark:text-teal-200">
                    Linked profile: {linkMeta.linkedProfileName || 'Unknown profile'}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-teal-900 dark:text-teal-100">
                    <span>ID: {String(linkMeta.linkedProfileId).slice(0, 8)}...</span>
                    {linkMeta.linkedProfileRisk && <span>Risk: {String(linkMeta.linkedProfileRisk).toUpperCase()}</span>}
                    {linkMeta.linkedConnectionType && <span>Relation: {connectionTypeLabel(linkMeta.linkedConnectionType)}</span>}
                    {Number.isFinite(linkMeta.linkedConfidenceScore) && (
                      <span>Confidence: {Math.max(1, Math.min(100, Math.round(linkMeta.linkedConfidenceScore)))}%</span>
                    )}
                  </div>
                  {typeof onOpenLinkedProfile === 'function' && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => onOpenLinkedProfile(linkMeta.linkedProfileId)}
                        className="rounded-md bg-teal-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-700"
                      >
                        View full profile
                      </button>
                    </div>
                  )}
                </div>
              )}

              {Object.keys(cleanMetadata).length > 0 && (
                <div className="bg-white dark:bg-gray-800/80 p-3 rounded-lg mb-3 border border-gray-100 dark:border-gray-700">
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Entry details</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {Object.entries(cleanMetadata).map(([key, value]) => (
                      <div key={key}>
                        <span className="text-gray-500">
                          {(METADATA_LABELS[key] ||
                            key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())).trim()}
                          :
                        </span>{' '}
                        <span className="text-gray-900 dark:text-white">
                          {formatMetadataDisplayValue(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {mediaUrls.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {mediaUrls.map((url, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() =>
                        setLightbox({
                          id: Date.now(),
                          urls: mediaUrls,
                          index: idx,
                          title,
                        })
                      }
                      className="block w-full p-0 border-0 bg-transparent rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
                    >
                      <img
                        src={url}
                        alt={`${title} ${idx + 1}`}
                        className="rounded-lg object-cover h-24 w-full border border-gray-200 dark:border-gray-600 hover:opacity-90 transition"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {entryUpdates.length > 0 && (
              <div className="space-y-2 pl-2 sm:pl-3 border-l-2 border-amber-300 dark:border-amber-700">
                {entryUpdates.map((u) => (
                  <IncidentUpdateCard
                    key={u.id}
                    row={u}
                    sectionLabel={
                      INCIDENT_SECTION_LABELS[u.section_key] || undefined
                    }
                  />
                ))}
              </div>
            )}

            {categoryWideEvidenceUpdates.length > 0 && (
              <div className="space-y-2 pl-2 sm:pl-3 border-l-2 border-amber-300 dark:border-amber-700">
                {categoryWideEvidenceUpdates.map((u) => (
                  <IncidentUpdateCard
                    key={u.id}
                    row={u}
                    sectionLabel={
                      INCIDENT_SECTION_LABELS[u.section_key] || u.section_key
                    }
                  />
                ))}
              </div>
            )}

            {showEntry && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => onAddEntryUpdate(item.id, entryLabel)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/80 dark:border-amber-600/80 bg-white dark:bg-gray-800 px-2.5 py-1 text-xs font-medium text-amber-900 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-950/50"
                >
                  <FaPlus className="w-3 h-3 shrink-0" />
                  Add update for this entry
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
    <PatrollerPhotoPreview
      key={lightbox ? `ev-${lightbox.id}` : 'ev-closed'}
      open={!!lightbox}
      onClose={() => setLightbox(null)}
      name={lightbox?.title}
      imageUrls={lightbox?.urls}
      initialIndex={lightbox?.index ?? 0}
    />
    </>
  );
}
