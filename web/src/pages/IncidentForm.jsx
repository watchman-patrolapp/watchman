import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../supabase/client";
import { FaArrowLeft, FaCamera, FaExclamationTriangle, FaCheckCircle, FaTimes, FaCar, FaTools, FaFileAlt, FaEye, FaUserSecret, FaSearch, FaLink } from "react-icons/fa";
import toast from "react-hot-toast";
import EvidenceSection from "../components/evidence/EvidenceSection";
import { analyzeEvidenceForMatches, createMatchQueueEntries } from "../utils/evidenceHelpers";
import MatchSuggestionPanel from "../components/intelligence/MatchSuggestionPanel";
import ProfileLinkingSection from "../components/intelligence/ProfileLinkingSection";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INCIDENT_TYPES = [
  "Suspicious Activity",
  "Theft",
  "Vandalism",
  "Noise Complaint",
  "Suspicious Vehicle",
  "Other"
];

const MAX_FILES = 10;

const INCIDENT_DRAFT_STORAGE_KEY = "nwp_incident_report_draft_v1";

const EMPTY_EVIDENCE = () => ({
  scene_photos: [],
  suspects: [],
  vehicles: [],
  physical_evidence: [],
  documentation: [],
  contextual_intel: [],
});

/** Serializable evidence (File objects cannot be stored). */
function evidenceForStorage(evidence) {
  const out = {};
  for (const key of Object.keys(evidence)) {
    out[key] = (evidence[key] || []).map((entry) => ({
      ...entry,
      files: [],
    }));
  }
  return out;
}

const EVIDENCE_CATEGORIES = [
  {id: 'scene_photos', label: 'Scene Evidence', description: 'General photos of incident location, damage, or environment', icon: FaCamera, allowMultipleEntries: false},
  {id: 'suspects', label: 'Suspect Profiles', description: 'Photos and descriptions of identified or suspicious persons', icon: FaUserSecret, allowMultipleEntries: true},
  {id: 'vehicles', label: 'Vehicle Evidence', description: 'Suspicious vehicles, license plates, or vehicle damage', icon: FaCar, allowMultipleEntries: true},
  {id: 'physical_evidence', label: 'Physical Evidence', description: 'Tools, footprints, damage, stolen items left behind', icon: FaTools, allowMultipleEntries: false},
  {id: 'documentation', label: 'Documentation', description: 'SAPS forms, insurance docs, receipts, serial numbers', icon: FaFileAlt, allowMultipleEntries: false},
  {id: 'contextual_intel', label: 'Contextual Intelligence', description: 'Suspicious activity nearby (e.g., 2am walkers near cable theft)', icon: FaEye, allowMultipleEntries: true}
];

const INITIAL_FORM = {
  incidentDate: new Date().toISOString().split('T')[0],
  location: "",
  type: "",
  description: "",
  suspectName: "",
  suspectDescription: "",
  vehicleInfo: "",
  sapsCaseNumber: "",
  witnessPresent: false,
  witnessName: "",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionCard({ title, children }) {
  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-5">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">{title}</h2>
      {children}
    </div>
  );
}

function FormInput({ label, name, type = "text", required, ...props }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        name={name}
        required={required}
        className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2.5 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
        {...props}
      />
    </div>
  );
}

function FormTextarea({ label, name, required, rows = 4, ...props }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <textarea
        name={name}
        required={required}
        rows={rows}
        className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2.5 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition resize-y"
        {...props}
      />
    </div>
  );
}

function FormSelect({ label, name, required, options, ...props }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <select
        name={name}
        required={required}
        className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2.5 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
        {...props}
      >
        <option value="" className="dark:bg-gray-700">Select {label.toLowerCase()}</option>
        {options.map(opt => (
          <option key={opt} value={opt} className="dark:bg-gray-700">{opt}</option>
        ))}
      </select>
    </div>
  );
}

function AlertBox({ message }) {
  return (
    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-6 flex items-start gap-3">
      <FaExclamationTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
      <p className="text-sm text-red-700 dark:text-red-300">{message}</p>
    </div>
  );
}

