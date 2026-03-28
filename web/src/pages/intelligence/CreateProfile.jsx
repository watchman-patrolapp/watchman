import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { supabase } from '../../supabase/client';
import { safeInternalReturnPath } from '../../utils/safeReturnPath';
import MoTemplatePicker from '../../components/intelligence/MoTemplatePicker';
import WatchlistTemplatePicker from '../../components/intelligence/WatchlistTemplatePicker';
import toast from 'react-hot-toast';
import { FaPlus, FaTimes, FaUpload, FaArrowLeft } from 'react-icons/fa';

export default function CreateProfile() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = safeInternalReturnPath(searchParams.get('returnTo'));
  const descriptionHint = searchParams.get('description') || '';
  const hintName = searchParams.get('hintName') || '';
  const { user } = useAuth();
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  
  // Basic Information
  const [primaryName, setPrimaryName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [placeOfBirth, setPlaceOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [nationality, setNationality] = useState(['']);
  
  // Physical Description
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [buildType, setBuildType] = useState('');
  const [eyeColor, setEyeColor] = useState('');
  const [hairColor, setHairColor] = useState('');
  const [complexion, setComplexion] = useState('');
  const [distinguishingMarks, setDistinguishingMarks] = useState(['']);
  
  // Risk & Status
  const [riskLevel, setRiskLevel] = useState('medium');
  const [status, setStatus] = useState('active');
  const [priority, setPriority] = useState('routine'); // ✅ CORRECT: 'routine', 'priority', 'urgent', 'immediate'
  const [watchlistFlags, setWatchlistFlags] = useState(['']);
  
  // Identity
  const [knownAliases, setKnownAliases] = useState(['']);
  const [idNumbers, setIdNumbers] = useState([{ type: '', number: '' }]);
  
  // Location - SEPARATED DATE AND TIME
  const [lastSeenDate, setLastSeenDate] = useState('');
  const [lastSeenTime, setLastSeenTime] = useState('');
  const [lastSeenLocation, setLastSeenLocation] = useState('');
  const [lastSeenCoordinates, setLastSeenCoordinates] = useState({ lat: '', lng: '' });
  
  // Criminal History
  const [gangAffiliation, setGangAffiliation] = useState('');
  const [criminalOrganization, setCriminalOrganization] = useState('');
  const [moSignature, setMoSignature] = useState({ methods: [], patterns: '', notes: '' });
  
  // Photos - file upload only (stored in criminal-photos bucket)
  const [photos, setPhotos] = useState([]); // Array of { file: File, preview: string, url: string, uploading: boolean }

  // Helper functions for array fields
  const addArrayField = (setter, current) => setter([...current, '']);
  const updateArrayField = (setter, current, index, value) => {
    const newArray = [...current];
    newArray[index] = value;
    setter(newArray);
  };
  const removeArrayField = (setter, current, index) => {
    setter(current.filter((_, i) => i !== index));
  };

  // Helper for ID numbers (object array)
  const addIdNumber = () => setIdNumbers([...idNumbers, { type: '', number: '' }]);
  const updateIdNumber = (index, field, value) => {
    const newIds = [...idNumbers];
    newIds[index][field] = value;
    setIdNumbers(newIds);
  };
  const removeIdNumber = (index) => setIdNumbers(idNumbers.filter((_, i) => i !== index));

  useEffect(() => {
    if (!descriptionHint.trim()) return;
    setDistinguishingMarks((prev) => {
      if (prev.length === 1 && !prev[0]?.trim()) return [descriptionHint];
      return prev;
    });
  }, [descriptionHint]);

  useEffect(() => {
    if (!hintName.trim()) return;
    setPrimaryName((prev) => (prev.trim() ? prev : hintName.trim()));
  }, [hintName]);

  // Combine date and time into ISO string for database
  const getLastSeenDateTime = () => {
    if (!lastSeenDate) return null;
    if (lastSeenTime) {
      return new Date(`${lastSeenDate}T${lastSeenTime}`).toISOString();
    }
    return new Date(`${lastSeenDate}T00:00:00`).toISOString();
  };

  // Photo upload handler
  const handlePhotoSelect = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    // Validate files
    const validFiles = files.filter(file => {
      if (!file.type.startsWith('image/')) {
        toast.error(`${file.name} is not an image file`);
        return false;
      }
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast.error(`${file.name} is too large (max 5MB)`);
        return false;
      }
      return true;
    });

    // Create preview entries
    const newPhotos = validFiles.map(file => ({
      file,
      preview: URL.createObjectURL(file),
      url: '',
      uploading: true
    }));

    setPhotos(prev => [...prev, ...newPhotos]);

    // Upload each file
    for (let i = 0; i < newPhotos.length; i++) {
      const photo = newPhotos[i];
      const photoIndex = photos.length + i;
      
      try {
        const fileExt = photo.file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `criminal-profiles/${user.id}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('criminal-photos')
          .upload(filePath, photo.file, {
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('criminal-photos')
          .getPublicUrl(filePath);

        // Update photo with URL
        setPhotos(prev => {
          const updated = [...prev];
          updated[photoIndex] = {
            ...updated[photoIndex],
            url: publicUrl,
            uploading: false
          };
          return updated;
        });

        toast.success(`${photo.file.name} uploaded successfully`);
      } catch (err) {
        console.error('Upload error:', err);
        toast.error(`Failed to upload ${photo.file.name}: ${err.message}`);
        
        // Remove failed upload from list
        setPhotos(prev => prev.filter((_, idx) => idx !== photoIndex));
      }
    }
  };

  // Remove photo
  const removePhoto = async (index) => {
    const photo = photos[index];
    
    // If uploaded to storage, delete it
    if (photo.url && !photo.uploading) {
      try {
        const path = photo.url.split('/criminal-photos/')[1];
        if (path) {
          await supabase.storage.from('criminal-photos').remove([path]);
        }
      } catch (err) {
        console.error('Error deleting file:', err);
      }
    }

    // Revoke object URL to free memory
    if (photo.preview) {
      URL.revokeObjectURL(photo.preview);
    }

    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!primaryName.trim()) {
      toast.error('Primary Name is required');
      return;
    }

    // Check if any photos are still uploading
    if (photos.some(p => p.uploading)) {
      toast.error('Please wait for all photos to finish uploading');
      return;
    }

    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const authUid = sessionData?.session?.user?.id;
      if (!authUid) {
        toast.error('Session expired; sign in again.');
        return;
      }

      const allPhotoUrls = photos.map(p => p.url).filter(Boolean);

      const { data, error } = await supabase
        .from('criminal_profiles')
        .insert({
          // Basic Information
          primary_name: primaryName,
          date_of_birth: dateOfBirth || null,
          place_of_birth: placeOfBirth || null,
          gender: gender || null,
          nationality: nationality.filter(n => n.trim()),
          
          // Physical Description
          height_cm: height ? parseInt(height) : null,
          weight_kg: weight ? parseInt(weight) : null,
          build_type: buildType || null,
          eye_color: eyeColor || null,
          hair_color: hairColor || null,
          complexion: complexion || null,
          distinguishing_marks: distinguishingMarks.filter(m => m.trim()),
          
          // Risk & Status
          risk_level: riskLevel,
          status: status,
          priority: priority, // ✅ Now uses correct values: 'routine', 'priority', 'urgent', 'immediate'
          watchlist_flags: watchlistFlags.filter(f => f.trim()),
          
          // Identity
          known_aliases: knownAliases.filter(a => a.trim()),
          id_numbers: idNumbers.filter(id => id.type && id.number),
          
          // Location
          last_seen_at: getLastSeenDateTime(), // ✅ Uses combined date + time
          last_seen_location: lastSeenLocation || null,
          last_seen_coordinates: lastSeenCoordinates.lat && lastSeenCoordinates.lng 
            ? `(${lastSeenCoordinates.lat},${lastSeenCoordinates.lng})` 
            : null,
          
          // Criminal History
          gang_affiliation: gangAffiliation || null,
          criminal_organization: criminalOrganization || null,
          mo_signature: moSignature.methods.length > 0 || moSignature.patterns || moSignature.notes 
            ? {
                methods: moSignature.methods.filter(m => m.trim()),
                patterns: moSignature.patterns || null,
                notes: moSignature.notes || null
              } 
            : null,
          
          // Media
          photo_urls: allPhotoUrls,
          
          // Metadata (must match auth.uid() for RLS delete-as-creator)
          created_by: authUid,
          first_identified_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      if (returnTo) {
        toast.success('Profile saved. Use Search existing profiles on the report to link this suspect.');
        navigate(returnTo, {
          state: { createdProfileId: data.id, createdProfileName: data.primary_name },
        });
      } else {
        toast.success('Criminal profile created successfully!');
        navigate(`/intelligence/profiles/${data.id}`);
      }
    } catch (err) {
      console.error('Profile creation error:', err);
      toast.error('Failed to create profile: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto bg-gray-50 min-h-screen">
      {returnTo && (
        <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          Opened from an incident report: your report text is auto-saved.{" "}
          <strong>Resume incident report</strong> brings you back; re-attach any photos that were not yet
          submitted.
        </div>
      )}
      {/* Header */}
      <div className="mb-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {returnTo && (
            <button
              type="button"
              onClick={() => navigate(returnTo)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
            >
              <FaArrowLeft /> Resume incident report
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate('/intelligence')}
            className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
          >
            <FaArrowLeft /> Intelligence home
          </button>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Create Criminal Profile</h1>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        
        {/* Basic Information Section */}
        <section className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4 text-blue-600 border-b pb-2">Basic Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Primary Name *</label>
              <input 
                type="text" 
                value={primaryName}
                onChange={(e) => setPrimaryName(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500"
                required
                placeholder="Full legal name"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
              <input 
                type="date" 
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Place of Birth</label>
              <input 
                type="text" 
                value={placeOfBirth}
                onChange={(e) => setPlaceOfBirth(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="City, Country"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
              <select 
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="">Select Gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>

            {/* ✅ CORRECTED PRIORITY FIELD */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority *</label>
              <select 
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                required
              >
                <option value="routine">Routine</option>
                <option value="priority">Priority</option>
                <option value="urgent">Urgent</option>
                <option value="immediate">Immediate</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">Select case priority level</p>
            </div>
          </div>

          {/* Nationality */}
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Nationality</label>
            {nationality.map((nat, index) => (
              <div key={index} className="flex gap-2 mb-2">
                <input 
                  type="text" 
                  value={nat}
                  onChange={(e) => updateArrayField(setNationality, nationality, index, e.target.value)}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2"
                  placeholder="e.g., South African"
                />
                {nationality.length > 1 && (
                  <button 
                    type="button"
                    onClick={() => removeArrayField(setNationality, nationality, index)}
                    className="px-3 py-2 bg-red-100 text-red-600 rounded-md hover:bg-red-200"
                  >
                    <FaTimes />
                  </button>
                )}
              </div>
            ))}
            <button 
              type="button"
              onClick={() => addArrayField(setNationality, nationality)}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
            >
              <FaPlus size={12} /> Add Nationality
            </button>
          </div>

          {/* Known Aliases */}
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Known Aliases</label>
            {knownAliases.map((alias, index) => (
              <div key={index} className="flex gap-2 mb-2">
                <input 
                  type="text" 
                  value={alias}
                  onChange={(e) => updateArrayField(setKnownAliases, knownAliases, index, e.target.value)}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2"
                  placeholder={`Alias ${index + 1}`}
                />
                {knownAliases.length > 1 && (
                  <button 
                    type="button"
                    onClick={() => removeArrayField(setKnownAliases, knownAliases, index)}
                    className="px-3 py-2 bg-red-100 text-red-600 rounded-md hover:bg-red-200"
                  >
                    <FaTimes />
                  </button>
                )}
              </div>
            ))}
            <button 
              type="button"
              onClick={() => addArrayField(setKnownAliases, knownAliases)}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
            >
              <FaPlus size={12} /> Add Alias
            </button>
          </div>
        </section>

        {/* Risk Assessment */}
        <section className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4 text-red-600 border-b pb-2">Risk Assessment</h2>
          <p className="mb-4 text-xs text-gray-500">
            Unsure about risk vs priority, status, flags, or MO?{' '}
            <button
              type="button"
              onClick={() => navigate('/intelligence/search')}
              className="font-medium text-indigo-600 underline hover:text-indigo-800"
            >
              Open the Intelligence field guide
            </button>
            .
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Risk Level</label>
              <select 
                value={riskLevel}
                onChange={(e) => setRiskLevel(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select 
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="active">Active</option>
                <option value="cleared">Inactive (cleared)</option>
                <option value="incarcerated">Incarcerated</option>
                <option value="deceased">Deceased</option>
                <option value="wanted">Wanted</option>
              </select>
            </div>
          </div>

          {/* Watchlist Flags */}
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Watchlist Flags</label>
            <WatchlistTemplatePicker watchlistFlags={watchlistFlags} setWatchlistFlags={setWatchlistFlags} />
            {watchlistFlags.map((flag, index) => (
              <div key={index} className="flex gap-2 mb-2">
                <input 
                  type="text" 
                  value={flag}
                  onChange={(e) => updateArrayField(setWatchlistFlags, watchlistFlags, index, e.target.value)}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2"
                  placeholder="e.g., Violent, Armed, Flight Risk"
                />
                {watchlistFlags.length > 1 && (
                  <button 
                    type="button"
                    onClick={() => removeArrayField(setWatchlistFlags, watchlistFlags, index)}
                    className="px-3 py-2 bg-red-100 text-red-600 rounded-md hover:bg-red-200"
                  >
                    <FaTimes />
                  </button>
                )}
              </div>
            ))}
            <button 
              type="button"
              onClick={() => addArrayField(setWatchlistFlags, watchlistFlags)}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
            >
              <FaPlus size={12} /> Add Flag
            </button>
          </div>
        </section>

        {/* Physical Description */}
        <section className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4 text-green-600 border-b pb-2">Physical Description</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Height (cm)</label>
              <input 
                type="number" 
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="175"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Weight (kg)</label>
              <input 
                type="number" 
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="70"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Build</label>
              <select 
                value={buildType}
                onChange={(e) => setBuildType(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="">Select</option>
                <option value="slim">Slim</option>
                <option value="medium">Medium</option>
                <option value="athletic">Athletic</option>
                <option value="heavy">Heavy</option>
                <option value="muscular">Muscular</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Eye Color</label>
              <input 
                type="text" 
                value={eyeColor}
                onChange={(e) => setEyeColor(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="Brown"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hair Color</label>
              <input 
                type="text" 
                value={hairColor}
                onChange={(e) => setHairColor(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="Black"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Complexion</label>
              <input 
                type="text" 
                value={complexion}
                onChange={(e) => setComplexion(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="Fair/Dark/Medium"
              />
            </div>
          </div>

          {/* Distinguishing Marks */}
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Distinguishing Marks</label>
            {distinguishingMarks.map((mark, index) => (
              <div key={index} className="flex gap-2 mb-2">
                <input 
                  type="text" 
                  value={mark}
                  onChange={(e) => updateArrayField(setDistinguishingMarks, distinguishingMarks, index, e.target.value)}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2"
                  placeholder="Tattoo, scar, birthmark description"
                />
                {distinguishingMarks.length > 1 && (
                  <button 
                    type="button"
                    onClick={() => removeArrayField(setDistinguishingMarks, distinguishingMarks, index)}
                    className="px-3 py-2 bg-red-100 text-red-600 rounded-md hover:bg-red-200"
                  >
                    <FaTimes />
                  </button>
                )}
              </div>
            ))}
            <button 
              type="button"
              onClick={() => addArrayField(setDistinguishingMarks, distinguishingMarks)}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
            >
              <FaPlus size={12} /> Add Mark
            </button>
          </div>
        </section>

        {/* Identity Documents */}
        <section className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4 text-purple-600 border-b pb-2">Identity Documents</h2>
          {idNumbers.map((id, index) => (
            <div key={index} className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2 p-3 border border-gray-200 rounded-md">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">ID Type</label>
                <select
                  value={id.type}
                  onChange={(e) => updateIdNumber(index, 'type', e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                >
                  <option value="">Select Type</option>
                  <option value="passport">Passport</option>
                  <option value="national_id">National ID</option>
                  <option value="drivers_license">Driver's License</option>
                  <option value="social_security">Social Security</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="md:col-span-2 flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Number</label>
                  <input 
                    type="text" 
                    value={id.number}
                    onChange={(e) => updateIdNumber(index, 'number', e.target.value)}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                    placeholder="Document number"
                  />
                </div>
                {idNumbers.length > 1 && (
                  <button 
                    type="button"
                    onClick={() => removeIdNumber(index)}
                    className="self-end px-2 py-1 text-red-600 hover:bg-red-100 rounded"
                  >
                    <FaTimes />
                  </button>
                )}
              </div>
            </div>
          ))}
          <button 
            type="button"
            onClick={addIdNumber}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
          >
            <FaPlus size={12} /> Add ID Document
          </button>
        </section>

        {/* Last Known Location - SEPARATED DATE AND TIME */}
        <section className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4 text-orange-600 border-b pb-2">Last Known Location</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Date Field */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last Seen Date</label>
              <input 
                type="date" 
                value={lastSeenDate}
                onChange={(e) => setLastSeenDate(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              />
            </div>

            {/* Time Field - Separate */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last Seen Time</label>
              <input 
                type="time" 
                value={lastSeenTime}
                onChange={(e) => setLastSeenTime(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              />
              <p className="text-xs text-gray-500 mt-1">Optional - leave blank if time unknown</p>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Location Description</label>
              <input 
                type="text" 
                value={lastSeenLocation}
                onChange={(e) => setLastSeenLocation(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="Street address, landmark, or location name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Latitude</label>
              <input 
                type="number" 
                step="any"
                value={lastSeenCoordinates.lat}
                onChange={(e) => setLastSeenCoordinates({...lastSeenCoordinates, lat: e.target.value})}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="-33.9249"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
              <input 
                type="number" 
                step="any"
                value={lastSeenCoordinates.lng}
                onChange={(e) => setLastSeenCoordinates({...lastSeenCoordinates, lng: e.target.value})}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="18.4241"
              />
            </div>
          </div>
        </section>

        {/* Criminal History */}
        <section className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4 text-red-700 border-b pb-2">Criminal History & Intelligence</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Gang Affiliation</label>
              <input 
                type="text" 
                value={gangAffiliation}
                onChange={(e) => setGangAffiliation(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="Gang name or street gang"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Criminal Organization</label>
              <input 
                type="text" 
                value={criminalOrganization}
                onChange={(e) => setCriminalOrganization(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="Organized crime group"
              />
            </div>
          </div>

          {/* Modus Operandi */}
          <div className="mb-4 p-4 bg-gray-50 rounded-md">
            <label className="block text-sm font-medium text-gray-700 mb-2">Modus Operandi (MO)</label>
            <MoTemplatePicker moSignature={moSignature} setMoSignature={setMoSignature} />

            <div className="mb-2">
              <label className="block text-xs text-gray-600 mb-1">Methods</label>
              {moSignature.methods.map((method, index) => (
                <div key={index} className="flex gap-2 mb-1">
                  <input 
                    type="text" 
                    value={method}
                    onChange={(e) => {
                      const newMethods = [...moSignature.methods];
                      newMethods[index] = e.target.value;
                      setMoSignature({...moSignature, methods: newMethods});
                    }}
                    className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                    placeholder="Method of operation"
                  />
                  {moSignature.methods.length > 1 && (
                    <button 
                      type="button"
                      onClick={() => {
                        const newMethods = moSignature.methods.filter((_, i) => i !== index);
                        setMoSignature({...moSignature, methods: newMethods});
                      }}
                      className="px-2 text-red-600 hover:bg-red-100 rounded"
                    >
                      <FaTimes size={12} />
                    </button>
                  )}
                </div>
              ))}
              <button 
                type="button"
                onClick={() => setMoSignature({...moSignature, methods: [...moSignature.methods, '']})}
                className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                <FaPlus size={10} /> Add Method
              </button>
            </div>

            <div className="mb-2">
              <label className="block text-xs text-gray-600 mb-1">Patterns</label>
              <input 
                type="text" 
                value={moSignature.patterns}
                onChange={(e) => setMoSignature({...moSignature, patterns: e.target.value})}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                placeholder="Behavioral patterns"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-600 mb-1">Notes</label>
              <textarea 
                value={moSignature.notes}
                onChange={(e) => setMoSignature({...moSignature, notes: e.target.value})}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                rows="2"
                placeholder="Additional MO notes"
              />
            </div>
          </div>
        </section>

        {/* Photos Section - ENHANCED WITH FILE UPLOAD */}
        <section className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4 text-gray-600 border-b pb-2">Photographs</h2>
          
          {/* File Upload Area */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Photos from device</label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-500 transition-colors cursor-pointer">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handlePhotoSelect}
                accept="image/*"
                multiple
                className="hidden"
                id="photo-upload"
              />
              <label 
                htmlFor="photo-upload" 
                className="cursor-pointer flex flex-col items-center"
              >
                <FaUpload className="w-12 h-12 text-gray-400 mb-2" />
                <span className="text-sm text-gray-600">Click to upload photos</span>
                <span className="text-xs text-gray-400 mt-1">JPG, PNG, GIF up to 5MB</span>
              </label>
            </div>
          </div>

          {/* Photo Previews */}
          {photos.length > 0 && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Uploaded Photos</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {photos.map((photo, index) => (
                  <div key={index} className="relative group">
                    <div className="aspect-square rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
                      {photo.uploading ? (
                        <div className="w-full h-full flex items-center justify-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        </div>
                      ) : (
                        <img 
                          src={photo.preview} 
                          alt={`Upload ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removePhoto(index)}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                      disabled={photo.uploading}
                    >
                      <FaTimes size={12} />
                    </button>
                    {photo.uploading && (
                      <span className="absolute bottom-1 left-1 text-xs text-blue-600 bg-white px-2 py-1 rounded">
                        Uploading...
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Action Buttons */}
        <div className="flex gap-4 justify-end sticky bottom-6 bg-gray-50 p-4 rounded-lg shadow-lg border border-gray-200">
          <button 
            type="button" 
            onClick={() => navigate('/intelligence')} 
            className="px-6 py-3 border border-gray-300 rounded-md hover:bg-gray-100 font-medium text-gray-700"
          >
            Cancel
          </button>
          <button 
            type="submit" 
            disabled={loading || photos.some(p => p.uploading)} 
            className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-md"
          >
            {loading ? 'Creating Profile...' : photos.some(p => p.uploading) ? 'Uploading Photos...' : 'Create Criminal Profile'}
          </button>
        </div>
      </form>
    </div>
  );
}