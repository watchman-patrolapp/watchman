import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase/client';
import { format } from 'date-fns';
import { 
  FaArrowLeft, FaUserSecret, FaFileAlt, FaExclamationTriangle, FaCar, FaTrash, FaEdit,
  FaPrint, FaFilePdf, FaHistory, FaUser
} from 'react-icons/fa';
import CriminalProfileCard from '../components/intelligence/CriminalProfileCard';
import { SeenByChip } from '../components/intelligence/SightingsLogEditor';
import { totalProfileLocationCardCount } from '../utils/profileLocationCount';
import { collectUserIdsFromProfiles, fetchUserLabelMap } from '../utils/profileUserLabels';
import StructuredEvidenceList, {
  EVIDENCE_CATEGORY_ORDER,
  normalizeMediaUrls,
} from '../components/evidence/StructuredEvidenceList';
import IncidentSectionPanel from '../components/incident/IncidentSectionPanel';
import AddIncidentSectionUpdateModal from '../components/incident/AddIncidentSectionUpdateModal';
import {
  INCIDENT_SECTION_KEYS,
  INCIDENT_SECTION_LABELS,
  groupIncidentSectionUpdatesByKey,
  canAddIncidentSectionUpdates,
  evidenceCategoryToSectionKey,
} from '../constants/incidentSectionUpdates';
import toast from 'react-hot-toast';
import BrandedLoader from '../components/layout/BrandedLoader';
import { useAuth } from '../auth/useAuth';
import ThemeToggle from '../components/ThemeToggle';
import { deleteIncidentFully } from '../utils/deleteIncident';
import {
  connectionTypeBadgeClasses,
  connectionTypeLabel,
  PROFILE_INCIDENT_CONFIDENCE_NOT_SET_HINT,
} from '../data/profileIncidentLinkTaxonomy';
import { canStaffManageIncidents } from '../auth/staffRoles';

/**
 * `incident_suspects` is populated for every structured suspect submit; `incident_evidence` rows can be
 * missing (older flows, failed insert, or evidence_id mismatch). Merge so the report still shows suspect entries.
 */
/** Normalize profile_incidents.confidence_score (DB may return number or string). */
function parseStoredLinkConfidence(raw) {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(100, Math.round(n)));
}

/**
 * When profile_incidents.confidence_score is null, use suspect evidence metadata.
 * Prefer the most recently created row with a score (not MAX), so lowering confidence to 90 is not beaten by an older 100.
 */