function UploadProgress({ current, total, progress }) {
  return (
    <div className="mt-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-3">
      <div className="flex justify-between text-sm mb-2 text-indigo-700 dark:text-indigo-300">
        <span className="flex items-center gap-2">
          <FaCamera className="w-4 h-4" />
          Uploading {current} of {total}
        </span>
        <span className="font-semibold">{progress}%</span>
      </div>
      <div className="w-full bg-indigo-200 dark:bg-indigo-800 rounded-full h-2">
        <div
          className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function IncidentForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [form, setForm] = useState(INITIAL_FORM);
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [draftHydrated, setDraftHydrated] = useState(false);
  const lastCreatedProfileToastId = useRef(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(INCIDENT_DRAFT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.form && typeof parsed.form === "object") {
          setForm((prev) => ({ ...prev, ...parsed.form }));
        }
        if (parsed.evidence && typeof parsed.evidence === "object") {
          setEvidence((prev) => {
            const next = { ...prev };
            for (const k of Object.keys(prev)) {
              if (Array.isArray(parsed.evidence[k])) {
                next[k] = parsed.evidence[k].map((entry) => ({
                  ...entry,
                  files: [],
                  media_urls: entry.media_urls || [],
                }));
              }
            }
            return next;
          });
        }
        toast.success("Restored your in-progress incident report (re-attach photos if needed).", {
          duration: 5000,
        });
      }
    } catch (e) {
      console.warn("Incident draft restore failed:", e);
    }
    setDraftHydrated(true);
  }, []);

  useEffect(() => {
    if (!draftHydrated) return;
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem(
          INCIDENT_DRAFT_STORAGE_KEY,
          JSON.stringify({
            form,
            evidence: evidenceForStorage(evidence),
            savedAt: Date.now(),
          })
        );
      } catch (e) {
        console.warn("Incident draft save failed:", e);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [form, evidence, draftHydrated]);

  useEffect(() => {
    const st = location.state;
    const id = st?.createdProfileId;
    if (!id || lastCreatedProfileToastId.current === id) return;
    lastCreatedProfileToastId.current = id;
    const name = st.createdProfileName || "New profile";
    toast.success(
      `“${name}” is saved. In Suspect Profiles, search that name and link it to this report.`,
      { duration: 7000 }
    );
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value
    }));
  };

  const generateEntryId = () => `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const addEvidenceEntry = (categoryId) => {
    const newEntry = {
      id: generateEntryId(),
      category: categoryId,
      description: '',
      metadata: {},
      files: [],
      media_urls: []
    };
    setEvidence(prev => ({
      ...prev,
      [categoryId]: [...prev[categoryId], newEntry]
    }));
  };

  const updateEvidenceEntry = (categoryId, entryId, field, value) => {
    setEvidence(prev => ({
      ...prev,
      [categoryId]: prev[categoryId].map(entry => 
        entry.id === entryId ? { ...entry, [field]: value } : entry
      )
    }));
  };

  const removeEvidenceEntry = (categoryId, entryId) => {
    setEvidence(prev => ({
      ...prev,
      [categoryId]: prev[categoryId].filter(entry => entry.id !== entryId)
    }));
  };

  const handleEvidenceFileSelect = (categoryId, entryId, selectedFiles) => {
    // Validate max 3 files per entry
    const entry = evidence[categoryId].find(e => e.id === entryId);
    const currentCount = entry?.files?.length || 0;
    
    if (currentCount + selectedFiles.length > 3) {
      toast.error('Maximum 3 images per evidence entry');
      return;
    }
    
    // Validate image types
    const invalidFile = selectedFiles.find(f => !f.type.startsWith('image/'));
    if (invalidFile) {
      toast.error(`${invalidFile.name} is not a valid image`);
      return;
    }
    
    setEvidence(prev => ({
      ...prev,
      [categoryId]: prev[categoryId].map(entry => 
        entry.id === entryId 
          ? { ...entry, files: [...(entry.files || []), ...selectedFiles] }
          : entry
      )
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      // 1. First, insert the incident
      const incidentData = {
        incident_date: form.incidentDate,
        location: form.location,
        type: form.type,
        description: form.description,
        suspect_name: form.suspectName || null,
        suspect_description: form.suspectDescription || null,
        vehicle_info: form.vehicleInfo || null,
        saps_case_number: form.sapsCaseNumber || null,
        witness_present: form.witnessPresent,
        witness_name: form.witnessName || null,
        submitted_by: user.id,
        submitted_by_name: user.user_metadata?.full_name || user.email,
        submitted_by_car: user.user_metadata?.car_type || null,
        submitted_by_reg: user.user_metadata?.registration_number || null,
        status: 'pending',
        submitted_at: new Date().toISOString(),
      };

      const { data: incident, error: insertError } = await supabase
        .from('incidents')
        .insert(incidentData)
        .select()
        .single();

      if (insertError) throw insertError;

      // 2. Process and upload evidence
      const evidenceEntries = [];
      
      for (const [categoryId, entries] of Object.entries(evidence)) {
        for (const entry of entries) {
          // Skip empty entries
          if (!entry.description && (!entry.files || entry.files.length === 0)) continue;
          
          let photoURLs = [];
          
          // Upload files if any
          if (entry.files && entry.files.length > 0) {
            for (let i = 0; i < entry.files.length; i++) {
              const file = entry.files[i];
              const fileExt = file.name.split('.').pop();
              const fileName = `${Date.now()}_${i}.${fileExt}`;
              const filePath = `${incident.id}/${entry.id}/${fileName}`;
              
              const { error: uploadError } = await supabase.storage
                .from('incident-photos')
                .upload(filePath, file);
                
              if (uploadError) {
                console.error('Upload error:', uploadError);
                continue;
              }

              const { data: urlData } = supabase.storage
                .from('incident-photos')
                .getPublicUrl(filePath);
              photoURLs.push(urlData.publicUrl);
            }
          }
          
          evidenceEntries.push({
            incident_id: incident.id,
            category: categoryId,
            description: entry.description,
            metadata: entry.metadata,
            media_urls: photoURLs,
            submitted_by: user.id
          });
        }
      }

      // 3. Insert evidence records if any
      if (evidenceEntries.length > 0) {
        const { error: evidenceError } = await supabase
          .from('incident_evidence')
          .insert(evidenceEntries);
          
        if (evidenceError) throw evidenceError;
      }

      // 4. Also insert suspects to dedicated table for cross-incident linking
      const suspectEntries = evidence.suspects.filter(s => s.description);
      if (suspectEntries.length > 0) {
        const suspectRecords = suspectEntries.map(s => ({
          incident_id: incident.id,
          evidence_id: null, // Will be updated after evidence insert if needed
          description: s.description,
          estimated_age: s.metadata?.age || null,
          clothing_description: s.metadata?.clothing || null,
          distinguishing_features: null,
          direction_last_seen: s.metadata?.direction || null,
          time_observed: s.metadata?.timeObserved || null,
          photo_urls: s.media_urls || []
        }));
        
        const { error: suspectError } = await supabase
          .from('incident_suspects')
          .insert(suspectRecords);
          
        if (suspectError) console.error('Suspect insert error:', suspectError);
      }

      // 5. Check for suspect evidence to trigger profile matching
      if (suspectEntries.length > 0) {
        for (const suspect of suspectEntries) {
          // Analyze for potential matches
          const matches = await analyzeEvidenceForMatches(suspect, incidentData);
          
          if (matches.length > 0) {
            // Create match queue entries for analyst review
            await createMatchQueueEntries(matches, incident.id, suspect.id);
            
            // Show notification to user
            toast.success(`Potential profile matches found for suspect. Review in Intelligence > Match Queue.`);
          } else {
            // Offer to create new profile
            toast((t) => (
              <div>
                <p>No existing profiles match this suspect.</p>
                <button 
                  onClick={() => {
                    toast.dismiss(t.id);
                    // Navigate to create new profile
                    navigate(`/intelligence/profiles/new?incident=${incident.id}&evidence=${suspect.id}`);
                  }}
                  className="mt-2 px-3 py-1 bg-indigo-600 text-white rounded text-sm"
                >
                  Create New Profile
                </button>
              </div>
            ), { duration: 5000 });
          }
        }
      }

      try {
        sessionStorage.removeItem(INCIDENT_DRAFT_STORAGE_KEY);
      } catch (_) {
        /* ignore */
      }
      toast.success("Incident reported successfully with structured evidence!");
      navigate("/dashboard");
      
    } catch (err) {
      console.error("Submission error:", err);
      toast.error("Failed to submit: " + err.message);
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <button
            onClick={() => navigate("/dashboard")}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 transition text-sm font-medium"
          >
            <FaArrowLeft className="w-3 h-3" />
            Dashboard
          </button>
          
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Report an Incident
          </h1>
          
          <div className="w-24" />
        </div>

        {error && <AlertBox message={error} />}

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Incident Details
            </h2>
          </div>
          
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            <FormInput
              label="Date of Incident"
              name="incidentDate"
              type="date"
              required
              value={form.incidentDate}
              onChange={handleChange}
            />

            <FormInput
              label="Location"
              name="location"
              required
              placeholder="e.g., Lot 158 Kragga Kamma Road"
              value={form.location}
              onChange={handleChange}
            />

            <FormSelect
              label="Type"
              name="type"
              required
              options={INCIDENT_TYPES}
              value={form.type}
              onChange={handleChange}
            />

            <FormTextarea
              label="Description"
              name="description"
              required
              placeholder="Provide a factual description of what happened"
              value={form.description}
              onChange={handleChange}
            />

            <SectionCard title="Suspect Information (optional)">
              <div className="space-y-3">
                <FormInput
                  name="suspectName"
                  placeholder="Suspect name"
                  value={form.suspectName}
                  onChange={handleChange}
                />
                <FormTextarea
                  name="suspectDescription"
                  placeholder="Suspect description (clothing, height, etc.)"
                  rows={2}
                  value={form.suspectDescription}
                  onChange={handleChange}
                />
                <FormInput
                  name="vehicleInfo"
                  placeholder="Vehicle description / registration"
                  value={form.vehicleInfo}
                  onChange={handleChange}
                />
              </div>
            </SectionCard>

            <SectionCard title="SAPS Information (optional)">
              <FormInput
                name="sapsCaseNumber"
                placeholder="SAPS case number"
                value={form.sapsCaseNumber}
                onChange={handleChange}
              />
            </SectionCard>

            <SectionCard title="Witness Information">
              <label className="flex items-center space-x-3 text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  name="witnessPresent"
                  checked={form.witnessPresent}
                  onChange={handleChange}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
                />
                <span>Witness present</span>
              </label>
              
              {form.witnessPresent && (
                <div className="mt-3">
                  <FormInput
                    name="witnessName"
                    placeholder="Witness name (optional)"
                    value={form.witnessName}
                    onChange={handleChange}
                  />
                </div>
              )}
            </SectionCard>

            <SectionCard title="Structured Evidence">
              <div className="mb-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  <strong>Pro Tip:</strong> Add contextual intelligence (suspicious people/vehicles nearby) even if not directly involved. This helps police connect patterns across multiple incidents.
                </p>
              </div>
              
              {EVIDENCE_CATEGORIES.map(cat => (
                <div key={cat.id}>
                  <EvidenceSection 
                    key={cat.id}
                    category={cat}
                    entries={evidence[cat.id]}
                    onAddEntry={() => addEvidenceEntry(cat.id)}
                    onUpdateEntry={(entryId, field, value) => updateEvidenceEntry(cat.id, entryId, field, value)}
                    onRemoveEntry={(entryId) => removeEvidenceEntry(cat.id, entryId)}
                    onFileSelect={(entryId, files) => handleEvidenceFileSelect(cat.id, entryId, files)}
                  />
                  
                  {/* Profile Linking for Suspects */}
                  {cat.id === 'suspects' && evidence.suspects.length > 0 && (
                    <div className="mt-4 p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg">
                      <div className="flex items-center gap-2 mb-3">
                        <FaSearch className="w-4 h-4 text-indigo-600" />
                        <h4 className="font-semibold text-indigo-700 dark:text-indigo-300">Search Existing Profiles</h4>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {evidence.suspects.map((entry) => (
                          <ProfileLinkingSection
                            key={entry.id}
                            entry={entry}
                            onUpdateEntry={(field, value) => updateEvidenceEntry(cat.id, entry.id, field, value)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </SectionCard>

            <div className="pt-4">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition shadow-sm flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Submit Incident Report"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}