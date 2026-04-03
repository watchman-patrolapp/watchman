import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { supabase } from '../../supabase/client';
import { safeInternalReturnPath } from '../../utils/safeReturnPath';
import MoTemplatePicker from '../../components/intelligence/MoTemplatePicker';
import WatchlistTemplatePicker from '../../components/intelligence/WatchlistTemplatePicker';
import {
  IntelligenceFieldGuideTopic,
  FieldGuideExplainerLink,
  FIELD_GUIDE_TOPIC_TITLES,
} from '../../components/intelligence/IntelligenceFieldGuide';
import {
  CONVICTION_HISTORY_SUMMARY_OPTIONS,
  CRIMINAL_JUSTICE_STATUS_OPTIONS,
  LEGAL_RECORD_INTELLIGENCE_NOTE,
} from '../../data/intelligenceTaxonomy';
import toast from 'react-hot-toast';
import { FaPlus, FaTimes, FaUpload, FaArrowLeft, FaExpand } from 'react-icons/fa';
import ThemeToggle from '../../components/ThemeToggle';
import PatrollerPhotoPreview from '../../components/patrol/PatrollerPhotoPreview';
import SightingsLogEditor from '../../components/intelligence/SightingsLogEditor';
import {
  emptySightingTemplate,
  sanitizeSightingsLogForDb,
  syncLegacyLastSeenFromSightings,
} from '../../utils/criminalProfileSightings';

/** Same field shell as `IncidentForm` (Report an Incident) */
const formInput =
  'w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2.5 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition';
const formInputSm =
  'w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition';
const formFlexInputSm = `flex-1 ${formInputSm}`;
const formSelectSm =
  'w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent transition';
const formTextarea = `${formInputSm} resize-y`;
const formLabel = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';
const formLabelBlock = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2';
const formLabelXs = 'block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1';

function SectionCard({ title, children }) {
  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-5">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">{title}</h2>
      {children}
    </div>
  );
}

