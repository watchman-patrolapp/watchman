import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { supabase } from '../supabase/client';
import { safeInternalReturnPath } from '../utils/safeReturnPath';
import toast from 'react-hot-toast';
import { 
  FaArrowLeft, 
  FaEdit, 
  FaUserSecret, 
  FaMapMarkerAlt,
  FaExclamationTriangle,
  FaPlus,
  FaTrash,
  FaSave,
  FaTimes,
  FaUpload,
  FaSearch,
  FaExpand,
} from 'react-icons/fa';
import ThemeToggle from '../components/ThemeToggle';
import BrandedLoader from '../components/layout/BrandedLoader';
import WatchlistTemplatePicker from '../components/intelligence/WatchlistTemplatePicker';
import {
  IntelligenceFieldGuideTopic,
  FieldGuideExplainerLink,
  FIELD_GUIDE_TOPIC_TITLES,
} from '../components/intelligence/IntelligenceFieldGuide';
import {
  CONVICTION_HISTORY_SUMMARY_OPTIONS,
  CRIMINAL_JUSTICE_STATUS_OPTIONS,
  LEGAL_RECORD_INTELLIGENCE_NOTE,
} from '../data/intelligenceTaxonomy';
import { connectionTypeLabel } from '../data/profileIncidentLinkTaxonomy';
import { fetchAssociatesBidirectional } from '../utils/profileAssociates';
import SightingsLogEditor from '../components/intelligence/SightingsLogEditor';
import {
  initialSightingsLogForForm,
  sanitizeSightingsLogForDb,
  syncLegacyLastSeenFromSightings,
  mergedSightingsForDisplay,
} from '../utils/criminalProfileSightings';
import PatrollerPhotoPreview from '../components/patrol/PatrollerPhotoPreview';
import ProfileRecordAudit from '../components/intelligence/ProfileRecordAudit';
import { collectUserIdsFromProfiles, fetchUserLabelMap } from '../utils/profileUserLabels';

const DETAIL_SECTION =
  'rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:shadow-lg';

const DETAIL_INPUT =
  'mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-700 dark:text-white';
const DETAIL_INPUT_NAME = `${DETAIL_INPUT} text-lg font-semibold`;
const DETAIL_INPUT_SM =
  'rounded-md border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-700 dark:text-white';
const DETAIL_INPUT_FLEX_SM =
  'flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white';
const BANNER_SELECT =
  'rounded-full border-2 border-gray-300 bg-white px-4 py-2 text-sm font-semibold dark:border-gray-600 dark:bg-gray-800 dark:text-white';

/** Small profile image for associate rows (uses first photo in `photo_urls` if present). */
function AssociateFaceThumb({ profile, className = 'h-10 w-10' }) {
  const url = profile?.photo_urls?.[0];
  return (
    <div
      className={`shrink-0 overflow-hidden rounded-lg bg-gray-200 ring-1 ring-gray-200 dark:bg-gray-600 dark:ring-gray-600 ${className}`}
    >
      {url ? (
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover object-top"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <FaUserSecret className="h-[42%] w-[42%] min-h-[0.875rem] min-w-[0.875rem] text-gray-500 dark:text-gray-400" />
        </div>
      )}
    </div>
  );
}

