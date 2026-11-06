import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { useActiveOrganization } from '../../auth/useActiveOrganization';
import { supabase } from '../../supabase/client';
import { safeInternalReturnPath } from '../../utils/safeReturnPath';
import toast from '../../utils/notify';
import { fetchAssociatesBidirectional } from '../../utils/profileAssociates';
import {
  initialSightingsLogForForm,
} from '../../utils/criminalProfileSightings';
import { removeCriminalPhoto } from '../../utils/criminalPhotos';
import { collectUserIdsFromProfiles, fetchUserLabelMap } from '../../utils/profileUserLabels';
import { belongsToActiveOrganization, scopeToOrganization, shouldIncludeUnscopedProfiles } from '../../utils/organizationScope';
import {
  buildProfileUpdatePayload,
  excludeAlreadyLinkedProfiles,
  profileDeleteErrorHint,
} from './profileDetailModel';

export function useCriminalProfileDetail() {
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
  const { activeOrganizationId, activeOrganization } = useActiveOrganization();
  const includeUnscoped = shouldIncludeUnscopedProfiles(activeOrganization);

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
  const loadGen = useRef(0);

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
        const { data, error } = await scopeToOrganization(
          supabase
            .from('criminal_profiles')
            .select('id, primary_name, risk_level, status, photo_urls'),
          activeOrganizationId,
          includeUnscoped
        )
          .neq('id', id)
          .ilike('primary_name', `%${q}%`)
          .limit(12);
        if (error) throw error;
        setAssociateSearchResults(excludeAlreadyLinkedProfiles(data, associatesDraft));
      } catch (e) {
        console.error(e);
        toast.error('Could not search profiles');
        setAssociateSearchResults([]);
      } finally {
        setAssociateSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [associateSearchQuery, location.search, id, associatesDraft, activeOrganizationId, includeUnscoped]);

  const fetchProfile = useCallback(async () => {
    const gen = ++loadGen.current;
    try {
      setLoading(true);
      const { data, error } = await scopeToOrganization(
        supabase.from('criminal_profiles').select('*'),
        activeOrganizationId,
        includeUnscoped
      )
        .eq('id', id)
        .maybeSingle();

      if (gen !== loadGen.current) return;
      if (error) throw error;
      if (!data || !belongsToActiveOrganization(data, activeOrganizationId, includeUnscoped)) {
        setProfile(null);
        toast.error('This profile is not in the selected area.');
        navigate('/intelligence/search', { replace: true });
        return;
      }

      setProfile(data);
      setEditForm({ ...data, sightings_log: initialSightingsLogForForm(data) });

      const auditIds = collectUserIdsFromProfiles([data]);
      const labelMap = await fetchUserLabelMap(supabase, auditIds);
      if (gen !== loadGen.current) return;
      setAuditUserLabels(labelMap);

      let associatesData = [];
      try {
        associatesData = await fetchAssociatesBidirectional(supabase, id);
      } catch (assocErr) {
        console.error('Associates fetch:', assocErr);
      }
      if (gen !== loadGen.current) return;
      setAssociates(associatesData || []);

      const { data: incidentsData } = await supabase
        .from('profile_incidents')
        .select('*, incidents(*)')
        .eq('profile_id', id)
        .order('linked_at', { ascending: false });
      if (gen !== loadGen.current) return;
      setIncidents(incidentsData || []);
    } catch (err) {
      if (gen !== loadGen.current) return;
      console.error('Error fetching profile:', err);
      toast.error('Failed to load profile');
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [id, activeOrganizationId, includeUnscoped, navigate]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

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

  const handleSave = async () => {
    if (saving) return;
    if (photoUploadsPending > 0) {
      toast.error('Please wait for photo uploads to finish');
      return;
    }
    try {
      setSaving(true);

      const updateData = buildProfileUpdatePayload(editForm);

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
      toast.error('Failed to delete profile: ' + msg + profileDeleteErrorHint(msg));
    } finally {
      deleteInFlightRef.current = false;
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
        await removeCriminalPhoto(url);
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

  const displayData = isEditing ? editForm : profile;

  return {
    id,
    navigate,
    backTarget,
    backLabel,
    buildProfilePath,
    profile,
    loading,
    associates,
    incidents,
    isEditing,
    editForm,
    saving,
    photoUploadsPending,
    fieldGuideTopic,
    setFieldGuideTopic,
    associatesDraft,
    associateSearchQuery,
    setAssociateSearchQuery,
    associateSearchResults,
    associateSearchLoading,
    photoLightbox,
    setPhotoLightbox,
    auditUserLabels,
    displayData,
    handleSave,
    handleCancel,
    handleDelete,
    updateField,
    handleEditPhotoSelect,
    removePhotoAtIndex,
    updateArrayField,
    addArrayItem,
    removeArrayItem,
    setWatchlistFlagsForEdit,
    addAssociateFromSearch,
    removeAssociateDraftRow,
    updateAssociateDraftField,
  };
}
