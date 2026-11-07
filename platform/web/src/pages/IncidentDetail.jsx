import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase/client';
import { 
  FaArrowLeft, FaUserSecret, FaFileAlt, FaCar, FaTrash, FaEdit,
  FaPrint, FaFilePdf, FaHistory, FaUser, FaShareAlt
} from 'react-icons/fa';
import { SeenByChip } from '../components/intelligence/SightingsLogEditor';
import { collectUserIdsFromProfiles, fetchUserLabelMap } from '../utils/profileUserLabels';
import StructuredEvidenceList, {
  EVIDENCE_CATEGORY_ORDER,
  normalizeMediaUrls,
} from '../components/evidence/StructuredEvidenceList';
import IncidentSectionPanel from '../components/incident/IncidentSectionPanel';
import AddIncidentSectionUpdateModal from '../components/incident/AddIncidentSectionUpdateModal';
import ShareToCityHubSheet from '../components/incident/ShareToCityHubSheet';
import {
  INCIDENT_SECTION_KEYS,
  INCIDENT_SECTION_LABELS,
  groupIncidentSectionUpdatesByKey,
  canAddIncidentSectionUpdates,
  evidenceCategoryToSectionKey,
} from '../constants/incidentSectionUpdates';
import toast from '../utils/notify';
import BrandedLoader from '../components/layout/BrandedLoader';
import { useAuth } from '../auth/useAuth';
import ThemeToggle from '../components/ThemeToggle';
import { deleteIncidentFully } from '../utils/deleteIncident';
import {
  formatIncidentWhen,
  confidenceScoreFromSuspectEvidence,
  mergeIncidentSuspectsIntoEvidence,
} from '../components/incident/detail/incidentDetailHelpers';
import LinkedProfileLinkCard from '../components/incident/detail/LinkedProfileLinkCard';
import EmptyOriginal from '../components/incident/detail/EmptyOriginal';
import { EvidenceTab, IntelligenceTab } from '../components/incident/detail/IncidentDetailTabs';
import { canStaffManageIncidents } from '../auth/staffRoles';
import { canPublishCityHub } from '../auth/roleMatrix';
import { belongsToActiveOrganization, useScopedOrganization } from '../utils/organizationScope';
import { fetchCityHubShareForIncident } from '../utils/cityHubShare';

