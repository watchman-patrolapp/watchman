import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { supabase } from '../supabase/client';
import toast from 'react-hot-toast';
import { 
  FaArrowLeft, 
  FaEdit, 
  FaUserSecret, 
  FaMapMarkerAlt, 
  FaCalendarAlt, 
  FaExclamationTriangle,
  FaPlus,
  FaTrash,
  FaSave,
  FaTimes,
  FaUpload
} from 'react-icons/fa';

export default function CriminalProfileDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
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

  // Check if we're in edit mode from URL query param
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const editMode = params.get('edit') === 'true';
    setIsEditing(editMode);
  }, [location]);

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
      setEditForm(data);

      // Fetch associates
      const { data: associatesData } = await supabase
        .from('profile_associates')
        .select('*, profile:associate_profile_id(*)')
        .eq('profile_id', id);
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

  const normalizePointForDb = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && v !== null) {
      const c = v.coordinates;
      if (Array.isArray(c) && c.length >= 2) return `(${c[0]},${c[1]})`;
      if (typeof v.x === 'number' && typeof v.y === 'number') return `(${v.x},${v.y})`;
    }
    return v;
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
        'first_identified_at', 'last_seen_at', 'last_seen_location', 'last_seen_coordinates',
        'gang_affiliation', 'criminal_organization'
      ];

      const updateData = {};
      for (const key of allowed) {
        if (!(key in editForm)) continue;
        let val = editForm[key];
        if (key === 'last_seen_coordinates') val = normalizePointForDb(val);
        if (key === 'status' && val === 'inactive') val = 'cleared';
        updateData[key] = val;
      }

      const { error } = await supabase
        .from('criminal_profiles')
        .update({
          ...updateData,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (error) throw error;
      
      toast.success('Profile updated successfully');
      setIsEditing(false);
      navigate(`/intelligence/profiles/${id}`, { replace: true });
      fetchProfile();
    } catch (err) {
      console.error('Update error:', err);
      toast.error('Failed to update profile: ' + (err.message || String(err)));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditForm(profile);
    setIsEditing(false);
    navigate(`/intelligence/profiles/${id}`, { replace: true });
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
      navigate('/intelligence');
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-6 text-center">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Profile Not Found</h2>
        <button 
          onClick={() => navigate('/intelligence')}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Intelligence home
        </button>
      </div>
    );
  }

  const displayData = isEditing ? editForm : profile;

  return (
    <div className="p-6 max-w-6xl mx-auto bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div className="flex items-center gap-4">
          <button 
            type="button"
            onClick={() => navigate('/intelligence')}
            className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
          >
            <FaArrowLeft /> Intelligence home
          </button>
          
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800">
            {isEditing ? 'Edit Profile' : displayData.primary_name}
          </h1>
        </div>

        <div className="flex gap-3">
          {!isEditing ? (
            <>
              <button 
                type="button"
                onClick={() => navigate(`/intelligence/profiles/${id}?edit=true`)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                <FaEdit /> Edit Profile
              </button>
              
              <button 
                type="button"
                onClick={handleDelete}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                <FaTrash /> Delete
              </button>
            </>
          ) : (
            <>
              <button 
                type="button"
                onClick={handleCancel}
                className="flex items-center gap-2 px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600"
              >
                <FaTimes /> Cancel
              </button>
              
              <button 
                type="button"
                onClick={handleSave}
                disabled={saving || photoUploadsPending > 0}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                <FaSave /> {saving ? 'Saving...' : photoUploadsPending > 0 ? 'Uploading photos...' : 'Save Changes'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Risk/Priority/Status Banner */}
      <div className="flex flex-wrap gap-2 mb-6">
        {isEditing ? (
          <>
            <select
              value={editForm.risk_level || 'medium'}
              onChange={(e) => updateField('risk_level', e.target.value)}
              className="px-4 py-2 rounded-full font-semibold text-sm border-2"
            >
              <option value="low">Risk: LOW</option>
              <option value="medium">Risk: MEDIUM</option>
              <option value="high">Risk: HIGH</option>
              <option value="critical">Risk: CRITICAL</option>
            </select>
            
            <select
              value={editForm.priority || 'routine'}
              onChange={(e) => updateField('priority', e.target.value)}
              className="px-4 py-2 rounded-full font-semibold text-sm border-2"
            >
              <option value="routine">Priority: ROUTINE</option>
              <option value="priority">Priority: PRIORITY</option>
              <option value="urgent">Priority: URGENT</option>
              <option value="immediate">Priority: IMMEDIATE</option>
            </select>
            
            <select
              value={editForm.status || 'active'}
              onChange={(e) => updateField('status', e.target.value)}
              className="px-4 py-2 rounded-full font-semibold text-sm border-2"
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
            <span className={`px-4 py-2 rounded-full font-semibold text-sm ${getRiskColor(displayData.risk_level)}`}>
              Risk: {displayData.risk_level?.toUpperCase()}
            </span>
            <span className={`px-4 py-2 rounded-full font-semibold text-sm ${getPriorityColor(displayData.priority)}`}>
              Priority: {displayData.priority?.toUpperCase()}
            </span>
            <span className={`px-4 py-2 rounded-full font-semibold text-sm ${getStatusColor(displayData.status)}`}>
              Status: {displayData.status?.toUpperCase()}
            </span>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Photos */}
          <section className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-lg font-semibold mb-4 text-gray-700">Photographs</h2>

            {isEditing && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Add photos from device</label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:border-blue-500 transition-colors cursor-pointer">
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
                    <FaUpload className="w-10 h-10 text-gray-400 mb-2" />
                    <span className="text-sm text-gray-600">Click to choose photos</span>
                    <span className="text-xs text-gray-400 mt-1">JPG, PNG, GIF up to 5MB</span>
                  </label>
                </div>
                {photoUploadsPending > 0 && (
                  <p className="text-sm text-blue-600 mt-2">Uploading…</p>
                )}
              </div>
            )}

            {displayData.photo_urls && displayData.photo_urls.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {displayData.photo_urls.map((url, index) => (
                  <div key={`${url}-${index}`} className="relative group">
                    <img 
                      src={url}
                      alt={`Profile ${index + 1}`}
                      className="w-full h-32 object-cover rounded-lg"
                    />
                    {isEditing && (
                      <button
                        type="button"
                        onClick={() => removePhotoAtIndex(index)}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1"
                      >
                        <FaTimes size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              !isEditing && (
                <div className="bg-gray-100 rounded-lg h-48 flex items-center justify-center text-gray-500">
                  No photos available
                </div>
              )
            )}
          </section>

          {/* Physical Description */}
          <section className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-lg font-semibold mb-4 text-gray-700">Physical Description</h2>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <span className="text-gray-600">Height:</span>
                {isEditing ? (
                  <input
                    type="number"
                    value={editForm.height_cm || ''}
                    onChange={(e) => updateField('height_cm', e.target.value ? parseInt(e.target.value) : null)}
                    className="border rounded px-2 py-1"
                    placeholder="cm"
                  />
                ) : (
                  <span className="font-medium">{displayData.height_cm ? `${displayData.height_cm} cm` : '-'}</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <span className="text-gray-600">Weight:</span>
                {isEditing ? (
                  <input
                    type="number"
                    value={editForm.weight_kg || ''}
                    onChange={(e) => updateField('weight_kg', e.target.value ? parseInt(e.target.value) : null)}
                    className="border rounded px-2 py-1"
                    placeholder="kg"
                  />
                ) : (
                  <span className="font-medium">{displayData.weight_kg ? `${displayData.weight_kg} kg` : '-'}</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <span className="text-gray-600">Build:</span>
                {isEditing ? (
                  <select
                    value={editForm.build_type || ''}
                    onChange={(e) => updateField('build_type', e.target.value || null)}
                    className="border rounded px-2 py-1"
                  >
                    <option value="">Select</option>
                    <option value="slim">Slim</option>
                    <option value="medium">Medium</option>
                    <option value="athletic">Athletic</option>
                    <option value="heavy">Heavy</option>
                    <option value="muscular">Muscular</option>
                  </select>
                ) : (
                  <span className="font-medium capitalize">{displayData.build_type || '-'}</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <span className="text-gray-600">Eye Color:</span>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.eye_color || ''}
                    onChange={(e) => updateField('eye_color', e.target.value || null)}
                    className="border rounded px-2 py-1"
                  />
                ) : (
                  <span className="font-medium capitalize">{displayData.eye_color || '-'}</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <span className="text-gray-600">Hair Color:</span>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.hair_color || ''}
                    onChange={(e) => updateField('hair_color', e.target.value || null)}
                    className="border rounded px-2 py-1"
                  />
                ) : (
                  <span className="font-medium capitalize">{displayData.hair_color || '-'}</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <span className="text-gray-600">Complexion:</span>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.complexion || ''}
                    onChange={(e) => updateField('complexion', e.target.value || null)}
                    className="border rounded px-2 py-1"
                  />
                ) : (
                  <span className="font-medium capitalize">{displayData.complexion || '-'}</span>
                )}
              </div>
            </div>
            
            {/* Distinguishing Marks */}
            <div className="mt-4">
              <h3 className="font-medium text-gray-700 mb-2">Distinguishing Marks:</h3>
              {isEditing ? (
                <div className="space-y-2">
                  {(editForm.distinguishing_marks || []).map((mark, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        type="text"
                        value={mark}
                        onChange={(e) => updateArrayField('distinguishing_marks', index, e.target.value)}
                        className="flex-1 border rounded px-2 py-1 text-sm"
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
                    className="text-sm text-blue-600 flex items-center gap-1"
                  >
                    <FaPlus size={12} /> Add Mark
                  </button>
                </div>
              ) : (
                displayData.distinguishing_marks?.length > 0 ? (
                  <ul className="list-disc list-inside text-sm text-gray-600">
                    {displayData.distinguishing_marks.map((mark, index) => (
                      <li key={index}>{mark}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-400">None recorded</p>
                )
              )}
            </div>
          </section>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Information */}
          <section className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-4 text-blue-600 border-b pb-2">Basic Information</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="text-sm text-gray-600">Primary Name</label>
                {isEditing ? (
                  <input 
                    type="text"
                    value={editForm.primary_name || ''}
                    onChange={(e) => updateField('primary_name', e.target.value)}
                    className="w-full border rounded px-3 py-2 mt-1 text-lg font-semibold"
                  />
                ) : (
                  <p className="text-lg font-semibold text-gray-800">{displayData.primary_name}</p>
                )}
              </div>

              <div>
                <label className="text-sm text-gray-600">Date of Birth</label>
                {isEditing ? (
                  <input
                    type="date"
                    value={editForm.date_of_birth || ''}
                    onChange={(e) => updateField('date_of_birth', e.target.value || null)}
                    className="w-full border rounded px-3 py-2 mt-1"
                  />
                ) : (
                  <p className="font-medium">
                    {displayData.date_of_birth 
                      ? new Date(displayData.date_of_birth).toLocaleDateString() 
                      : '-'}
                  </p>
                )}
              </div>

              <div>
                <label className="text-sm text-gray-600">Place of Birth</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.place_of_birth || ''}
                    onChange={(e) => updateField('place_of_birth', e.target.value || null)}
                    className="w-full border rounded px-3 py-2 mt-1"
                  />
                ) : (
                  <p className="font-medium">{displayData.place_of_birth || '-'}</p>
                )}
              </div>

              <div>
                <label className="text-sm text-gray-600">Gender</label>
                {isEditing ? (
                  <select
                    value={editForm.gender || ''}
                    onChange={(e) => updateField('gender', e.target.value || null)}
                    className="w-full border rounded px-3 py-2 mt-1"
                  >
                    <option value="">Select</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                    <option value="unknown">Unknown</option>
                  </select>
                ) : (
                  <p className="font-medium capitalize">{displayData.gender || '-'}</p>
                )}
              </div>

              <div>
                <label className="text-sm text-gray-600">Nationality</label>
                {isEditing ? (
                  <div className="space-y-2 mt-1">
                    {(editForm.nationality || []).map((nat, index) => (
                      <div key={index} className="flex gap-2">
                        <input
                          type="text"
                          value={nat}
                          onChange={(e) => updateArrayField('nationality', index, e.target.value)}
                          className="flex-1 border rounded px-2 py-1 text-sm"
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
                      className="text-sm text-blue-600 flex items-center gap-1"
                    >
                      <FaPlus size={12} /> Add
                    </button>
                  </div>
                ) : (
                  <p className="font-medium">
                    {displayData.nationality?.length > 0 
                      ? displayData.nationality.join(', ') 
                      : '-'}
                  </p>
                )}
              </div>
            </div>

            {/* Known Aliases */}
            <div className="mt-4">
              <label className="text-sm text-gray-600">Known Aliases</label>
              {isEditing ? (
                <div className="flex flex-wrap gap-2 mt-1">
                  {(editForm.known_aliases || []).map((alias, index) => (
                    <div key={index} className="flex items-center gap-1 bg-gray-100 px-2 py-1 rounded">
                      <input
                        type="text"
                        value={alias}
                        onChange={(e) => updateArrayField('known_aliases', index, e.target.value)}
                        className="bg-transparent border-none text-sm"
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
                    className="text-sm text-blue-600 flex items-center gap-1 px-2 py-1 border border-dashed border-blue-300 rounded"
                  >
                    <FaPlus size={12} /> Add
                  </button>
                </div>
              ) : (
                displayData.known_aliases?.length > 0 ? (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {displayData.known_aliases.map((alias, index) => (
                      <span key={index} className="bg-gray-100 px-3 py-1 rounded-full text-sm">
                        {alias}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400">No aliases recorded</p>
                )
              )}
            </div>
          </section>

          {/* Last Known Location */}
          <section className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-4 text-orange-600 border-b pb-2 flex items-center gap-2">
              <FaMapMarkerAlt /> Last Known Location
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-gray-600">Last Seen Date</label>
                {isEditing ? (
                  <input
                    type="date"
                    value={editForm.last_seen_at ? new Date(editForm.last_seen_at).toISOString().split('T')[0] : ''}
                    onChange={(e) => {
                      const time = editForm.last_seen_at 
                        ? new Date(editForm.last_seen_at).toTimeString().slice(0,5) 
                        : '00:00';
                      updateField('last_seen_at', e.target.value ? new Date(`${e.target.value}T${time}`).toISOString() : null);
                    }}
                    className="w-full border rounded px-3 py-2 mt-1"
                  />
                ) : (
                  <p className="font-medium">
                    {displayData.last_seen_at 
                      ? new Date(displayData.last_seen_at).toLocaleDateString() 
                      : '-'}
                  </p>
                )}
              </div>

              <div>
                <label className="text-sm text-gray-600">Last Seen Time</label>
                {isEditing ? (
                  <input
                    type="time"
                    value={editForm.last_seen_at ? new Date(editForm.last_seen_at).toTimeString().slice(0,5) : ''}
                    onChange={(e) => {
                      const date = editForm.last_seen_at 
                        ? new Date(editForm.last_seen_at).toISOString().split('T')[0] 
                        : new Date().toISOString().split('T')[0];
                      updateField('last_seen_at', new Date(`${date}T${e.target.value}`).toISOString());
                    }}
                    className="w-full border rounded px-3 py-2 mt-1"
                  />
                ) : (
                  <p className="font-medium">
                    {displayData.last_seen_at 
                      ? new Date(displayData.last_seen_at).toLocaleTimeString() 
                      : '-'}
                  </p>
                )}
              </div>

              <div className="md:col-span-2">
                <label className="text-sm text-gray-600">Location Description</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.last_seen_location || ''}
                    onChange={(e) => updateField('last_seen_location', e.target.value || null)}
                    className="w-full border rounded px-3 py-2 mt-1"
                  />
                ) : (
                  <p className="font-medium">{displayData.last_seen_location || '-'}</p>
                )}
              </div>
            </div>
          </section>

          {/* Criminal History */}
          <section className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-4 text-red-700 border-b pb-2 flex items-center gap-2">
              <FaExclamationTriangle /> Criminal History
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-sm text-gray-600">Gang Affiliation</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.gang_affiliation || ''}
                    onChange={(e) => updateField('gang_affiliation', e.target.value || null)}
                    className="w-full border rounded px-3 py-2 mt-1"
                  />
                ) : (
                  <p className="font-medium text-red-600">{displayData.gang_affiliation || '-'}</p>
                )}
              </div>

              <div>
                <label className="text-sm text-gray-600">Criminal Organization</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.criminal_organization || ''}
                    onChange={(e) => updateField('criminal_organization', e.target.value || null)}
                    className="w-full border rounded px-3 py-2 mt-1"
                  />
                ) : (
                  <p className="font-medium">{displayData.criminal_organization || '-'}</p>
                )}
              </div>
            </div>

            {/* Watchlist Flags */}
            <div className="mt-4">
              <h3 className="font-semibold text-red-600 mb-2 flex items-center gap-2">
                <FaExclamationTriangle /> Watchlist Flags
              </h3>
              {isEditing ? (
                <div className="flex flex-wrap gap-2">
                  {(editForm.watchlist_flags || []).map((flag, index) => (
                    <div key={index} className="flex items-center gap-1 bg-red-50 border border-red-200 px-2 py-1 rounded">
                      <input
                        type="text"
                        value={flag}
                        onChange={(e) => updateArrayField('watchlist_flags', index, e.target.value)}
                        className="bg-transparent border-none text-sm text-red-700"
                      />
                      <button
                        onClick={() => removeArrayItem('watchlist_flags', index)}
                        className="text-red-500"
                      >
                        <FaTimes size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => addArrayItem('watchlist_flags')}
                    className="text-sm text-red-600 flex items-center gap-1 px-2 py-1 border border-dashed border-red-300 rounded"
                  >
                    <FaPlus size={12} /> Add Flag
                  </button>
                </div>
              ) : (
                displayData.watchlist_flags?.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {displayData.watchlist_flags.map((flag, index) => (
                      <span key={index} className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-sm font-medium">
                        {flag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400">No watchlist flags</p>
                )
              )}
            </div>
          </section>

          {/* Linked Incidents */}
          {incidents.length > 0 && (
            <section className="bg-white p-6 rounded-lg shadow-md">
              <h2 className="text-xl font-semibold mb-4 text-purple-600 border-b pb-2">
                Linked Incidents ({incidents.length})
              </h2>
              <div className="space-y-3">
                {incidents.map((link) => (
                  <div 
                    key={link.id} 
                    className="border rounded-lg p-4 hover:bg-gray-50 cursor-pointer"
                    onClick={() => navigate(`/incidents/${link.incidents.id}`)}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold text-gray-800">{link.incidents.title}</h3>
                        <p className="text-sm text-gray-600">{link.incidents.description?.substring(0, 100)}...</p>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        link.incidents.priority === 'high' ? 'bg-red-100 text-red-700' :
                        link.incidents.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-green-100 text-green-700'
                      }`}>
                        {link.incidents.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">
                      Linked: {new Date(link.linked_at).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Associates */}
          {associates.length > 0 && (
            <section className="bg-white p-6 rounded-lg shadow-md">
              <h2 className="text-xl font-semibold mb-4 text-blue-600 border-b pb-2 flex items-center gap-2">
                <FaUserSecret /> Known Associates ({associates.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {associates.map((assoc) => (
                  <div 
                    key={assoc.id}
                    className="border rounded-lg p-3 hover:bg-gray-50 cursor-pointer"
                    onClick={() => navigate(`/intelligence/profiles/${assoc.profile.id}`)}
                  >
                    <p className="font-semibold">{assoc.profile.primary_name}</p>
                    <p className="text-sm text-gray-600 capitalize">{assoc.relationship_type}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}