export default function CreateProfile() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = safeInternalReturnPath(searchParams.get('returnTo'));
  const descriptionHint = searchParams.get('description') || '';
  const hintName = searchParams.get('hintName') || '';
  const { user } = useAuth();
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [fieldGuideTopic, setFieldGuideTopic] = useState(null);
  const [photoLightbox, setPhotoLightbox] = useState(null);
  
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
  
  // Location
  const [commonPresence, setCommonPresence] = useState('');
  const [residenceLastKnown, setResidenceLastKnown] = useState('');
  const [sightingsLog, setSightingsLog] = useState([]);
  
  // Criminal History
  const [gangAffiliation, setGangAffiliation] = useState('');
  const [criminalOrganization, setCriminalOrganization] = useState('');
  const [convictionHistorySummary, setConvictionHistorySummary] = useState('unknown');
  const [criminalJusticeStatus, setCriminalJusticeStatus] = useState('unknown');
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

  const prefillFromIncidentRef = useRef(false);

  useEffect(() => {
    if (prefillFromIncidentRef.current) return;
    const incidentId = searchParams.get('incident');
    const evidenceId = searchParams.get('evidence');
    if (!incidentId || !evidenceId) return;

    prefillFromIncidentRef.current = true;

    (async () => {
      try {
        const [{ data: inc, error: incErr }, { data: ev, error: evErr }] = await Promise.all([
          supabase.from('incidents').select('*').eq('id', incidentId).single(),
          supabase.from('incident_evidence').select('*').eq('id', evidenceId).single(),
        ]);

        if (incErr || !inc) {
          console.warn('Prefill: incident load failed', incErr);
          prefillFromIncidentRef.current = false;
          return;
        }
        if (evErr || !ev) {
          console.warn('Prefill: evidence load failed', evErr);
          prefillFromIncidentRef.current = false;
          return;
        }
        if (String(ev.incident_id) !== String(inc.id)) {
          toast.error('That evidence does not belong to the selected incident.');
          prefillFromIncidentRef.current = false;
          return;
        }

        const row = emptySightingTemplate();
        if (inc.location) row.location = inc.location;
        if (inc.incident_date) {
          const d = String(inc.incident_date).slice(0, 10);
          row.seen_at = new Date(`${d}T12:00:00`).toISOString();
        }
        if (row.location || row.seen_at) setSightingsLog([row]);

        const desc = (ev.description || '').trim();
        if (desc) {
          setDistinguishingMarks((prev) => {
            if (prev.length === 1 && !prev[0]?.trim()) return [desc];
            return prev.some((p) => p?.trim() === desc) ? prev : [...prev, desc];
          });
        } else {
          setDistinguishingMarks((prev) => {
            if (prev.length === 1 && !prev[0]?.trim()) {
              return ['Photo from incident report — add clothing, height, marks, etc. as you learn more.'];
            }
            return prev;
          });
        }

        setPrimaryName((prev) => (prev.trim() ? prev : 'Unknown subject'));

        setMoSignature((prev) => ({
          ...prev,
          notes:
            prev.notes?.trim() ||
            [inc.type && `Incident type: ${inc.type}`, inc.location && `Location: ${inc.location}`, inc.description && `Report: ${inc.description.slice(0, 500)}`]
              .filter(Boolean)
              .join('\n'),
        }));

        const urls = Array.isArray(ev.media_urls) ? ev.media_urls.filter(Boolean) : [];
        if (urls.length > 0) {
          setPhotos(
            urls.map((url) => ({
              file: null,
              preview: url,
              url,
              uploading: false,
              fromIncident: true,
            }))
          );
        }

        toast.success('Loaded details from your incident report. Review fields, then save the profile.');
      } catch (err) {
        console.error('Prefill from incident failed', err);
        prefillFromIncidentRef.current = false;
      }
    })();
  }, [searchParams]);

  useEffect(() => {
    if (fieldGuideTopic == null) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setFieldGuideTopic(null);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [fieldGuideTopic]);

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

    if (photo.url && !photo.uploading && photo.file && photo.url.includes('/criminal-photos/')) {
      try {
        const path = photo.url.split('/criminal-photos/')[1];
        if (path) {
          await supabase.storage.from('criminal-photos').remove([path]);
        }
      } catch (err) {
        console.error('Error deleting file:', err);
      }
    }

    if (photo.preview && String(photo.preview).startsWith('blob:')) {
      URL.revokeObjectURL(photo.preview);
    }

    setPhotos((prev) => prev.filter((_, i) => i !== index));
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
      const sanitizedSightings = sanitizeSightingsLogForDb(sightingsLog);
      const legacySeen = syncLegacyLastSeenFromSightings(sanitizedSightings);

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
          common_presence: commonPresence.trim() || null,
          residence_last_known: residenceLastKnown.trim() || null,
          sightings_log: sanitizedSightings,
          last_seen_at: legacySeen.last_seen_at,
          last_seen_location: legacySeen.last_seen_location,
          last_seen_coordinates: legacySeen.last_seen_coordinates,
          
          // Criminal History
          gang_affiliation: gangAffiliation || null,
          criminal_organization: criminalOrganization || null,
          conviction_history_summary: convictionHistorySummary || 'unknown',
          criminal_justice_status: criminalJusticeStatus || 'unknown',
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col gap-4 mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {returnTo && (
                <button
                  type="button"
                  onClick={() => navigate(returnTo)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition text-sm font-medium"
                >
                  <FaArrowLeft className="w-3 h-3" /> Resume incident report
                </button>
              )}
              <button
                type="button"
                onClick={() => navigate('/intelligence/search')}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 transition text-sm font-medium"
              >
                <FaArrowLeft className="w-3 h-3" /> Back to criminal database
              </button>
            </div>
            <ThemeToggle variant="toolbar" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white text-center">Create Criminal Profile</h1>
        </div>

        {returnTo && (
          <div className="mb-6 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900 dark:border-teal-800 dark:bg-teal-900/20 dark:text-teal-300">
            Opened from an incident report: your report text is auto-saved.{' '}
            <strong>Resume incident report</strong> brings you back; re-attach any photos that were not yet
            submitted.
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Profile details</h2>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className={formLabel}>Primary Name *</label>
              <input
                type="text"
                value={primaryName}
                onChange={(e) => setPrimaryName(e.target.value)}
                className={formInput}
                required
                placeholder="Full legal name"
              />
            </div>
            
            <div>
              <label className={formLabel}>Date of Birth</label>
              <input 
                type="date" 
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className={formInput}
              />
            </div>

            <div>
              <label className={formLabel}>Place of Birth</label>
              <input 
                type="text" 
                value={placeOfBirth}
                onChange={(e) => setPlaceOfBirth(e.target.value)}
                className={formInput}
                placeholder="City, Country"
              />
            </div>

            <div>
              <label className={formLabel}>Gender</label>
              <select 
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className={formInput}
              >
                <option className="dark:bg-gray-700" value="">Select Gender</option>
                <option className="dark:bg-gray-700" value="male">Male</option>
                <option className="dark:bg-gray-700" value="female">Female</option>
                <option className="dark:bg-gray-700" value="other">Other</option>
                <option className="dark:bg-gray-700" value="unknown">Unknown</option>
              </select>
            </div>

            {/* ✅ CORRECTED PRIORITY FIELD */}
            <div>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Priority *</label>
                <FieldGuideExplainerLink topic="priority" onOpen={setFieldGuideTopic}>
                  Explain priority
                </FieldGuideExplainerLink>
              </div>
              <select 
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className={formInput}
                required
              >
                <option className="dark:bg-gray-700" value="routine">Routine</option>
                <option className="dark:bg-gray-700" value="priority">Priority</option>
                <option className="dark:bg-gray-700" value="urgent">Urgent</option>
                <option className="dark:bg-gray-700" value="immediate">Immediate</option>
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Select case priority level</p>
            </div>
          </div>

          {/* Nationality */}
          <div className="mt-4">
            <label className={formLabelBlock}>Nationality</label>
            {nationality.map((nat, index) => (
              <div key={index} className="flex gap-2 mb-2">
                <input 
                  type="text" 
                  value={nat}
                  onChange={(e) => updateArrayField(setNationality, nationality, index, e.target.value)}
                  className={formFlexInputSm}
                  placeholder="e.g., South African"
                />
                {nationality.length > 1 && (
                  <button 
                    type="button"
                    onClick={() => removeArrayField(setNationality, nationality, index)}
                    className="px-3 py-2 bg-red-100 text-red-600 rounded-md hover:bg-red-200 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
                  >
                    <FaTimes />
                  </button>
                )}
              </div>
            ))}
            <button 
              type="button"
              onClick={() => addArrayField(setNationality, nationality)}
              className="text-sm font-medium text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300 flex items-center gap-1"
            >
              <FaPlus size={12} /> Add Nationality
            </button>
          </div>

          {/* Known Aliases */}
          <div className="mt-4">
            <label className={formLabelBlock}>Known Aliases</label>
            {knownAliases.map((alias, index) => (
              <div key={index} className="flex gap-2 mb-2">
                <input 
                  type="text" 
                  value={alias}
                  onChange={(e) => updateArrayField(setKnownAliases, knownAliases, index, e.target.value)}
                  className={formFlexInputSm}
                  placeholder={`Alias ${index + 1}`}
                />
                {knownAliases.length > 1 && (
                  <button 
                    type="button"
                    onClick={() => removeArrayField(setKnownAliases, knownAliases, index)}
                    className="px-3 py-2 bg-red-100 text-red-600 rounded-md hover:bg-red-200 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
                  >
                    <FaTimes />
                  </button>
                )}
              </div>
            ))}
            <button 
              type="button"
              onClick={() => addArrayField(setKnownAliases, knownAliases)}
              className="text-sm font-medium text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300 flex items-center gap-1"
            >
              <FaPlus size={12} /> Add Alias
            </button>
          </div>
            <SectionCard title="Risk Assessment">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Risk Level</label>
                <FieldGuideExplainerLink topic="risk" onOpen={setFieldGuideTopic}>
                  Explain risk levels
                </FieldGuideExplainerLink>
              </div>
              <select 
                value={riskLevel}
                onChange={(e) => setRiskLevel(e.target.value)}
                className={formInput}
              >
                <option className="dark:bg-gray-700" value="low">Low</option>
                <option className="dark:bg-gray-700" value="medium">Medium</option>
                <option className="dark:bg-gray-700" value="high">High</option>
                <option className="dark:bg-gray-700" value="critical">Critical</option>
              </select>
            </div>

            <div>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Status</label>
                <FieldGuideExplainerLink topic="status" onOpen={setFieldGuideTopic}>
                  Explain status
                </FieldGuideExplainerLink>
              </div>
              <select 
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className={formInput}
              >
                <option className="dark:bg-gray-700" value="active">Active</option>
                <option className="dark:bg-gray-700" value="cleared">Inactive (cleared)</option>
                <option className="dark:bg-gray-700" value="incarcerated">Incarcerated</option>
                <option className="dark:bg-gray-700" value="deceased">Deceased</option>
                <option className="dark:bg-gray-700" value="wanted">Wanted</option>
              </select>
            </div>
          </div>

          {/* Watchlist Flags */}
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Watchlist Flags</label>
              <FieldGuideExplainerLink topic="watchlist" onOpen={setFieldGuideTopic}>
                Explain watchlist flags
              </FieldGuideExplainerLink>
            </div>
            <WatchlistTemplatePicker watchlistFlags={watchlistFlags} setWatchlistFlags={setWatchlistFlags} />
            {watchlistFlags.map((flag, index) => (
              <div key={index} className="flex gap-2 mb-2">
                <input 
                  type="text" 
                  value={flag}
                  onChange={(e) => updateArrayField(setWatchlistFlags, watchlistFlags, index, e.target.value)}
                  className={formFlexInputSm}
                  placeholder="e.g., Violent, Armed, Flight Risk"
                />
                {watchlistFlags.length > 1 && (
                  <button 
                    type="button"
                    onClick={() => removeArrayField(setWatchlistFlags, watchlistFlags, index)}
                    className="px-3 py-2 bg-red-100 text-red-600 rounded-md hover:bg-red-200 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
                  >
                    <FaTimes />
                  </button>
                )}
              </div>
            ))}
            <button 
              type="button"
              onClick={() => addArrayField(setWatchlistFlags, watchlistFlags)}
              className="text-sm font-medium text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300 flex items-center gap-1"
            >
              <FaPlus size={12} /> Add Flag
            </button>
          </div>
            </SectionCard>

            <SectionCard title="Physical Description">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className={formLabel}>Height (cm)</label>
              <input 
                type="number" 
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                className={formInput}
                placeholder="175"
              />
            </div>

            <div>
              <label className={formLabel}>Weight (kg)</label>
              <input 
                type="number" 
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className={formInput}
                placeholder="70"
              />
            </div>

            <div>
              <label className={formLabel}>Build</label>
              <select 
                value={buildType}
                onChange={(e) => setBuildType(e.target.value)}
                className={formInput}
              >
                <option className="dark:bg-gray-700" value="">Select</option>
                <option className="dark:bg-gray-700" value="slim">Slim</option>
                <option className="dark:bg-gray-700" value="medium">Medium</option>
                <option className="dark:bg-gray-700" value="athletic">Athletic</option>
                <option className="dark:bg-gray-700" value="heavy">Heavy</option>
                <option className="dark:bg-gray-700" value="muscular">Muscular</option>
              </select>
            </div>

            <div>
              <label className={formLabel}>Eye Color</label>
              <input 
                type="text" 
                value={eyeColor}
                onChange={(e) => setEyeColor(e.target.value)}
                className={formInput}
                placeholder="Brown"
              />
            </div>

            <div>
              <label className={formLabel}>Hair Color</label>
              <input 
                type="text" 
                value={hairColor}
                onChange={(e) => setHairColor(e.target.value)}
                className={formInput}
                placeholder="Black"
              />
            </div>

            <div>
              <label className={formLabel}>Complexion</label>
              <input 
                type="text" 
                value={complexion}
                onChange={(e) => setComplexion(e.target.value)}
                className={formInput}
                placeholder="Fair/Dark/Medium"
              />
            </div>
          </div>

          {/* Distinguishing Marks */}
          <div className="mt-4">
            <label className={formLabelBlock}>Distinguishing Marks</label>
            {distinguishingMarks.map((mark, index) => (
              <div key={index} className="flex gap-2 mb-2">
                <input 
                  type="text" 
                  value={mark}
                  onChange={(e) => updateArrayField(setDistinguishingMarks, distinguishingMarks, index, e.target.value)}
                  className={formFlexInputSm}
                  placeholder="Tattoo, scar, birthmark description"
                />
                {distinguishingMarks.length > 1 && (
                  <button 
                    type="button"
                    onClick={() => removeArrayField(setDistinguishingMarks, distinguishingMarks, index)}
                    className="px-3 py-2 bg-red-100 text-red-600 rounded-md hover:bg-red-200 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
                  >
                    <FaTimes />
                  </button>
                )}
              </div>
            ))}
            <button 
              type="button"
              onClick={() => addArrayField(setDistinguishingMarks, distinguishingMarks)}
              className="text-sm font-medium text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300 flex items-center gap-1"
            >
              <FaPlus size={12} /> Add Mark
            </button>
          </div>
            </SectionCard>

            <SectionCard title="Identity Documents">
          {idNumbers.map((id, index) => (
            <div
              key={index}
              className="mb-2 grid grid-cols-1 gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-900/20 md:grid-cols-3"
            >
              <div>
                <label className={formLabelXs}>ID Type</label>
                <select
                  value={id.type}
                  onChange={(e) => updateIdNumber(index, 'type', e.target.value)}
                  className={formSelectSm}
                >
                  <option className="dark:bg-gray-700" value="">Select Type</option>
                  <option className="dark:bg-gray-700" value="passport">Passport</option>
                  <option className="dark:bg-gray-700" value="national_id">National ID</option>
                  <option className="dark:bg-gray-700" value="drivers_license">Driver's License</option>
                  <option className="dark:bg-gray-700" value="social_security">Social Security</option>
                  <option className="dark:bg-gray-700" value="other">Other</option>
                </select>
              </div>
              <div className="md:col-span-2 flex gap-2">
                <div className="flex-1">
                  <label className={formLabelXs}>Number</label>
                  <input 
                    type="text" 
                    value={id.number}
                    onChange={(e) => updateIdNumber(index, 'number', e.target.value)}
                    className={formInputSm}
                    placeholder="Document number"
                  />
                </div>
                {idNumbers.length > 1 && (
                  <button 
                    type="button"
                    onClick={() => removeIdNumber(index)}
                    className="self-end px-2 py-1 text-red-600 hover:bg-red-100 rounded dark:text-red-400 dark:hover:bg-red-950/50"
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
            className="text-sm font-medium text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300 flex items-center gap-1"
          >
            <FaPlus size={12} /> Add ID Document
          </button>
            </SectionCard>

            <SectionCard title="Location Data">
          <div className="mb-6 space-y-4">
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-orange-800 dark:text-orange-300/90">
                Common presence
              </h3>
              <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                Areas, routes, or venues where this subject is most often observed.
              </p>
              <textarea
                value={commonPresence}
                onChange={(e) => setCommonPresence(e.target.value)}
                rows={3}
                className={`${formInput} resize-y min-h-[4.5rem]`}
                placeholder="e.g. Theescombe retail strip, evenings near park entrance"
              />
            </div>
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-orange-800 dark:text-orange-300/90">
                Residence (last known)
              </h3>
              <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                Last known home or residential area on file (verified or alleged).
              </p>
              <input
                type="text"
                value={residenceLastKnown}
                onChange={(e) => setResidenceLastKnown(e.target.value)}
                className={formInput}
                placeholder="Street, suburb, or general area"
              />
            </div>
          </div>

          <div className="border-t border-orange-100 pt-5 dark:border-orange-900/40">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-orange-800 dark:text-orange-300/90">
              Last known sightings
            </h3>
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
              Add each reported sighting (time, place, optional coordinates, who saw them). The newest row is also
              stored as legacy “last seen” for older screens.
            </p>
          </div>

          <SightingsLogEditor
            value={sightingsLog}
            onChange={setSightingsLog}
            disabled={false}
            dateInputClass={formInput}
            textInputClass={formInput}
          />
            </SectionCard>

            <SectionCard title="Criminal History & Intelligence">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className={formLabel}>Gang Affiliation</label>
              <input 
                type="text" 
                value={gangAffiliation}
                onChange={(e) => setGangAffiliation(e.target.value)}
                className={formInput}
                placeholder="Gang name or street gang"
              />
            </div>

            <div>
              <label className={formLabel}>Criminal Organization</label>
              <input 
                type="text" 
                value={criminalOrganization}
                onChange={(e) => setCriminalOrganization(e.target.value)}
                className={formInput}
                placeholder="Organized crime group"
              />
            </div>
          </div>

          <p className="mb-4 rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100/90">
            {LEGAL_RECORD_INTELLIGENCE_NOTE}
          </p>

          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={formLabel}>Prior convictions (this file)</label>
              <select
                value={convictionHistorySummary}
                onChange={(e) => setConvictionHistorySummary(e.target.value)}
                className={formInput}
              >
                {CONVICTION_HISTORY_SUMMARY_OPTIONS.map((opt) => (
                  <option className="dark:bg-gray-700" key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {CONVICTION_HISTORY_SUMMARY_OPTIONS.find((o) => o.value === convictionHistorySummary)?.hint ||
                  'What this intelligence file records about previous convictions.'}
              </p>
            </div>
            <div>
              <label className={formLabel}>Criminal justice / prosecution status</label>
              <select
                value={criminalJusticeStatus}
                onChange={(e) => setCriminalJusticeStatus(e.target.value)}
                className={formInput}
              >
                {CRIMINAL_JUSTICE_STATUS_OPTIONS.map((opt) => (
                  <option className="dark:bg-gray-700" key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {CRIMINAL_JUSTICE_STATUS_OPTIONS.find((o) => o.value === criminalJusticeStatus)?.hint ||
                  'Stage of any open or recent matter, as known to your structure.'}
              </p>
            </div>
          </div>

          {/* Modus Operandi */}
          <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-600 dark:bg-gray-900/30">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Modus Operandi (MO)
              </label>
              <FieldGuideExplainerLink topic="mo" onOpen={setFieldGuideTopic}>
                Explain MO
              </FieldGuideExplainerLink>
            </div>
            <MoTemplatePicker moSignature={moSignature} setMoSignature={setMoSignature} />

            <div className="mb-2">
              <label className={formLabelXs}>Methods</label>
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
                    className={formFlexInputSm}
                    placeholder="Method of operation"
                  />
                  {moSignature.methods.length > 1 && (
                    <button 
                      type="button"
                      onClick={() => {
                        const newMethods = moSignature.methods.filter((_, i) => i !== index);
                        setMoSignature({...moSignature, methods: newMethods});
                      }}
                      className="px-2 text-red-600 hover:bg-red-100 rounded dark:text-red-400 dark:hover:bg-red-950/50"
                    >
                      <FaTimes size={12} />
                    </button>
                  )}
                </div>
              ))}
              <button 
                type="button"
                onClick={() => setMoSignature({...moSignature, methods: [...moSignature.methods, '']})}
                className="text-xs font-medium text-teal-600 hover:text-teal-800 dark:text-teal-400 flex items-center gap-1"
              >
                <FaPlus size={10} /> Add Method
              </button>
            </div>

            <div className="mb-2">
              <label className={formLabelXs}>Patterns</label>
              <input 
                type="text" 
                value={moSignature.patterns}
                onChange={(e) => setMoSignature({...moSignature, patterns: e.target.value})}
                className={formInputSm}
                placeholder="Behavioral patterns"
              />
            </div>

            <div>
              <label className={formLabelXs}>Notes</label>
              <textarea 
                value={moSignature.notes}
                onChange={(e) => setMoSignature({...moSignature, notes: e.target.value})}
                className={formTextarea}
                rows="2"
                placeholder="Additional MO notes"
              />
            </div>
          </div>
            </SectionCard>

            <SectionCard title="Photographs">
          
          {/* File Upload Area */}
          <div className="mb-6">
            <label className={formLabelBlock}>Photos from device</label>
            <div className="cursor-pointer rounded-xl border-2 border-dashed border-gray-300 bg-gray-50/50 p-6 text-center transition-colors hover:border-teal-500 dark:border-gray-600 dark:bg-gray-700/30 dark:hover:border-teal-500">
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
                <FaUpload className="mb-2 h-12 w-12 text-gray-400 dark:text-gray-500" />
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  Click to upload photos
                </span>
                <span className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  JPG, PNG, GIF up to 5MB
                </span>
              </label>
            </div>
          </div>

          {/* Photo Previews */}
          {photos.length > 0 && (
            <div className="mb-6">
              <label className={formLabelBlock}>
                Profile photos
                {photos.some((p) => p.fromIncident) && (
                  <span className="mt-0.5 block text-xs font-normal text-gray-500 dark:text-gray-400">
                    Some images were copied from the incident report (incident-photos). You can remove them or add more below.
                  </span>
                )}
              </label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {photos.map((photo, index) => {
                  const galleryUrls = photos
                    .map((p) => p.preview || p.url)
                    .filter(Boolean);
                  return (
                  <div key={index} className="relative group">
                    <div className="aspect-square overflow-hidden rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-600 dark:bg-gray-700/50">
                      {photo.uploading ? (
                        <div className="w-full h-full flex items-center justify-center">
                          <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-200 border-t-teal-600 dark:border-teal-800 dark:border-t-teal-400" />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setPhotoLightbox({ urls: galleryUrls, index })
                          }
                          className="group/btn relative h-full w-full border-0 bg-transparent p-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
                          aria-label={`View photo ${index + 1} full size`}
                        >
                          <img
                            src={photo.preview || photo.url}
                            alt={`Upload ${index + 1}`}
                            className="h-full w-full object-cover object-top transition group-hover/btn:opacity-90"
                          />
                          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover/btn:bg-black/15 group-hover/btn:opacity-100">
                            <FaExpand className="h-7 w-7 text-white drop-shadow-md" aria-hidden />
                          </span>
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removePhoto(index)}
                      className="absolute -top-2 -right-2 z-10 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                      disabled={photo.uploading}
                    >
                      <FaTimes size={12} />
                    </button>
                    {photo.uploading && (
                      <span className="absolute bottom-1 left-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-teal-700 dark:border-gray-600 dark:bg-gray-800 dark:text-teal-300">
                        Uploading...
                      </span>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          )}
            </SectionCard>

            <div className="flex flex-col-reverse gap-3 border-t border-gray-200 dark:border-gray-700 pt-5 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => navigate('/intelligence/search')}
                className="px-6 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || photos.some((p) => p.uploading)}
                className="w-full sm:w-auto bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 px-6 rounded-xl transition shadow-sm flex items-center justify-center gap-2"
              >
                {loading
                  ? 'Creating Profile...'
                  : photos.some((p) => p.uploading)
                    ? 'Uploading Photos...'
                    : 'Create Criminal Profile'}
              </button>
            </div>
          </form>
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
            aria-labelledby="field-guide-modal-title"
            className="grid max-h-[min(90vh,720px)] w-full max-w-lg grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <h3
                id="field-guide-modal-title"
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
                className="w-full rounded-xl bg-teal-600 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-teal-700"
              >
                Done — continue form
              </button>
            </div>
          </div>
        </div>
      )}

      <PatrollerPhotoPreview
        key={photoLightbox ? `create-profile-ph-${photoLightbox.index}` : 'create-profile-ph-closed'}
        open={!!photoLightbox}
        onClose={() => setPhotoLightbox(null)}
        name={primaryName.trim() || 'New profile'}
        imageUrls={photoLightbox?.urls}
        initialIndex={photoLightbox?.index ?? 0}
      />
    </div>
  );
}