const ASSOCIATE_RELATIONSHIP_OPTIONS = [
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

export default function CriminalProfileDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = safeInternalReturnPath(new URLSearchParams(location.search).get('returnTo'));
  const backTarget = returnTo || '/intelligence/search';
  const backLabel = returnTo ? 'Back' : 'Back to criminal database';
  const buildProfilePath = (options = {}) => {
    const params = new URLSearchParams();
    if (options.edit) params.set('edit', 'true');
    if (returnTo) params.set('returnTo', returnTo);
    const q = params.toString();
    return q ? `/intelligence/profiles/${id}?${q}` : `/intelligence/profiles/${id}`;
  };
  const { user } = useAuth();
  
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [associates, setAssociates] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [photoUploadsPending, setPhotoUploadsPending] = useState(0);
  const deleteInFlightRef = useRef(false);
  const [fieldGuideTopic, setFieldGuideTopic] = useState(null);
  const [associatesDraft, setAssociatesDraft] = useState(null);
  const associatesAtEditStartRef = useRef([]);
  const associatesDraftBootstrappedRef = useRef(false);
  const lastProfileIdForDraftRef = useRef(null);
  const [associateSearchQuery, setAssociateSearchQuery] = useState('');
  const [associateSearchResults, setAssociateSearchResults] = useState([]);
  const [associateSearchLoading, setAssociateSearchLoading] = useState(false);
  const [photoLightbox, setPhotoLightbox] = useState(null);
  const [auditUserLabels, setAuditUserLabels] = useState({});

  // Check if we're in edit mode from URL query param
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const editMode = params.get('edit') === 'true';
    setIsEditing(editMode);
  }, [location]);

  useEffect(() => {
    if (fieldGuideTopic == null) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setFieldGuideTopic(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fieldGuideTopic]);

  useEffect(() => {
    const edit = new URLSearchParams(location.search).get('edit') === 'true';
    if (!edit) {
      setAssociatesDraft(null);
      associatesDraftBootstrappedRef.current = false;
      lastProfileIdForDraftRef.current = null;
      setAssociateSearchQuery('');
      setAssociateSearchResults([]);
      return;
    }
    if (lastProfileIdForDraftRef.current !== id) {
      associatesDraftBootstrappedRef.current = false;
      lastProfileIdForDraftRef.current = id;
    }
    if (loading) return;
    if (associatesDraftBootstrappedRef.current) return;
    associatesAtEditStartRef.current = associates.map((r) => ({ ...r }));
    setAssociatesDraft(associates.map((r) => ({ ...r })));
    associatesDraftBootstrappedRef.current = true;
  }, [loading, associates, location.search, id]);

  useEffect(() => {
    const edit = new URLSearchParams(location.search).get('edit') === 'true';
    if (!edit || associateSearchQuery.trim().length < 2) {
      setAssociateSearchResults([]);
      return;
    }
    const q = associateSearchQuery.trim();
    const t = setTimeout(async () => {
      setAssociateSearchLoading(true);
      try {
        const { data, error } = await supabase
          .from('criminal_profiles')
          .select('id, primary_name, risk_level, status, photo_urls')
          .neq('id', id)
          .ilike('primary_name', `%${q}%`)
          .limit(12);
        if (error) throw error;
        const linked = new Set(
          (associatesDraft || []).map((r) => r.other_profile_id || r.associate_profile_id)
        );
        setAssociateSearchResults((data || []).filter((p) => !linked.has(p.id)));
      } catch (e) {
        console.error(e);
        toast.error('Could not search profiles');
        setAssociateSearchResults([]);
      } finally {
        setAssociateSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [associateSearchQuery, location.search, id, associatesDraft]);

  useEffect(() => {
    fetchProfile();
  }, [id]);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('criminal_profiles')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      
      setProfile(data);
      setEditForm({ ...data, sightings_log: initialSightingsLogForForm(data) });

      const auditIds = collectUserIdsFromProfiles([data]);
      const labelMap = await fetchUserLabelMap(supabase, auditIds);
      setAuditUserLabels(labelMap);

      let associatesData = [];
      try {
        associatesData = await fetchAssociatesBidirectional(supabase, id);
      } catch (assocErr) {
        console.error('Associates fetch:', assocErr);
      }
      setAssociates(associatesData || []);

      // Fetch linked incidents
      const { data: incidentsData } = await supabase
        .from('profile_incidents')
        .select('*, incidents(*)')
        .eq('profile_id', id)
        .order('linked_at', { ascending: false });
      setIncidents(incidentsData || []);

    } catch (err) {
      console.error('Error fetching profile:', err);
      toast.error('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (photoUploadsPending > 0) {
      toast.error('Please wait for photo uploads to finish');
      return;
    }
    try {
      setSaving(true);

      const allowed = [
        'primary_name', 'date_of_birth', 'place_of_birth', 'nationality', 'gender',
        'height_cm', 'weight_kg', 'build_type', 'eye_color', 'hair_color', 'complexion',
        'distinguishing_marks', 'photo_urls', 'risk_level', 'status', 'priority',
        'watchlist_flags', 'mo_signature', 'known_aliases', 'id_numbers',
        'first_identified_at',
        'common_presence', 'residence_last_known',
        'gang_affiliation', 'criminal_organization',
        'conviction_history_summary', 'criminal_justice_status'
      ];

      const updateData = {};
      for (const key of allowed) {
        if (!(key in editForm)) continue;
        let val = editForm[key];
        if (key === 'status' && val === 'inactive') val = 'cleared';
        updateData[key] = val;
      }

      const sanitizedSightings = sanitizeSightingsLogForDb(editForm.sightings_log ?? []);
      updateData.sightings_log = sanitizedSightings;
      Object.assign(updateData, syncLegacyLastSeenFromSightings(sanitizedSightings));

      const { error } = await supabase
        .from('criminal_profiles')
        .update({
          ...updateData,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ? String(user.id) : null,
        })
        .eq('id', id);

      if (error) throw error;

      await syncAssociatesWithServer();

      toast.success('Profile updated successfully');
      setIsEditing(false);
      navigate(buildProfilePath(), { replace: true });
      fetchProfile();
    } catch (err) {
      console.error('Update error:', err);
      toast.error('Failed to update profile: ' + (err.message || String(err)));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (profile) {
      setEditForm({ ...profile, sightings_log: initialSightingsLogForForm(profile) });
    }
    setIsEditing(false);
    navigate(buildProfilePath(), { replace: true });
  };

  const handleDelete = async () => {
    if (deleteInFlightRef.current) return;
    deleteInFlightRef.current = true;
    try {
      if (!window.confirm('Are you sure you want to delete this profile? This action cannot be undone.')) {
        return;
      }

      const { data, error } = await supabase
        .from('criminal_profiles')
        .delete()
        .eq('id', id)
        .select('id');

      if (error) throw error;

      if (!data?.length) {
        toast.error(
          'Nothing was deleted. Open supabase/criminal_profiles_delete_policy.sql in your project, copy the SQL inside the file (not the path), paste into Supabase → SQL Editor → Run.'
        );
        return;
      }

      toast.success('Profile deleted');
      navigate('/intelligence/search');
    } catch (err) {
      console.error('Delete profile:', err);
      const msg = err?.message || String(err);
      const hint =
        msg.includes('violates foreign key') || msg.includes('23503')
          ? ' Remove or unlink related records first, or run migrations that set ON DELETE SET NULL on match-queue references.'
          : '';
      toast.error('Failed to delete profile: ' + msg + hint);
    } finally {
      deleteInFlightRef.current = false;
    }
  };

  const getRiskColor = (level) => {
    switch (level?.toLowerCase()) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-black';
      case 'low': return 'bg-green-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority?.toLowerCase()) {
      case 'immediate': return 'bg-red-700 text-white';
      case 'urgent': return 'bg-red-500 text-white';
      case 'priority': return 'bg-orange-500 text-white';
      case 'routine': return 'bg-blue-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'active': return 'bg-green-500 text-white';
      case 'wanted': return 'bg-red-600 text-white';
      case 'incarcerated': return 'bg-gray-700 text-white';
      case 'deceased': return 'bg-black text-white';
      case 'cleared':
      case 'inactive': return 'bg-gray-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  const updateField = (field, value) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
  };

  const handleEditPhotoSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    if (!user?.id) {
      toast.error('You must be signed in to upload photos');
      return;
    }

    const validFiles = files.filter((file) => {
      if (!file.type.startsWith('image/')) {
        toast.error(`${file.name} is not an image file`);
        return false;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`${file.name} is too large (max 5MB)`);
        return false;
      }
      return true;
    });

    for (const file of validFiles) {
      setPhotoUploadsPending((n) => n + 1);
      try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `criminal-profiles/${user.id}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('criminal-photos')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('criminal-photos')
          .getPublicUrl(filePath);

        setEditForm((prev) => ({
          ...prev,
          photo_urls: [...(prev.photo_urls || []), publicUrl]
        }));
        toast.success(`${file.name} uploaded`);
      } catch (err) {
        console.error('Upload error:', err);
        toast.error(`Failed to upload ${file.name}: ${err.message}`);
      } finally {
        setPhotoUploadsPending((n) => Math.max(0, n - 1));
      }
    }
  };

  const removePhotoAtIndex = async (index) => {
    const urls = [...(editForm.photo_urls || [])];
    const url = urls[index];
    if (url && url.includes('/criminal-photos/')) {
      try {
        const path = url.split('/criminal-photos/')[1]?.split('?')[0];
        if (path) await supabase.storage.from('criminal-photos').remove([path]);
      } catch (err) {
        console.error('Error deleting file:', err);
      }
    }
    urls.splice(index, 1);
    setEditForm((prev) => ({ ...prev, photo_urls: urls }));
  };

  const updateArrayField = (field, index, value) => {
    const newArray = [...(editForm[field] || [])];
    newArray[index] = value;
    setEditForm(prev => ({ ...prev, [field]: newArray }));
  };

  const addArrayItem = (field) => {
    setEditForm(prev => ({ 
      ...prev, 
      [field]: [...(prev[field] || []), ''] 
    }));
  };

  const removeArrayItem = (field, index) => {
    setEditForm(prev => ({
      ...prev,
      [field]: (prev[field] || []).filter((_, i) => i !== index)
    }));
  };

  const setWatchlistFlagsForEdit = (updater) => {
    setEditForm((prev) => {
      const current = [...(prev.watchlist_flags || [])];
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, watchlist_flags: next };
    });
  };

  const syncAssociatesWithServer = async () => {
    if (associatesDraft == null) return;
    const baseline = associatesAtEditStartRef.current || [];
    const baselineById = new Map(baseline.filter((r) => r.id).map((r) => [r.id, r]));
    const draftIds = new Set(associatesDraft.filter((r) => r.id).map((r) => r.id));
    for (const row of baseline) {
      if (row.id && !draftIds.has(row.id)) {
        const { error: delErr } = await supabase.from('profile_associates').delete().eq('id', row.id);
        if (delErr) throw delErr;
      }
    }
    const inserted = new Set();
    for (const row of associatesDraft) {
      const otherId = row.other_profile_id ?? row.associate_profile_id;
      if (!otherId) continue;
      if (!row.id) {
        if (inserted.has(otherId)) continue;
        inserted.add(otherId);
        const { error: insErr } = await supabase.from('profile_associates').insert({
          profile_id: id,
          associate_profile_id: otherId,
          relationship_type: row.relationship_type || 'associate',
          relationship_strength: row.relationship_strength || 'suspected',
          is_active: true,
        });
        if (insErr) {
          if (insErr.code === '23505') {
            toast.error('One associate is already linked; skipped duplicate.');
            continue;
          }
          throw insErr;
        }
      } else {
        const orig = baselineById.get(row.id);
        if (orig && orig.relationship_type !== row.relationship_type) {
          const { error: upErr } = await supabase
            .from('profile_associates')
            .update({ relationship_type: row.relationship_type || 'associate' })
            .eq('id', row.id);
          if (upErr) throw upErr;
        }
      }
    }
  };

  const addAssociateFromSearch = (picked) => {
    setAssociatesDraft((prev) => {
      const list = prev || [];
      if (list.some((r) => (r.other_profile_id || r.associate_profile_id) === picked.id)) return list;
      return [
        ...list,
        {
          _clientKey: crypto.randomUUID(),
          profile_id: id,
          associate_profile_id: picked.id,
          other_profile_id: picked.id,
          _viewerIsProfileId: true,
          _linkerProfile: null,
          relationship_type: 'associate',
          relationship_strength: 'suspected',
          profile: {
            id: picked.id,
            primary_name: picked.primary_name,
            photo_urls: picked.photo_urls,
          },
        },
      ];
    });
    setAssociateSearchQuery('');
    setAssociateSearchResults([]);
    toast.success(`Linked ${picked.primary_name || 'profile'}`);
  };

  const removeAssociateDraftRow = (row) => {
    setAssociatesDraft((prev) =>
      (prev || []).filter((r) => (r.id ? r.id !== row.id : r._clientKey !== row._clientKey))
    );
  };

  const updateAssociateDraftField = (row, field, value) => {
    setAssociatesDraft((prev) =>
      (prev || []).map((r) => {
        const same = r.id ? r.id === row.id : r._clientKey === row._clientKey;
        return same ? { ...r, [field]: value } : r;
      })
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <BrandedLoader message="Loading profile…" size="lg" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 text-center dark:bg-gray-900">
        <h2 className="mb-4 text-2xl font-bold text-gray-800 dark:text-white">Profile Not Found</h2>
        <button 
          onClick={() => navigate(backTarget)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          {backLabel}
        </button>
      </div>
    );
  }

  const displayData = isEditing ? editForm : profile;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="mx-auto max-w-6xl p-6">
      {/* Header */}
      <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div className="flex items-center gap-4">
          <button 
            type="button"
            onClick={() => navigate(backTarget)}
            className="inline-flex items-center gap-2 rounded-xl bg-gray-200 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            <FaArrowLeft /> {backLabel}
          </button>
          
          <h1 className="text-2xl font-bold text-gray-800 md:text-3xl dark:text-white">
            {isEditing ? 'Edit Profile' : displayData.primary_name}
          </h1>
        </div>

        <div className="flex flex-wrap gap-2 sm:gap-3 items-center">
          <ThemeToggle variant="toolbar" />
          {!isEditing ? (
            <>
              <button 
                type="button"
                onClick={() => navigate(buildProfilePath({ edit: true }))}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                <FaEdit /> Edit Profile
              </button>
              
              <button 
                type="button"
                onClick={handleDelete}
                className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-white transition hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500"
              >
                <FaTrash /> Delete
              </button>
            </>
          ) : (
            <>
              <button 
                type="button"
                onClick={handleCancel}
                className="flex items-center gap-2 rounded-xl border border-gray-300 bg-gray-100 px-4 py-2 font-medium text-gray-800 transition hover:bg-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
              >
                <FaTimes /> Cancel
              </button>
              
              <button 
                type="button"
                onClick={handleSave}
                disabled={saving || photoUploadsPending > 0}
                className="flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-50 dark:bg-teal-600 dark:hover:bg-teal-500"
              >
                <FaSave /> {saving ? 'Saving...' : photoUploadsPending > 0 ? 'Uploading photos...' : 'Save Changes'}
              </button>
            </>
          )}
        </div>
      </div>

      {profile && (
        <div className="mb-6 max-w-3xl">
          <ProfileRecordAudit profile={profile} userLabelById={auditUserLabels} />
        </div>
      )}

      {/* Risk/Priority/Status Banner */}
      <div className="mb-6 space-y-2">
        <div className="flex flex-wrap gap-2">
          {isEditing ? (
            <>
              <select
                value={editForm.risk_level || 'medium'}
                onChange={(e) => updateField('risk_level', e.target.value)}
                className={BANNER_SELECT}
              >
                <option value="low">Risk: LOW</option>
                <option value="medium">Risk: MEDIUM</option>
                <option value="high">Risk: HIGH</option>
                <option value="critical">Risk: CRITICAL</option>
              </select>

              <select
                value={editForm.priority || 'routine'}
                onChange={(e) => updateField('priority', e.target.value)}
                className={BANNER_SELECT}
              >
                <option value="routine">Priority: ROUTINE</option>
                <option value="priority">Priority: PRIORITY</option>
                <option value="urgent">Priority: URGENT</option>
                <option value="immediate">Priority: IMMEDIATE</option>
              </select>

              <select
                value={editForm.status || 'active'}
                onChange={(e) => updateField('status', e.target.value)}
                className={BANNER_SELECT}
              >
                <option value="active">Status: ACTIVE</option>
                <option value="cleared">Status: INACTIVE (CLEARED)</option>
                <option value="wanted">Status: WANTED</option>
                <option value="incarcerated">Status: INCARCERATED</option>
                <option value="deceased">Status: DECEASED</option>
              </select>
            </>
          ) : (
            <>
              <span className={`rounded-full px-4 py-2 text-sm font-semibold ${getRiskColor(displayData.risk_level)}`}>
                Risk: {displayData.risk_level?.toUpperCase()}
              </span>
              <span className={`rounded-full px-4 py-2 text-sm font-semibold ${getPriorityColor(displayData.priority)}`}>
                Priority: {displayData.priority?.toUpperCase()}
              </span>
              <span className={`rounded-full px-4 py-2 text-sm font-semibold ${getStatusColor(displayData.status)}`}>
                Status: {displayData.status?.toUpperCase()}
              </span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
          <span className="font-medium text-gray-700 dark:text-gray-300">Field guide:</span>
          <FieldGuideExplainerLink topic="risk" onOpen={setFieldGuideTopic}>
            Risk levels
          </FieldGuideExplainerLink>
          <span className="text-gray-300 dark:text-gray-600" aria-hidden>
            ·
          </span>
          <FieldGuideExplainerLink topic="priority" onOpen={setFieldGuideTopic}>
            Priority
          </FieldGuideExplainerLink>
          <span className="text-gray-300 dark:text-gray-600" aria-hidden>
            ·
          </span>
          <FieldGuideExplainerLink topic="status" onOpen={setFieldGuideTopic}>
            Status
          </FieldGuideExplainerLink>
          <span className="text-gray-300 dark:text-gray-600" aria-hidden>
            ·
          </span>
          <FieldGuideExplainerLink topic="watchlist" onOpen={setFieldGuideTopic}>
            Watchlist flags
          </FieldGuideExplainerLink>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Photos */}
          <section className={DETAIL_SECTION}>
            <h2 className="mb-4 text-lg font-semibold text-gray-700 dark:text-gray-200">Photographs</h2>

            {isEditing && (
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Add photos from device</label>
                <div className="cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-4 text-center transition-colors hover:border-blue-500 dark:border-gray-600 dark:bg-gray-900/40 dark:hover:border-blue-400">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    id="edit-profile-photo-upload"
                    onChange={handleEditPhotoSelect}
                  />
                  <label
                    htmlFor="edit-profile-photo-upload"
                    className="cursor-pointer flex flex-col items-center"
                  >
                    <FaUpload className="mb-2 h-10 w-10 text-gray-400 dark:text-gray-500" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">Click to choose photos</span>
                    <span className="mt-1 text-xs text-gray-400 dark:text-gray-500">JPG, PNG, GIF up to 5MB</span>
                  </label>
                </div>
                {photoUploadsPending > 0 && (
                  <p className="mt-2 text-sm text-blue-600 dark:text-blue-400">Uploading…</p>
                )}
              </div>
            )}

            {displayData.photo_urls && displayData.photo_urls.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {displayData.photo_urls.map((url, index) => {
                  const galleryUrls = (displayData.photo_urls || []).filter(Boolean);
                  return (
                    <div key={`${url}-${index}`} className="relative group">
                      <button
                        type="button"
                        onClick={() =>
                          setPhotoLightbox({ urls: galleryUrls, index })
                        }
                        className="group relative block w-full cursor-zoom-in overflow-hidden rounded-lg border-0 bg-transparent p-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
                        aria-label={`View photograph ${index + 1} full size`}
                      >
                        <img
                          src={url}
                          alt={`Profile ${index + 1}`}
                          className="h-32 w-full object-cover object-top transition group-hover:opacity-90"
                        />
                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-black/0 opacity-0 transition group-hover:bg-black/15 group-hover:opacity-100">
                          <FaExpand className="h-6 w-6 text-white drop-shadow-md" aria-hidden />
                        </span>
                      </button>
                      {isEditing && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removePhotoAtIndex(index);
                          }}
                          className="absolute -top-2 -right-2 z-10 rounded-full bg-red-500 p-1 text-white shadow-md"
                          aria-label="Remove photo"
                        >
                          <FaTimes size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              !isEditing && (
                <div className="flex h-48 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
                  No photos available
                </div>
              )
            )}
          </section>

          {/* Physical Description */}
          <section className={DETAIL_SECTION}>
            <h2 className="mb-4 text-lg font-semibold text-gray-700 dark:text-gray-200">Physical Description</h2>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <span className="text-gray-600 dark:text-gray-400">Height:</span>
                {isEditing ? (
                  <input
                    type="number"
                    value={editForm.height_cm || ''}
                    onChange={(e) => updateField('height_cm', e.target.value ? parseInt(e.target.value) : null)}
                    className={DETAIL_INPUT_SM}
                    placeholder="cm"
                  />
                ) : (
                  <span className="font-medium dark:text-gray-100">{displayData.height_cm ? `${displayData.height_cm} cm` : '-'}</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <span className="text-gray-600 dark:text-gray-400">Weight:</span>
                {isEditing ? (
                  <input
                    type="number"
                    value={editForm.weight_kg || ''}
                    onChange={(e) => updateField('weight_kg', e.target.value ? parseInt(e.target.value) : null)}
                    className={DETAIL_INPUT_SM}
                    placeholder="kg"
                  />
                ) : (
                  <span className="font-medium dark:text-gray-100">{displayData.weight_kg ? `${displayData.weight_kg} kg` : '-'}</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <span className="text-gray-600 dark:text-gray-400">Build:</span>
                {isEditing ? (
                  <select
                    value={editForm.build_type || ''}
                    onChange={(e) => updateField('build_type', e.target.value || null)}
                    className={DETAIL_INPUT_SM}
                  >
                    <option value="">Select</option>
                    <option value="slim">Slim</option>
                    <option value="medium">Medium</option>
                    <option value="athletic">Athletic</option>
                    <option value="heavy">Heavy</option>
                    <option value="muscular">Muscular</option>
                  </select>
                ) : (
                  <span className="font-medium capitalize dark:text-gray-100">{displayData.build_type || '-'}</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <span className="text-gray-600 dark:text-gray-400">Eye Color:</span>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.eye_color || ''}
                    onChange={(e) => updateField('eye_color', e.target.value || null)}
                    className={DETAIL_INPUT_SM}
                  />
                ) : (
                  <span className="font-medium capitalize dark:text-gray-100">{displayData.eye_color || '-'}</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <span className="text-gray-600 dark:text-gray-400">Hair Color:</span>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.hair_color || ''}
                    onChange={(e) => updateField('hair_color', e.target.value || null)}
                    className={DETAIL_INPUT_SM}
                  />
                ) : (
                  <span className="font-medium capitalize dark:text-gray-100">{displayData.hair_color || '-'}</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <span className="text-gray-600 dark:text-gray-400">Complexion:</span>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.complexion || ''}
                    onChange={(e) => updateField('complexion', e.target.value || null)}
                    className={DETAIL_INPUT_SM}
                  />
                ) : (
                  <span className="font-medium capitalize dark:text-gray-100">{displayData.complexion || '-'}</span>
                )}
              </div>
            </div>
            
            {/* Distinguishing Marks */}
            <div className="mt-4">
              <h3 className="mb-2 font-medium text-gray-700 dark:text-gray-200">Distinguishing Marks:</h3>
              {isEditing ? (
                <div className="space-y-2">
                  {(editForm.distinguishing_marks || []).map((mark, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        type="text"
                        value={mark}
                        onChange={(e) => updateArrayField('distinguishing_marks', index, e.target.value)}
                        className={DETAIL_INPUT_FLEX_SM}
                      />
                      <button
                        onClick={() => removeArrayItem('distinguishing_marks', index)}
                        className="text-red-500 px-2"
                      >
                        <FaTimes />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => addArrayItem('distinguishing_marks')}
                    className="flex items-center gap-1 text-sm text-blue-600 dark:text-sky-400"
                  >
                    <FaPlus size={12} /> Add Mark
                  </button>
                </div>
              ) : (
                displayData.distinguishing_marks?.length > 0 ? (
                  <ul className="list-inside list-disc text-sm text-gray-600 dark:text-gray-300">
                    {displayData.distinguishing_marks.map((mark, index) => (
                      <li key={index}>{mark}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-400 dark:text-gray-500">None recorded</p>
                )
              )}
            </div>
          </section>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Information */}
          <section className={DETAIL_SECTION}>
            <h2 className="mb-4 border-b border-gray-200 pb-2 text-xl font-semibold text-blue-600 dark:border-gray-700 dark:text-sky-400">
              Basic Information
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="text-sm text-gray-600 dark:text-gray-400">Primary Name</label>
                {isEditing ? (
                  <input 
                    type="text"
                    value={editForm.primary_name || ''}
                    onChange={(e) => updateField('primary_name', e.target.value)}
                    className={DETAIL_INPUT_NAME}
                  />
                ) : (
                  <p className="text-lg font-semibold text-gray-800 dark:text-white">{displayData.primary_name}</p>
                )}
              </div>

              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400">Date of Birth</label>
                {isEditing ? (
                  <input
                    type="date"
                    value={editForm.date_of_birth || ''}
                    onChange={(e) => updateField('date_of_birth', e.target.value || null)}
                    className={DETAIL_INPUT}
                  />
                ) : (
                  <p className="font-medium dark:text-gray-100">
                    {displayData.date_of_birth 
                      ? new Date(displayData.date_of_birth).toLocaleDateString() 
                      : '-'}
                  </p>
                )}
              </div>

              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400">Place of Birth</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.place_of_birth || ''}
                    onChange={(e) => updateField('place_of_birth', e.target.value || null)}
                    className={DETAIL_INPUT}
                  />
                ) : (
                  <p className="font-medium dark:text-gray-100">{displayData.place_of_birth || '-'}</p>
                )}
              </div>

              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400">Gender</label>
                {isEditing ? (
                  <select
                    value={editForm.gender || ''}
                    onChange={(e) => updateField('gender', e.target.value || null)}
                    className={DETAIL_INPUT}
                  >
                    <option value="">Select</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                    <option value="unknown">Unknown</option>
                  </select>
                ) : (
                  <p className="font-medium capitalize dark:text-gray-100">{displayData.gender || '-'}</p>
                )}
              </div>

              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400">Nationality</label>
                {isEditing ? (
                  <div className="space-y-2 mt-1">
                    {(editForm.nationality || []).map((nat, index) => (
                      <div key={index} className="flex gap-2">
                        <input
                          type="text"
                          value={nat}
                          onChange={(e) => updateArrayField('nationality', index, e.target.value)}
                          className={DETAIL_INPUT_FLEX_SM}
                        />
                        <button
                          onClick={() => removeArrayItem('nationality', index)}
                          className="text-red-500 px-2"
                        >
                          <FaTimes />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => addArrayItem('nationality')}
                      className="flex items-center gap-1 text-sm text-blue-600 dark:text-sky-400"
                    >
                      <FaPlus size={12} /> Add
                    </button>
                  </div>
                ) : (
                  <p className="font-medium dark:text-gray-100">
                    {displayData.nationality?.length > 0 
                      ? displayData.nationality.join(', ') 
                      : '-'}
                  </p>
                )}
              </div>
            </div>

            {/* Known Aliases */}
            <div className="mt-4">
              <label className="text-sm text-gray-600 dark:text-gray-400">Known Aliases</label>
              {isEditing ? (
                <div className="flex flex-wrap gap-2 mt-1">
                  {(editForm.known_aliases || []).map((alias, index) => (
                    <div key={index} className="flex items-center gap-1 rounded bg-gray-100 px-2 py-1 dark:bg-gray-700/70">
                      <input
                        type="text"
                        value={alias}
                        onChange={(e) => updateArrayField('known_aliases', index, e.target.value)}
                        className="border-none bg-transparent text-sm dark:text-white"
                      />
                      <button
                        onClick={() => removeArrayItem('known_aliases', index)}
                        className="text-red-500"
                      >
                        <FaTimes size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => addArrayItem('known_aliases')}
                    className="flex items-center gap-1 rounded border border-dashed border-blue-300 px-2 py-1 text-sm text-blue-600 dark:border-sky-600 dark:text-sky-400"
                  >
                    <FaPlus size={12} /> Add
                  </button>
                </div>
              ) : (
                displayData.known_aliases?.length > 0 ? (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {displayData.known_aliases.map((alias, index) => (
                      <span key={index} className="rounded-full bg-gray-100 px-3 py-1 text-sm dark:bg-gray-700/80 dark:text-gray-100">
                        {alias}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 dark:text-gray-500">No aliases recorded</p>
                )
              )}
            </div>
          </section>

          {/* Location Data */}
          <section className={DETAIL_SECTION}>
            <h2 className="mb-4 flex items-center gap-2 border-b border-gray-200 pb-2 text-xl font-semibold text-orange-600 dark:border-gray-700 dark:text-orange-400">
              <FaMapMarkerAlt /> Location Data
            </h2>

            <div className="mb-6 space-y-4">
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-orange-800 dark:text-orange-300/90">
                  Common presence
                </h3>
                <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                  Areas, routes, or venues where this subject is most often observed.
                </p>
                {isEditing ? (
                  <textarea
                    value={editForm.common_presence || ''}
                    onChange={(e) => updateField('common_presence', e.target.value || null)}
                    rows={3}
                    className={`${DETAIL_INPUT} resize-y min-h-[4.5rem]`}
                    placeholder="e.g. Theescombe retail strip, evenings near park entrance"
                  />
                ) : (
                  <p className="font-medium dark:text-gray-100 whitespace-pre-wrap">
                    {displayData.common_presence?.trim() || '—'}
                  </p>
                )}
              </div>

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-orange-800 dark:text-orange-300/90">
                  Residence (last known)
                </h3>
                <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                  Last known home or residential area on file (verified or alleged).
                </p>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.residence_last_known || ''}
                    onChange={(e) => updateField('residence_last_known', e.target.value || null)}
                    className={DETAIL_INPUT}
                    placeholder="Street, suburb, or general area"
                  />
                ) : (
                  <p className="font-medium dark:text-gray-100">{displayData.residence_last_known?.trim() || '—'}</p>
                )}
              </div>
            </div>

            <div className="border-t border-orange-100 pt-5 dark:border-orange-900/40">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-orange-800 dark:text-orange-300/90">
                Last known sightings
              </h3>
              <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
                Add each reported sighting (time, place, optional coordinates, who saw them). The most recent row is
                also mirrored to legacy “last seen” fields for older screens.
              </p>
            </div>

            <SightingsLogEditor
              value={
                isEditing
                  ? editForm.sightings_log ?? []
                  : mergedSightingsForDisplay(displayData)
              }
              onChange={isEditing ? (list) => updateField('sightings_log', list) : () => {}}
              disabled={!isEditing}
              dateInputClass={DETAIL_INPUT}
              textInputClass={DETAIL_INPUT}
            />
          </section>

          {/* Criminal History */}
          <section className={DETAIL_SECTION}>
            <h2 className="mb-4 flex items-center gap-2 border-b border-gray-200 pb-2 text-xl font-semibold text-red-700 dark:border-gray-700 dark:text-red-400">
              <FaExclamationTriangle /> Criminal History
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400">Gang Affiliation</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.gang_affiliation || ''}
                    onChange={(e) => updateField('gang_affiliation', e.target.value || null)}
                    className={DETAIL_INPUT}
                  />
                ) : (
                  <p className="font-medium text-red-600 dark:text-red-400">{displayData.gang_affiliation || '-'}</p>
                )}
              </div>

              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400">Criminal Organization</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.criminal_organization || ''}
                    onChange={(e) => updateField('criminal_organization', e.target.value || null)}
                    className={DETAIL_INPUT}
                  />
                ) : (
                  <p className="font-medium dark:text-gray-100">{displayData.criminal_organization || '-'}</p>
                )}
              </div>
            </div>

            <p className="mb-4 rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100/90">
              {LEGAL_RECORD_INTELLIGENCE_NOTE}
            </p>

            <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400">Prior convictions (this file)</label>
                {isEditing ? (
                  <select
                    value={editForm.conviction_history_summary || 'unknown'}
                    onChange={(e) => updateField('conviction_history_summary', e.target.value)}
                    className={DETAIL_INPUT}
                  >
                    {CONVICTION_HISTORY_SUMMARY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="mt-1 font-medium dark:text-gray-100">
                    {CONVICTION_HISTORY_SUMMARY_OPTIONS.find(
                      (o) => o.value === (displayData.conviction_history_summary || 'unknown')
                    )?.label ?? '—'}
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {CONVICTION_HISTORY_SUMMARY_OPTIONS.find(
                    (o) =>
                      o.value ===
                      ((isEditing ? editForm.conviction_history_summary : displayData.conviction_history_summary) ||
                        'unknown')
                  )?.hint ?? 'What this file records about previous convictions.'}
                </p>
              </div>
              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400">
                  Criminal justice / prosecution status
                </label>
                {isEditing ? (
                  <select
                    value={editForm.criminal_justice_status || 'unknown'}
                    onChange={(e) => updateField('criminal_justice_status', e.target.value)}
                    className={DETAIL_INPUT}
                  >
                    {CRIMINAL_JUSTICE_STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="mt-1 font-medium dark:text-gray-100">
                    {CRIMINAL_JUSTICE_STATUS_OPTIONS.find(
                      (o) => o.value === (displayData.criminal_justice_status || 'unknown')
                    )?.label ?? '—'}
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {CRIMINAL_JUSTICE_STATUS_OPTIONS.find(
                    (o) =>
                      o.value ===
                      ((isEditing ? editForm.criminal_justice_status : displayData.criminal_justice_status) ||
                        'unknown')
                  )?.hint ?? 'Stage of any open or recent matter, as known to your structure.'}
                </p>
              </div>
            </div>

            {/* Watchlist Flags */}
            <div className="mt-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 font-semibold text-red-600 dark:text-red-400">
                  <FaExclamationTriangle /> Watchlist Flags
                </h3>
                {isEditing && (
                  <FieldGuideExplainerLink topic="watchlist" onOpen={setFieldGuideTopic}>
                    Explain watchlist flags
                  </FieldGuideExplainerLink>
                )}
              </div>
              {isEditing ? (
                <div>
                  <WatchlistTemplatePicker
                    watchlistFlags={editForm.watchlist_flags || []}
                    setWatchlistFlags={setWatchlistFlagsForEdit}
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(editForm.watchlist_flags || []).map((flag, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 dark:border-red-800 dark:bg-red-950/40"
                      >
                        <input
                          type="text"
                          value={flag}
                          onChange={(e) => updateArrayField('watchlist_flags', index, e.target.value)}
                          className="border-none bg-transparent text-sm text-red-700 dark:text-red-300"
                        />
                        <button
                          type="button"
                          onClick={() => removeArrayItem('watchlist_flags', index)}
                          className="text-red-500"
                        >
                          <FaTimes size={12} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => addArrayItem('watchlist_flags')}
                      className="flex items-center gap-1 rounded border border-dashed border-red-300 px-2 py-1 text-sm text-red-600 dark:border-red-700 dark:text-red-400"
                    >
                      <FaPlus size={12} /> Add Flag
                    </button>
                  </div>
                </div>
              ) : (
                displayData.watchlist_flags?.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {displayData.watchlist_flags.map((flag, index) => (
                      <span key={index} className="rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-700 dark:bg-red-950/50 dark:text-red-200">
                        {flag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 dark:text-gray-500">No watchlist flags</p>
                )
              )}
            </div>
          </section>

          {/* Linked Incidents */}
          {incidents.length > 0 && (
            <section className={DETAIL_SECTION}>
              <h2 className="mb-4 border-b border-gray-200 pb-2 text-xl font-semibold text-purple-600 dark:border-gray-700 dark:text-violet-400">
                Linked Incidents ({incidents.length})
              </h2>
              <div className="space-y-3">
                {incidents.map((link) => (
                  <div 
                    key={link.id} 
                    className="cursor-pointer rounded-lg border border-gray-200 p-4 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700/50"
                    onClick={() => navigate(`/incidents/${link.incidents.id}`)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-gray-800 dark:text-gray-100">
                          {(() => {
                            const t = link.incidents?.type?.trim();
                            if (t) return t;
                            const d = link.incidents?.description?.trim();
                            if (d)
                              return `${d.slice(0, 72)}${d.length > 72 ? '…' : ''}`;
                            return 'Incident';
                          })()}
                        </h3>
                        {link.incidents?.location?.trim() && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                            {link.incidents.location.trim()}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                          <span className="font-medium text-gray-700 dark:text-gray-300">Link:</span>{' '}
                          {connectionTypeLabel(link.connection_type)}
                          {link.confidence_score != null && Number.isFinite(Number(link.confidence_score))
                            ? ` · ${link.confidence_score}% confidence`
                            : ''}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded px-2 py-1 text-xs font-medium ${
                          link.incidents?.priority === 'high'
                            ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300'
                            : link.incidents?.priority === 'medium'
                              ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-200'
                              : 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300'
                        }`}
                      >
                        {link.incidents?.status ?? '—'}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                      Linked: {new Date(link.linked_at).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Associates */}
          {(isEditing || associates.length > 0) && (
            <section className={DETAIL_SECTION}>
              <h2 className="mb-4 flex items-center gap-2 border-b border-gray-200 pb-2 text-xl font-semibold text-blue-600 dark:border-gray-700 dark:text-sky-400">
                <FaUserSecret /> Known Associates (
                {isEditing ? (associatesDraft || []).length : associates.length})
              </h2>

              {isEditing ? (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Search other criminal profiles and link them as associates. Links are saved when you save the profile.
                  </p>
                  <div className="relative">
                    <FaSearch className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                    <input
                      type="search"
                      value={associateSearchQuery}
                      onChange={(e) => setAssociateSearchQuery(e.target.value)}
                      placeholder="Search by name (min. 2 characters)…"
                      className="mt-0 w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                      autoComplete="off"
                    />
                    {associateSearchLoading && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">Searching…</span>
                    )}
                    {associateSearchResults.length > 0 && (
                      <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800">
                        {associateSearchResults.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700/80"
                              onClick={() => addAssociateFromSearch(p)}
                            >
                              <span className="flex min-w-0 items-center gap-3">
                                <AssociateFaceThumb profile={p} />
                                <span className="min-w-0 font-medium text-gray-900 dark:text-gray-100">
                                  {p.primary_name}
                                </span>
                              </span>
                              <span className="shrink-0 text-xs capitalize text-gray-500 dark:text-gray-400">
                                {p.risk_level || '—'} · {p.status || '—'}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {(associatesDraft || []).length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-500">No associates linked yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {(associatesDraft || []).map((row) => {
                        const otherId = row.other_profile_id || row.associate_profile_id;
                        const name = row.profile?.primary_name || 'Unknown profile';
                        const rowKey = row.id || row._clientKey;
                        return (
                          <div
                            key={rowKey}
                            className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-600 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0 flex-1">
                              <button
                                type="button"
                                className="flex w-full items-start gap-3 text-left font-semibold text-blue-600 hover:underline dark:text-sky-400"
                                onClick={() => navigate(`/intelligence/profiles/${otherId}`)}
                              >
                                <AssociateFaceThumb profile={row.profile} />
                                <span className="min-w-0 pt-0.5">{name}</span>
                              </button>
                              <p className="text-xs text-gray-500 dark:text-gray-400">Profile ID · {otherId}</p>
                              {row._linkerProfile?.primary_name && (
                                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">
                                  Link recorded from {row._linkerProfile.primary_name}&apos;s profile
                                </p>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                value={row.relationship_type || 'associate'}
                                onChange={(e) => updateAssociateDraftField(row, 'relationship_type', e.target.value)}
                                className={DETAIL_INPUT_SM}
                              >
                                {ASSOCIATE_RELATIONSHIP_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => removeAssociateDraftRow(row)}
                                className="rounded-lg px-2 py-1 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                              >
                                <FaTrash className="inline h-3 w-3" /> Remove
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {associates.map((assoc) => {
                    const targetId = assoc.other_profile_id || assoc.profile?.id || assoc.associate_profile_id;
                    return (
                    <div
                      key={assoc.id}
                      role="button"
                      tabIndex={0}
                      className="flex cursor-pointer gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700/50"
                      onClick={() => navigate(`/intelligence/profiles/${targetId}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(`/intelligence/profiles/${targetId}`);
                        }
                      }}
                    >
                      <AssociateFaceThumb profile={assoc.profile} className="h-12 w-12" />
                      <div className="min-w-0 flex-1">
                      <p className="font-semibold dark:text-gray-100">{assoc.profile?.primary_name ?? 'Unknown'}</p>
                      <p className="text-sm capitalize text-gray-600 dark:text-gray-400">{assoc.relationship_type}</p>
                      {assoc._linkerProfile?.primary_name && (
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                          Link from {assoc._linkerProfile.primary_name}&apos;s profile
                        </p>
                      )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
      </div>

      {fieldGuideTopic != null && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onClick={() => setFieldGuideTopic(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-field-guide-modal-title"
            className="grid max-h-[min(90vh,720px)] w-full max-w-lg grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <h3
                id="profile-field-guide-modal-title"
                className="pr-2 text-lg font-semibold text-gray-900 dark:text-white"
              >
                {FIELD_GUIDE_TOPIC_TITLES[fieldGuideTopic]}
              </h3>
              <button
                type="button"
                onClick={() => setFieldGuideTopic(null)}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                aria-label="Close"
              >
                <FaTimes className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
              <IntelligenceFieldGuideTopic topic={fieldGuideTopic} />
            </div>
            <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setFieldGuideTopic(null)}
                className="w-full rounded-xl bg-teal-600 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-teal-700 dark:hover:bg-teal-500"
              >
                Done — continue editing
              </button>
            </div>
          </div>
        </div>
      )}

      <PatrollerPhotoPreview
        key={photoLightbox ? `criminal-photo-${photoLightbox.index}` : 'criminal-photo-closed'}
        open={!!photoLightbox}
        onClose={() => setPhotoLightbox(null)}
        name={displayData.primary_name?.trim() || 'Subject'}
        imageUrls={photoLightbox?.urls}
        initialIndex={photoLightbox?.index ?? 0}
      />
    </div>
  );
}