export default function IncidentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeOrganizationId, activeOrganization, includeUnscoped } = useScopedOrganization();
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
  const [cityHubShare, setCityHubShare] = useState(null);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const loadGen = useRef(0);

  const showAdminDelete = canStaffManageIncidents(user?.role);
  const canShareToCityHub = canPublishCityHub(user?.role, user?.platformRole);
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
    const gen = ++loadGen.current;
    try {
      // Fetch incident
      const { data: incidentData, error: incidentError } = await supabase
        .from('incidents')
        .select('*')
        .eq('id', id)
        .single();

      if (gen !== loadGen.current) return;
      if (incidentError) throw incidentError;
      if (!belongsToActiveOrganization(incidentData, activeOrganizationId, includeUnscoped)) {
        toast.error('This incident belongs to another neighborhood.');
        navigate('/incidents', { replace: true });
        return;
      }
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

      try {
        const shared = await fetchCityHubShareForIncident(id);
        setCityHubShare(shared);
      } catch (shareErr) {
        console.warn('City Hub share lookup:', shareErr);
        setCityHubShare(incidentData?.city_hub_post_id ? { id: incidentData.city_hub_post_id } : null);
      }

    } catch (error) {
      if (gen !== loadGen.current) return;
      console.error('Error fetching incident:', error);
      toast.error('Failed to load incident details');
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [id, activeOrganizationId, includeUnscoped, navigate]);

  const handleMigrateLegacyScenePhotos = useCallback(async () => {
    if (!id || !incident || !user?.id || migrateLegacyBusy) return;
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
  }, [id, incident, user?.id, evidence, fetchIncidentDetails, migrateLegacyBusy]);

  const handleAdminDelete = async () => {
    if (deleteBusy) return;
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
      if (!updateModal || !user?.id || sectionUpdateBusy) return;
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
    [updateModal, user?.id, id, sectionUpdateBusy]
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
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 shadow-sm backdrop-blur-sm dark:border-gray-700 dark:bg-gray-800/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-3 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => navigate('/incidents')}
            className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            <FaArrowLeft className="h-3 w-3" />
            Back to Incidents
          </button>
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-xs font-medium sm:text-sm ${
              incident.status === 'pending' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200' :
              incident.status === 'approved' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' :
              'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
            }`}>
              {incident.status?.toUpperCase()}
            </span>
            <ThemeToggle variant="toolbar" />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Incident #{id.slice(0, 8)}
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Reported by {incident.submitted_by_name} on {formatIncidentWhen(incident.submitted_at)}
            </p>
            {hasAnySectionUpdates && (
              <p className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-amber-900 dark:text-amber-200">
                <FaHistory className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                This report has official section updates below (original submission is preserved).
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => navigate(`/incidents/${id}/print`)}
              className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700"
            >
              <FaPrint className="h-3.5 w-3.5" />
              Print
            </button>
            <button
              type="button"
              onClick={() => navigate(`/incidents/${id}/print?intent=pdf`)}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800"
            >
              <FaFilePdf className="h-3.5 w-3.5" />
              Save as PDF
            </button>
            {canShareToCityHub && incident.status === 'approved' && !cityHubShare && (
              <button
                type="button"
                onClick={() => setShareSheetOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
              >
                <FaShareAlt className="h-3.5 w-3.5" />
                Share to City Hub
              </button>
            )}
            {canShareToCityHub && incident.status === 'approved' && cityHubShare && (
              <button
                type="button"
                onClick={() => navigate('/city-hub')}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-100 px-3 py-1.5 text-sm font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
              >
                Shared to City Hub
              </button>
            )}
            {showAdminDelete && incident.status === 'approved' && (
              <button
                type="button"
                onClick={() => navigate(`/incident/${id}/edit`)}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700"
              >
                <FaEdit className="h-3.5 w-3.5" />
                Edit report
              </button>
            )}
            {showAdminDelete && (
              <button
                type="button"
                disabled={deleteBusy}
                onClick={handleAdminDelete}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FaTrash className="h-3.5 w-3.5" />
                {deleteBusy ? 'Deleting…' : 'Delete incident (admin)'}
              </button>
            )}
          </div>
        </div>
      </div>

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
                  {formatIncidentWhen(incident.incident_date, 'MMM dd, yyyy')}
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
          <EvidenceTab
            displayEvidence={displayEvidence}
            legacyUrlsForScene={legacyUrlsForScene}
            updatesBySection={updatesBySection}
            canAddUpdates={canAddUpdates}
            navigate={navigate}
            setUpdateModal={setUpdateModal}
            handleMigrateLegacyScenePhotos={handleMigrateLegacyScenePhotos}
            migrateLegacyBusy={migrateLegacyBusy}
          />
        )}

        {activeTab === 'intelligence' && (
          <IntelligenceTab
            linkedProfiles={linkedProfiles}
            linkedProfilesForDisplay={linkedProfilesForDisplay}
            navigate={navigate}
            id={id}
            profileUserLabelById={profileUserLabelById}
          />
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

      <ShareToCityHubSheet
        open={shareSheetOpen}
        onClose={() => setShareSheetOpen(false)}
        incident={incident}
        organizationName={activeOrganization?.name}
        organizationId={activeOrganizationId}
        userId={user?.id}
        linkedProfiles={linkedProfiles}
        incidentSuspects={incidentSuspects}
        onShared={(post) => setCityHubShare(post || { id: true })}
      />
    </div>
  );
}