function confidenceScoreFromSuspectEvidence(evidenceRows, profileId) {
  if (profileId == null) return null;
  const want = String(profileId);
  let best = null;
  let bestT = -Infinity;
  for (const row of evidenceRows || []) {
    if (row?.category !== "suspects") continue;
    const lid = row.metadata?.linked_profile_id;
    if (lid == null || String(lid) !== want) continue;
    const raw = row.metadata?.linked_confidence_score;
    if (raw == null || raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    const clamped = Math.max(1, Math.min(100, Math.round(n)));
    const t = new Date(row.updated_at || row.created_at || 0).getTime();
    if (best == null || t >= bestT) {
      best = clamped;
      bestT = t;
    }
  }
  return best;
}

function mergeIncidentSuspectsIntoEvidence(evidenceRows, suspectRows) {
  const list = [...(evidenceRows || [])];
  const evidenceIds = new Set(list.map((r) => r?.id).filter(Boolean));
  for (const s of suspectRows || []) {
    if (s.evidence_id != null && evidenceIds.has(s.evidence_id)) continue;
    const meta = {};
    if (s.estimated_age != null && s.estimated_age !== '') meta.age = s.estimated_age;
    if (s.clothing_description) meta.clothing = s.clothing_description;
    if (s.direction_last_seen) meta.direction = s.direction_last_seen;
    if (s.time_observed) meta.timeObserved = s.time_observed;
    list.push({
      id: `__incident_suspect__${s.id}`,
      incident_id: s.incident_id,
      category: 'suspects',
      description: s.description?.trim() || '',
      metadata: meta,
      media_urls: s.photo_urls,
      submitted_by: null,
      created_at: s.created_at,
    });
  }
  return list;
}

function LinkedProfileLinkCard({ link, navigate, userLabelById = {} }) {
  const fromProfileRow = parseStoredLinkConfidence(link.confidence_score);
  const displayConfidence =
    fromProfileRow != null
      ? fromProfileRow
      : link._effective_confidence_score != null
        ? link._effective_confidence_score
        : null;
  const confidenceFromEvidenceOnly =
    displayConfidence != null && fromProfileRow == null;

  return (
    <div className="rounded-xl border-2 border-gray-300 bg-white p-6 shadow-sm dark:border-gray-600 dark:bg-gray-800">
      <div className="flex justify-between items-start mb-4">
        <div>
          <span
            className={`inline-block px-2 py-1 rounded text-xs font-bold mb-2 ${connectionTypeBadgeClasses(
              link.connection_type
            )}`}
          >
            {connectionTypeLabel(link.connection_type)}
          </span>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-500 dark:text-gray-400">Link confidence:</span>
              {displayConfidence != null ? (
                <>
                  <div className="w-24 bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        displayConfidence > 80
                          ? 'bg-green-500'
                          : displayConfidence > 50
                            ? 'bg-yellow-500'
                            : 'bg-red-500'
                      }`}
                      style={{
                        width: `${Math.min(100, Math.max(0, displayConfidence))}%`,
                      }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {displayConfidence}%
                  </span>
                  {confidenceFromEvidenceOnly && (
                    <span
                      className="text-[10px] text-gray-500 dark:text-gray-400"
                      title="From suspect evidence (latest row). Re-save the report to copy this into the profile–incident link row."
                    >
                      (from evidence)
                    </span>
                  )}
                </>
              ) : (
                <span className="text-sm text-gray-500 dark:text-gray-400">Not set</span>
              )}
            </div>
            {displayConfidence == null && (
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xl">
                {PROFILE_INCIDENT_CONFIDENCE_NOT_SET_HINT}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate(`/intelligence/profiles/${link.profile_id}`)}
          className="px-4 py-2 bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 rounded-lg text-sm font-medium hover:bg-teal-200 transition"
        >
          View Full Profile
        </button>
      </div>

      {link.profile && (
        <CriminalProfileCard
          profile={link.profile}
          userLabelById={userLabelById}
          stats={{
            incidentCount:
              link.profile.profile_incidents?.[0]?.count ??
              link.profile.incident_count ??
              0,
            associateCount: (() => {
              const p = link.profile;
              const o = p?.associate_out?.[0]?.count;
              const i = p?.associate_in?.[0]?.count;
              const no = typeof o === 'number' ? o : Number(o) || 0;
              const ni = typeof i === 'number' ? i : Number(i) || 0;
              if (no || ni) return no + ni;
              return p?.associate_count ?? 0;
            })(),
            locationCount: totalProfileLocationCardCount(link.profile, link.profile.profile_geography),
          }}
        />
      )}

      {link.verification_notes && (
        <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm text-gray-600 dark:text-gray-400">
          <strong>Analyst Notes:</strong> {link.verification_notes}
        </div>
      )}
    </div>
  );
}

export default function IncidentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [incident, setIncident] = useState(null);
  const [evidence, setEvidence] = useState([]);
  const [incidentSuspects, setIncidentSuspects] = useState([]);
  const [linkedProfiles, setLinkedProfiles] = useState([]);
  const [profileUserLabelById, setProfileUserLabelById] = useState({});
  const [activeTab, setActiveTab] = useState('details');
  const [loading, setLoading] = useState(true);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [sectionUpdates, setSectionUpdates] = useState([]);
  const [updateModal, setUpdateModal] = useState(null);
  const [sectionUpdateBusy, setSectionUpdateBusy] = useState(false);
  const [migrateLegacyBusy, setMigrateLegacyBusy] = useState(false);

  const showAdminDelete = canStaffManageIncidents(user?.role);
  const canAddUpdates = canAddIncidentSectionUpdates(user?.role);
  const updatesBySection = groupIncidentSectionUpdatesByKey(sectionUpdates);
  const hasAnySectionUpdates = sectionUpdates.length > 0;

  const displayEvidence = useMemo(
    () => mergeIncidentSuspectsIntoEvidence(evidence, incidentSuspects),
    [evidence, incidentSuspects]
  );

  const linkedProfilesForDisplay = useMemo(
    () =>
      linkedProfiles.map((link) => ({
        ...link,
        _effective_confidence_score: confidenceScoreFromSuspectEvidence(
          displayEvidence,
          link.profile_id
        ),
      })),
    [linkedProfiles, displayEvidence]
  );

  useEffect(() => {
    if (!linkedProfiles.length) {
      setProfileUserLabelById({});
      return undefined;
    }
    const profiles = linkedProfiles.map((l) => l.profile).filter(Boolean);
    let cancelled = false;
    (async () => {
      const ids = collectUserIdsFromProfiles(profiles);
      const map = await fetchUserLabelMap(supabase, ids);
      if (!cancelled) setProfileUserLabelById(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [linkedProfiles]);

  const legacyUrlsForScene =
    incident && !evidence.some((row) => row.category === 'scene_photos')
      ? incident.media_urls
      : [];

  const fetchIncidentDetails = useCallback(async () => {
    try {
      // Fetch incident
      const { data: incidentData, error: incidentError } = await supabase
        .from('incidents')
        .select('*')
        .eq('id', id)
        .single();

      if (incidentError) throw incidentError;
      setIncident(incidentData);

      // Fetch evidence
      const { data: evidenceData, error: evidenceError } = await supabase
        .from('incident_evidence')
        .select('*')
        .eq('incident_id', id);

      if (evidenceError) throw evidenceError;
      setEvidence(evidenceData || []);

      const { data: suspectsData, error: suspectsError } = await supabase
        .from('incident_suspects')
        .select('*')
        .eq('incident_id', id);
      if (suspectsError) console.warn('incident_suspects fetch:', suspectsError);
      setIncidentSuspects(suspectsData || []);

      // Fetch linked profiles - CRITICAL INTEGRATION
      const { data: profilesData, error: profilesError } = await supabase
        .from('profile_incidents')
        .select(`
          *,
          profile:profile_id (
            *,
            profile_incidents(count),
            associate_out:profile_associates!profile_id(count),
            associate_in:profile_associates!associate_profile_id(count),
            profile_geography!profile_id(count)
          )
        `)
        .eq('incident_id', id);

      if (profilesError) throw profilesError;
      setLinkedProfiles(profilesData || []);

      const { data: suData, error: suError } = await supabase
        .from('incident_section_updates')
        .select('*')
        .eq('incident_id', id)
        .order('created_at', { ascending: true });

      if (suError) throw suError;
      setSectionUpdates(suData || []);

    } catch (error) {
      console.error('Error fetching incident:', error);
      toast.error('Failed to load incident details');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const handleMigrateLegacyScenePhotos = useCallback(async () => {
    if (!id || !incident || !user?.id) return;
    const urls = normalizeMediaUrls(incident.media_urls);
    if (urls.length === 0) {
      toast.error('No legacy photo URLs to migrate.');
      return;
    }
    if (evidence.some((r) => r.category === 'scene_photos')) {
      toast.error('Scene evidence already exists for this incident.');
      return;
    }
    setMigrateLegacyBusy(true);
    try {
      const row = {
        incident_id: id,
        category: 'scene_photos',
        description: '',
        metadata: { _formEntryId: `legacy_migrate_${Date.now()}` },
        media_urls: urls,
        submitted_by: user.id,
      };
      const { error } = await supabase.from('incident_evidence').insert(row).select('id').single();
      if (error) throw error;
      toast.success('Legacy photos saved as structured scene evidence.');
      await fetchIncidentDetails();
    } catch (err) {
      console.error('Migrate legacy scene photos:', err);
      toast.error(err?.message || 'Could not migrate photos');
    } finally {
      setMigrateLegacyBusy(false);
    }
  }, [id, incident, user?.id, evidence, fetchIncidentDetails]);

  const handleAdminDelete = async () => {
    const msg =
      'Permanently delete this incident and all related data (evidence rows, suspects, profile links, match queue)?\n\n' +
      'Photos under this incident in Storage will be removed.\n\nThis cannot be undone.';
    if (!window.confirm(msg)) return;

    setDeleteBusy(true);
    try {
      const result = await deleteIncidentFully(id);
      if (!result.ok) {
        toast.error(
          result.error?.includes('admin_delete_incident') || result.error?.includes('function')
            ? `Delete failed: ${result.error} — run the SQL migration admin_delete_incident in Supabase.`
            : `Delete failed: ${result.error || 'Unknown error'}`
        );
        return;
      }
      toast.success('Incident deleted');
      navigate('/incidents');
    } finally {
      setDeleteBusy(false);
    }
  };

  useEffect(() => {
    fetchIncidentDetails();
  }, [fetchIncidentDetails]);

  const handleSubmitSectionUpdate = useCallback(
    async (bodyText) => {
      if (!updateModal || !user?.id) return;
      setSectionUpdateBusy(true);
      try {
        const insertPayload = {
          incident_id: id,
          section_key: updateModal.key,
          body: bodyText,
          created_by: user.id,
        };
        if (updateModal.targetEvidenceId) {
          insertPayload.target_evidence_id = updateModal.targetEvidenceId;
        }
        const { data, error } = await supabase
          .from('incident_section_updates')
          .insert(insertPayload)
          .select()
          .single();
        if (error) throw error;
        setSectionUpdates((prev) => [...prev, data]);
        setUpdateModal(null);
        toast.success('Update published');
      } catch (e) {
        console.error(e);
        toast.error(e.message || 'Could not save update');
      } finally {
        setSectionUpdateBusy(false);
      }
    },
    [updateModal, user?.id, id]
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <BrandedLoader message="Loading incident…" size="lg" />
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Incident not found
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-20">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <button 
            onClick={() => navigate('/incidents')}
            className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-2"
          >
            <FaArrowLeft /> Back to Incidents
          </button>
          <div className="flex justify-between items-start gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Incident #{id.slice(0, 8)}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Reported by {incident.submitted_by_name} on {format(new Date(incident.submitted_at), 'MMM dd, yyyy HH:mm')}
              </p>
              {hasAnySectionUpdates && (
                <p className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-amber-900 dark:text-amber-200">
                  <FaHistory className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  This report has official section updates below (original submission is preserved).
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                incident.status === 'pending' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200' :
                incident.status === 'approved' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' :
                'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
              }`}>
                {incident.status?.toUpperCase()}
              </span>
              <div className="flex flex-wrap justify-end gap-2 items-center">
                <ThemeToggle variant="toolbar" />
                <button
                  type="button"
                  onClick={() => navigate(`/incidents/${id}/print`)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700"
                >
                  <FaPrint className="w-3.5 h-3.5" />
                  Print
                </button>
                <button
                  type="button"
                  onClick={() => navigate(`/incidents/${id}/print?intent=pdf`)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-700 text-white hover:bg-indigo-800"
                >
                  <FaFilePdf className="w-3.5 h-3.5" />
                  Save as PDF
                </button>
                {showAdminDelete && incident.status === 'approved' && (
                  <button
                    type="button"
                    onClick={() => navigate(`/incident/${id}/edit`)}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-teal-600 text-white hover:bg-teal-700"
                  >
                    <FaEdit className="w-3.5 h-3.5" />
                    Edit report
                  </button>
                )}
                {showAdminDelete && (
                  <button
                    type="button"
                    disabled={deleteBusy}
                    onClick={handleAdminDelete}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <FaTrash className="w-3.5 h-3.5" />
                    {deleteBusy ? 'Deleting…' : 'Delete incident (admin)'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-8">
            {[
              { id: 'details', label: 'Details', icon: FaFileAlt },
              { id: 'evidence', label: 'Evidence', icon: FaFileAlt, count: displayEvidence.length },
              { id: 'intelligence', label: 'Intelligence', icon: FaUserSecret, count: linkedProfiles.length }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 py-4 border-b-2 font-medium text-sm transition ${
                  activeTab === tab.id
                    ? 'border-teal-600 text-teal-600 dark:text-teal-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-2 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded-full text-xs">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'details' && (
          <div className="space-y-8 rounded-xl border-2 border-gray-300 bg-white p-6 shadow-sm dark:border-gray-600 dark:bg-gray-800">
            <IncidentSectionPanel
              label={INCIDENT_SECTION_LABELS[INCIDENT_SECTION_KEYS.INCIDENT_DATE]}
              originalChildren={
                <p className="text-gray-900 dark:text-white">
                  {format(new Date(incident.incident_date), 'MMM dd, yyyy')}
                </p>
              }
              updates={updatesBySection[INCIDENT_SECTION_KEYS.INCIDENT_DATE] || []}
              canAdd={canAddUpdates}
              onAddClick={() =>
                setUpdateModal({
                  key: INCIDENT_SECTION_KEYS.INCIDENT_DATE,
                  label: INCIDENT_SECTION_LABELS[INCIDENT_SECTION_KEYS.INCIDENT_DATE],
                })
              }
            />

            <IncidentSectionPanel
              label={INCIDENT_SECTION_LABELS[INCIDENT_SECTION_KEYS.LOCATION]}
              originalChildren={
                incident.location?.trim() ? (
                  <p className="text-gray-900 dark:text-white whitespace-pre-wrap">{incident.location}</p>
                ) : (
                  <EmptyOriginal />
                )
              }
              updates={updatesBySection[INCIDENT_SECTION_KEYS.LOCATION] || []}
              canAdd={canAddUpdates}
              onAddClick={() =>
                setUpdateModal({
                  key: INCIDENT_SECTION_KEYS.LOCATION,
                  label: INCIDENT_SECTION_LABELS[INCIDENT_SECTION_KEYS.LOCATION],
                })
              }
            />

            <IncidentSectionPanel
              label={INCIDENT_SECTION_LABELS[INCIDENT_SECTION_KEYS.TYPE]}
              originalChildren={
                incident.type?.trim() ? (
                  <p className="text-gray-900 dark:text-white">{incident.type}</p>
                ) : (
                  <EmptyOriginal />
                )
              }
              updates={updatesBySection[INCIDENT_SECTION_KEYS.TYPE] || []}
              canAdd={canAddUpdates}
              onAddClick={() =>
                setUpdateModal({
                  key: INCIDENT_SECTION_KEYS.TYPE,
                  label: INCIDENT_SECTION_LABELS[INCIDENT_SECTION_KEYS.TYPE],
                })
              }
            />

            <IncidentSectionPanel
              label={INCIDENT_SECTION_LABELS[INCIDENT_SECTION_KEYS.DESCRIPTION]}
              originalChildren={
                incident.description?.trim() ? (
                  <p className="text-gray-900 dark:text-white whitespace-pre-wrap leading-relaxed">{incident.description}</p>
                ) : (
                  <EmptyOriginal />
                )
              }
              updates={updatesBySection[INCIDENT_SECTION_KEYS.DESCRIPTION] || []}
              canAdd={canAddUpdates}
              onAddClick={() =>
                setUpdateModal({
                  key: INCIDENT_SECTION_KEYS.DESCRIPTION,
                  label: INCIDENT_SECTION_LABELS[INCIDENT_SECTION_KEYS.DESCRIPTION],
                })
              }
            />

            <IncidentSectionPanel
              label={INCIDENT_SECTION_LABELS[INCIDENT_SECTION_KEYS.SUSPECT]}
              originalChildren={
                incident.suspect_name || incident.suspect_description ? (
                  <div className="space-y-2">
                    {incident.suspect_name && (
                      <p className="text-gray-900 dark:text-white">
                        <span className="text-gray-500 dark:text-gray-400 text-sm font-medium">Name: </span>
                        {incident.suspect_name}
                      </p>
                    )}
                    {incident.suspect_description && (
                      <p className="text-gray-900 dark:text-white whitespace-pre-wrap">{incident.suspect_description}</p>
                    )}
                  </div>
                ) : (
                  <EmptyOriginal />
                )
              }
              updates={updatesBySection[INCIDENT_SECTION_KEYS.SUSPECT] || []}
              canAdd={canAddUpdates}
              onAddClick={() =>
                setUpdateModal({
                  key: INCIDENT_SECTION_KEYS.SUSPECT,
                  label: INCIDENT_SECTION_LABELS[INCIDENT_SECTION_KEYS.SUSPECT],
                })
              }
            />

            {linkedProfiles.length > 0 && (
              <div className="rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/40 dark:bg-teal-950/25 p-6 space-y-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                      <FaUserSecret className="text-teal-600 dark:text-teal-400" />
                      Linked criminal profiles
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      Subjects tied to this incident in the intelligence database. The Intelligence tab has the same
                      dossier cards plus a quick summary banner.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('intelligence')}
                    className="shrink-0 text-sm font-medium text-teal-700 dark:text-teal-300 hover:underline"
                  >
                    Open Intelligence tab →
                  </button>
                </div>
                <div className="space-y-6">
                  {linkedProfilesForDisplay.map((link) => (
                    <LinkedProfileLinkCard
                      key={link.id}
                      link={link}
                      navigate={navigate}
                      userLabelById={profileUserLabelById}
                    />
                  ))}
                </div>
              </div>
            )}

            <IncidentSectionPanel
              label={INCIDENT_SECTION_LABELS[INCIDENT_SECTION_KEYS.VEHICLE]}
              originalChildren={
                incident.vehicle_info?.trim() ? (
                  <p className="text-gray-900 dark:text-white whitespace-pre-wrap">{incident.vehicle_info}</p>
                ) : (
                  <EmptyOriginal />
                )
              }
              updates={updatesBySection[INCIDENT_SECTION_KEYS.VEHICLE] || []}
              canAdd={canAddUpdates}
              onAddClick={() =>
                setUpdateModal({
                  key: INCIDENT_SECTION_KEYS.VEHICLE,
                  label: INCIDENT_SECTION_LABELS[INCIDENT_SECTION_KEYS.VEHICLE],
                })
              }
            />

            <IncidentSectionPanel
              label={INCIDENT_SECTION_LABELS[INCIDENT_SECTION_KEYS.WITNESS]}
              originalChildren={
                incident.witness_present ? (
                  incident.witness_user_id || incident.witness_name?.trim() ? (
                    <div className="flex flex-wrap gap-2">
                      <SeenByChip
                        entry={{
                          seen_by_user_id: incident.witness_user_id || null,
                          seen_by_name: (incident.witness_name || '').trim(),
                          seen_by_other_name: incident.witness_user_id
                            ? null
                            : (incident.witness_name || '').trim() || null,
                          seen_by_avatar_url: null,
                        }}
                        viewerId={user?.id}
                        viewerRole={user?.role}
                      />
                    </div>
                  ) : (
                    <p className="text-gray-900 dark:text-white">Yes — name not provided</p>
                  )
                ) : (
                  <p className="text-gray-500 dark:text-gray-400 italic">No witness recorded in the original submission.</p>
                )
              }
              updates={updatesBySection[INCIDENT_SECTION_KEYS.WITNESS] || []}
              canAdd={canAddUpdates}
              onAddClick={() =>
                setUpdateModal({
                  key: INCIDENT_SECTION_KEYS.WITNESS,
                  label: INCIDENT_SECTION_LABELS[INCIDENT_SECTION_KEYS.WITNESS],
                })
              }
            />

            <IncidentSectionPanel
              label={INCIDENT_SECTION_LABELS[INCIDENT_SECTION_KEYS.SAPS_CASE]}
              originalChildren={
                incident.saps_case_number?.trim() ? (
                  <p className="text-gray-900 dark:text-white">{incident.saps_case_number}</p>
                ) : (
                  <EmptyOriginal />
                )
              }
              updates={updatesBySection[INCIDENT_SECTION_KEYS.SAPS_CASE] || []}
              canAdd={canAddUpdates}
              onAddClick={() =>
                setUpdateModal({
                  key: INCIDENT_SECTION_KEYS.SAPS_CASE,
                  label: INCIDENT_SECTION_LABELS[INCIDENT_SECTION_KEYS.SAPS_CASE],
                })
              }
            />

            <IncidentSectionPanel
              label={INCIDENT_SECTION_LABELS[INCIDENT_SECTION_KEYS.REPORTING_MEMBER]}
              originalChildren={
                (() => {
                  const name = incident.submitted_by_name?.trim();
                  const hasVehicle = Boolean(incident.submitted_by_car || incident.submitted_by_reg);
                  if (!name && !hasVehicle) return <EmptyOriginal />;
                  return (
                    <div className="space-y-3">
                      {name && (
                        <div className="flex items-start gap-2">
                          <FaUser className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                          <div>
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Patroller / member</span>
                            <p className="text-gray-900 dark:text-white">{name}</p>
                          </div>
                        </div>
                      )}
                      {incident.submitted_by_car && (
                        <div className="flex items-start gap-2">
                          <FaCar className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                          <div>
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Patrol vehicle</span>
                            <p className="text-gray-900 dark:text-white">{incident.submitted_by_car}</p>
                          </div>
                        </div>
                      )}
                      {incident.submitted_by_reg && (
                        <div className="flex items-start gap-2">
                          <FaFileAlt className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                          <div>
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Vehicle registration</span>
                            <p className="text-gray-900 dark:text-white">{incident.submitted_by_reg}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()
              }
              updates={updatesBySection[INCIDENT_SECTION_KEYS.REPORTING_MEMBER] || []}
              canAdd={canAddUpdates}
              onAddClick={() =>
                setUpdateModal({
                  key: INCIDENT_SECTION_KEYS.REPORTING_MEMBER,
                  label: INCIDENT_SECTION_LABELS[INCIDENT_SECTION_KEYS.REPORTING_MEMBER],
                })
              }
            />

            {EVIDENCE_CATEGORY_ORDER.map((categoryId) => {
              const sectionKey = evidenceCategoryToSectionKey(categoryId);
              const label = INCIDENT_SECTION_LABELS[sectionKey];
              const emptyFallback = categoryId === 'scene_photos' ? legacyUrlsForScene : [];
              const allSectionUpdates = updatesBySection[sectionKey] || [];
              const sectionWideUpdates = allSectionUpdates.filter((u) => !u.target_evidence_id);
              return (
                <IncidentSectionPanel
                  key={sectionKey}
                  label={label}
                  originalChildren={
                    <StructuredEvidenceList
                      items={displayEvidence}
                      emptyFallbackUrls={emptyFallback}
                      categoryFilter={categoryId}
                      suppressCategoryHeading
                      onOpenLinkedProfile={(profileId) =>
                        navigate(`/intelligence/profiles/${profileId}`)
                      }
                      incidentSectionUpdates={allSectionUpdates}
                      canAddEntryUpdates={canAddUpdates}
                      onAddEntryUpdate={
                        canAddUpdates
                          ? (evidenceId, entryLabel) =>
                              setUpdateModal({
                                key: sectionKey,
                                label,
                                targetEvidenceId: evidenceId,
                                entryHint: entryLabel,
                              })
                          : undefined
                      }
                      onMigrateLegacyPhotos={
                        canAddUpdates ? handleMigrateLegacyScenePhotos : undefined
                      }
                      migrateLegacyBusy={migrateLegacyBusy}
                    />
                  }
                  updates={sectionWideUpdates}
                  canAdd={canAddUpdates}
                  onAddClick={() =>
                    setUpdateModal({
                      key: sectionKey,
                      label,
                      targetEvidenceId: undefined,
                      entryHint: undefined,
                    })
                  }
                />
              );
            })}
          </div>
        )}

        {activeTab === 'evidence' && (
          <div className="space-y-8 rounded-xl border-2 border-gray-300 bg-white p-6 shadow-sm dark:border-gray-600 dark:bg-gray-800">
            {EVIDENCE_CATEGORY_ORDER.map((categoryId) => {
              const sectionKey = evidenceCategoryToSectionKey(categoryId);
              const label = INCIDENT_SECTION_LABELS[sectionKey];
              const emptyFallback = categoryId === 'scene_photos' ? legacyUrlsForScene : [];
              const allSectionUpdates = updatesBySection[sectionKey] || [];
              const sectionWideUpdates = allSectionUpdates.filter((u) => !u.target_evidence_id);
              return (
                <IncidentSectionPanel
                  key={sectionKey}
                  label={label}
                  originalChildren={
                    <StructuredEvidenceList
                      items={displayEvidence}
                      emptyFallbackUrls={emptyFallback}
                      categoryFilter={categoryId}
                      suppressCategoryHeading
                      onOpenLinkedProfile={(profileId) =>
                        navigate(`/intelligence/profiles/${profileId}`)
                      }
                      incidentSectionUpdates={allSectionUpdates}
                      canAddEntryUpdates={canAddUpdates}
                      onAddEntryUpdate={
                        canAddUpdates
                          ? (evidenceId, entryLabel) =>
                              setUpdateModal({
                                key: sectionKey,
                                label,
                                targetEvidenceId: evidenceId,
                                entryHint: entryLabel,
                              })
                          : undefined
                      }
                      onMigrateLegacyPhotos={
                        canAddUpdates ? handleMigrateLegacyScenePhotos : undefined
                      }
                      migrateLegacyBusy={migrateLegacyBusy}
                    />
                  }
                  updates={sectionWideUpdates}
                  canAdd={canAddUpdates}
                  onAddClick={() =>
                    setUpdateModal({
                      key: sectionKey,
                      label,
                      targetEvidenceId: undefined,
                      entryHint: undefined,
                    })
                  }
                />
              );
            })}
          </div>
        )}

        {activeTab === 'intelligence' && (
          <div className="space-y-6">
            {linkedProfiles.length === 0 ? (
              <div className="text-center py-12">
                <FaUserSecret className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  No Linked Profiles
                </h3>
                <p className="text-gray-500 dark:text-gray-400 mb-4">
                  This incident is not linked to any criminal profiles yet.
                </p>
                <button 
                  onClick={() => navigate(`/incident-form?link=${id}`)}
                  className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition"
                >
                  Link Suspect to Profile
                </button>
              </div>
            ) : (
              <>
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-6">
                  <h3 className="font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-2">
                    <FaExclamationTriangle />
                    Intelligence Summary
                  </h3>
                  <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                    {linkedProfiles.length} suspect(s) linked to this incident with varying confidence levels.
                    Review profiles for modus operandi patterns and associate networks.
                  </p>
                </div>

                {linkedProfilesForDisplay.map((link) => (
                  <LinkedProfileLinkCard
                    key={link.id}
                    link={link}
                    navigate={navigate}
                    userLabelById={profileUserLabelById}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </main>

      <AddIncidentSectionUpdateModal
        open={Boolean(updateModal)}
        onClose={() => {
          if (!sectionUpdateBusy) setUpdateModal(null);
        }}
        sectionLabel={updateModal?.label || ''}
        entryHint={updateModal?.entryHint}
        onSubmit={handleSubmitSectionUpdate}
        busy={sectionUpdateBusy}
      />
    </div>
  );
}

function EmptyOriginal() {
  return (
    <p className="italic text-gray-500 dark:text-gray-400">
      No information in the original submission.
    </p>
  );
}
