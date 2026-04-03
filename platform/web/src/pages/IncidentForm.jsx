import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../supabase/client";
import { FaArrowLeft, FaCamera, FaExclamationTriangle, FaCheckCircle, FaTimes, FaCar, FaTools, FaFileAlt, FaEye, FaUserSecret, FaSearch, FaLink } from "react-icons/fa";
import toast from "react-hot-toast";
import EvidenceSection from "../components/evidence/EvidenceSection";
import {
  analyzeEvidenceForMatches,
  createMatchQueueEntries,
  MAX_IMAGES_PER_EVIDENCE_ENTRY,
} from "../utils/evidenceHelpers";
import MatchSuggestionPanel from "../components/intelligence/MatchSuggestionPanel";
import ProfileLinkingSection from "../components/intelligence/ProfileLinkingSection";
import WitnessMemberPicker from "../components/intelligence/WitnessMemberPicker";
import { normalizeMediaUrls } from "../components/evidence/StructuredEvidenceList";
import ThemeToggle from "../components/ThemeToggle";
import BrandedLoader from "../components/layout/BrandedLoader";
import { canStaffManageIncidents } from "../auth/staffRoles";

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

const INCIDENT_DRAFT_STORAGE_KEY = "nwp_incident_report_draft_v1";

const EMPTY_EVIDENCE = () => ({
  scene_photos: [],
  suspects: [],
  vehicles: [],
  physical_evidence: [],
  documentation: [],
  contextual_intel: [],
});

/** Rebuild form evidence state from incident_evidence rows (admin edit / hydration). */
function mapDbEvidenceToFormState(rows) {
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
    logical.set(key, {
      ...primary,
      media_urls: mergedUrls.length > 0 ? mergedUrls : primary.media_urls,
      description:
        primary.description?.trim() || secondary.description?.trim() || '',
    });
  }

  const collapsed = [...logical.values()].sort(
    (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)
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
  witnessUserId: null,
  witnessAvatarUrl: null,
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
        className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2.5 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
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
        className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2.5 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition resize-y"
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
        className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2.5 text-gray-900 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
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
    <div className="mt-3 bg-teal-50 dark:bg-teal-900/20 rounded-xl p-3">
      <div className="flex justify-between text-sm mb-2 text-teal-700 dark:text-teal-300">
        <span className="flex items-center gap-2">
          <FaCamera className="w-4 h-4" />
          Uploading {current} of {total}
        </span>
        <span className="font-semibold">{progress}%</span>
      </div>
      <div className="w-full bg-teal-200 dark:bg-teal-800 rounded-full h-2">
        <div
          className="bg-teal-600 h-2 rounded-full transition-all duration-300"
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
  const { id: editIncidentId } = useParams();
  const isEditMode = Boolean(editIncidentId);
  const { user } = useAuth();
  const [form, setForm] = useState(INITIAL_FORM);
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [editLoading, setEditLoading] = useState(isEditMode);
  const [editLoadError, setEditLoadError] = useState(null);
  const lastCreatedProfileToastId = useRef(null);

  useEffect(() => {
    if (isEditMode) {
      setDraftHydrated(true);
      return;
    }
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
          id: "incident-draft-restored",
          duration: 5000,
        });
      }
    } catch (e) {
      console.warn("Incident draft restore failed:", e);
    }
    setDraftHydrated(true);
  }, []);

  useEffect(() => {
    if (!draftHydrated || isEditMode) return;
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
  }, [form, evidence, draftHydrated, isEditMode]);

  useEffect(() => {
    if (!isEditMode || !editIncidentId || !user?.id) return undefined;
    if (!canStaffManageIncidents(user.role)) {
      toast.error("You don't have permission to edit incidents.");
      navigate("/incidents", { replace: true });
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setEditLoadError(null);
      setEditLoading(true);
      try {
        const { data: inc, error: iErr } = await supabase
          .from("incidents")
          .select("*")
          .eq("id", editIncidentId)
          .single();
        if (iErr) throw iErr;
        if (cancelled) return;
        if (inc.status !== "approved") {
          toast.error("Only approved incidents can be edited here.");
          navigate(`/incidents/${editIncidentId}`, { replace: true });
          return;
        }
        const { data: evRows, error: eErr } = await supabase
          .from("incident_evidence")
          .select("*")
          .eq("incident_id", editIncidentId)
          .order("created_at", { ascending: true });
        if (eErr) throw eErr;
        if (cancelled) return;
        const d =
          typeof inc.incident_date === "string"
            ? inc.incident_date.split("T")[0]
            : inc.incident_date
              ? new Date(inc.incident_date).toISOString().split("T")[0]
              : INITIAL_FORM.incidentDate;
        setForm({
          incidentDate: d || INITIAL_FORM.incidentDate,
          location: inc.location || "",
          type: inc.type || "",
          description: inc.description || "",
          suspectName: inc.suspect_name || "",
          suspectDescription: inc.suspect_description || "",
          vehicleInfo: inc.vehicle_info || "",
          sapsCaseNumber: inc.saps_case_number || "",
          witnessPresent: Boolean(inc.witness_present),
          witnessName: inc.witness_name || "",
          witnessUserId: inc.witness_user_id || null,
          witnessAvatarUrl: null,
        });
        setEvidence(mapDbEvidenceToFormState(evRows || []));
      } catch (err) {
        if (!cancelled) {
          console.error("Edit load failed:", err);
          setEditLoadError(err.message || "Failed to load incident");
          toast.error("Could not load incident for editing.");
        }
      } finally {
        if (!cancelled) setEditLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEditMode, editIncidentId, user?.id, user?.role, navigate]);

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
    if (name === "witnessPresent" && type === "checkbox" && !checked) {
      setForm((prev) => ({
        ...prev,
        witnessPresent: false,
        witnessName: "",
        witnessUserId: null,
        witnessAvatarUrl: null,
      }));
      return;
    }
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
    const entry = evidence[categoryId].find(e => e.id === entryId);
    const currentCount = entry?.files?.length || 0;

    if (currentCount + selectedFiles.length > MAX_IMAGES_PER_EVIDENCE_ENTRY) {
      toast.error(`Maximum ${MAX_IMAGES_PER_EVIDENCE_ENTRY} images per evidence entry`);
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
      let incidentId;
      let incidentDataForMatch = null;

      let oldSuspectLinkedProfileIds = new Set();
      if (isEditMode) {
        const { error: uErr } = await supabase
          .from("incidents")
          .update({
            incident_date: form.incidentDate,
            location: form.location,
            type: form.type,
            description: form.description,
            suspect_name: form.suspectName || null,
            suspect_description: form.suspectDescription || null,
            vehicle_info: form.vehicleInfo || null,
            saps_case_number: form.sapsCaseNumber || null,
            witness_present: form.witnessPresent,
            witness_name: form.witnessName?.trim() || null,
            witness_user_id: form.witnessUserId || null,
          })
          .eq("id", editIncidentId);
        if (uErr) throw uErr;

        const { data: oldSuspectRows } = await supabase
          .from("incident_evidence")
          .select("metadata")
          .eq("incident_id", editIncidentId)
          .eq("category", "suspects");
        for (const r of oldSuspectRows || []) {
          const pid = r.metadata?.linked_profile_id;
          if (pid) oldSuspectLinkedProfileIds.add(pid);
        }

        const { error: delEv } = await supabase.from("incident_evidence").delete().eq("incident_id", editIncidentId);
        if (delEv) throw delEv;
        const { error: delSus } = await supabase.from("incident_suspects").delete().eq("incident_id", editIncidentId);
        if (delSus) throw delSus;

        incidentId = editIncidentId;
      } else {
        incidentDataForMatch = {
          incident_date: form.incidentDate,
          location: form.location,
          type: form.type,
          description: form.description,
          suspect_name: form.suspectName || null,
          suspect_description: form.suspectDescription || null,
          vehicle_info: form.vehicleInfo || null,
          saps_case_number: form.sapsCaseNumber || null,
          witness_present: form.witnessPresent,
          witness_name: form.witnessName?.trim() || null,
          witness_user_id: form.witnessUserId || null,
          submitted_by: user.id,
          submitted_by_name: user.user_metadata?.full_name || user.email,
          submitted_by_car: user.user_metadata?.car_type || null,
          submitted_by_reg: user.user_metadata?.registration_number || null,
          status: "pending",
          submitted_at: new Date().toISOString(),
        };

        const { data: incident, error: insertError } = await supabase
          .from("incidents")
          .insert(incidentDataForMatch)
          .select()
          .single();

        if (insertError) throw insertError;
        incidentId = incident.id;
      }

      const evidenceEntries = [];
      const suspectPhotoUrlsByEntryId = {};

      for (const [categoryId, entries] of Object.entries(evidence)) {
        for (const entry of entries) {
          const hasFiles = entry.files && entry.files.length > 0;
          const hasStoredUrls = entry.media_urls && entry.media_urls.length > 0;
          const linkedOnlySuspect =
            categoryId === "suspects" && entry.linked_profile_id && !entry.description?.trim() && !hasFiles && !hasStoredUrls;
          if (!entry.description?.trim() && !hasFiles && !hasStoredUrls && !linkedOnlySuspect) continue;

          let photoURLs = [];

          if (entry.files && entry.files.length > 0) {
            for (let i = 0; i < entry.files.length; i++) {
              const file = entry.files[i];
              const fileExt = file.name.split(".").pop();
              const fileName = `${Date.now()}_${i}.${fileExt}`;
              const filePath = `${incidentId}/${entry.id}/${fileName}`;

              const { error: uploadError } = await supabase.storage
                .from("incident-photos")
                .upload(filePath, file);

              if (uploadError) {
                console.error("Upload error:", uploadError);
                toast.error(
                  `Photo upload failed: ${uploadError.message}. Check Supabase Storage bucket "incident-photos" exists and your role can upload.`,
                  { duration: 8000 }
                );
                continue;
              }

              const { data: urlData } = supabase.storage.from("incident-photos").getPublicUrl(filePath);
              photoURLs.push(urlData.publicUrl);
            }
          }

          if (entry.files?.length > 0 && photoURLs.length === 0) {
            toast.error(
              "No images were uploaded (all attempts failed). Evidence will be saved without photos until Storage is configured.",
              { duration: 9000 }
            );
          }

          const mergedUrls = [...new Set([...(entry.media_urls || []).filter(Boolean), ...photoURLs])];

          if (categoryId === "suspects" && mergedUrls.length > 0) {
            suspectPhotoUrlsByEntryId[entry.id] = mergedUrls;
          }

          const meta = { ...(entry.metadata || {}), _formEntryId: entry.id };
          if (categoryId === "suspects" && entry.linked_profile_id) {
            meta.linked_profile_id = entry.linked_profile_id;
            meta.linked_profile_name = entry.linked_profile_name ?? null;
            meta.linked_profile_risk = entry.linked_profile_risk ?? null;
            meta.linked_connection_type = entry.linked_connection_type || "probable_suspect";
            if (
              entry.linked_confidence_score != null &&
              entry.linked_confidence_score !== "" &&
              Number.isFinite(Number(entry.linked_confidence_score))
            ) {
              meta.linked_confidence_score = Math.max(
                1,
                Math.min(100, Math.round(Number(entry.linked_confidence_score)))
              );
            } else {
              delete meta.linked_confidence_score;
            }
          }

          evidenceEntries.push({
            incident_id: incidentId,
            category: categoryId,
            description: entry.description?.trim() || "",
            metadata: meta,
            media_urls: mergedUrls,
            submitted_by: user.id,
          });
        }
      }

      let insertedEvidenceRows = [];
      if (evidenceEntries.length > 0) {
        const { data: inserted, error: evidenceError } = await supabase
          .from("incident_evidence")
          .insert(evidenceEntries)
          .select("id, metadata");

        if (evidenceError) throw evidenceError;
        insertedEvidenceRows = inserted || [];
      }

      const formEntryIdToEvidenceId = {};
      for (const row of insertedEvidenceRows) {
        const fid = row.metadata?._formEntryId;
        if (fid) formEntryIdToEvidenceId[fid] = row.id;
      }

      const allPhotoUrls = [...new Set(evidenceEntries.flatMap((r) => r.media_urls || []).filter(Boolean))];
      const { error: mediaErr } = await supabase
        .from("incidents")
        .update({ media_urls: allPhotoUrls.length > 0 ? allPhotoUrls : null })
        .eq("id", incidentId);
      if (mediaErr) console.warn("incidents.media_urls update failed:", mediaErr.message);

      const suspectEntries = evidence.suspects.filter(
        (s) =>
          s.description?.trim() ||
          (s.files?.length > 0) ||
          (s.media_urls?.length > 0) ||
          Boolean(s.linked_profile_id)
      );
      if (suspectEntries.length > 0) {
        const suspectRecords = suspectEntries.map((s) => ({
          incident_id: incidentId,
          evidence_id: formEntryIdToEvidenceId[s.id] ?? null,
          description:
            s.description?.trim() ||
            (s.linked_profile_id
              ? "Subject linked to criminal intelligence profile."
              : "Person observed — photo only (add context later)."),
          estimated_age: s.metadata?.age || null,
          clothing_description: s.metadata?.clothing || null,
          distinguishing_features: null,
          direction_last_seen: s.metadata?.direction || null,
          time_observed: s.metadata?.timeObserved || null,
          photo_urls: suspectPhotoUrlsByEntryId[s.id] || s.media_urls || [],
        }));

        const { error: suspectError } = await supabase.from("incident_suspects").insert(suspectRecords);

        if (suspectError) console.error("Suspect insert error:", suspectError);
      }

      const linkByProfileId = new Map();
      for (const s of suspectEntries) {
        if (!s.linked_profile_id) continue;
        const ct = s.linked_connection_type || "probable_suspect";
        let cs = null;
        if (
          s.linked_confidence_score != null &&
          s.linked_confidence_score !== "" &&
          Number.isFinite(Number(s.linked_confidence_score))
        ) {
          cs = Math.max(1, Math.min(100, Math.round(Number(s.linked_confidence_score))));
        }
        const prev = linkByProfileId.get(s.linked_profile_id);
        const mergedCs =
          cs != null ? cs : prev?.confidence_score != null ? prev.confidence_score : null;
        linkByProfileId.set(s.linked_profile_id, {
          connection_type: ct,
          confidence_score: mergedCs,
        });
      }
      const linkedProfileIds = [...linkByProfileId.keys()];
      if (linkedProfileIds.length > 0) {
        const linkRows = linkedProfileIds.map((profile_id) => {
          const cfg = linkByProfileId.get(profile_id);
          return {
            profile_id,
            incident_id: incidentId,
            connection_type: cfg.connection_type,
            linked_by: user.id,
            confidence_score: cfg.confidence_score,
          };
        });
        const { error: piErr } = await supabase.from("profile_incidents").upsert(linkRows, {
          onConflict: "profile_id,incident_id",
        });
        if (piErr) {
          console.error("profile_incidents link error:", piErr);
          throw new Error(
            piErr.message ||
              "Could not save profile–incident links (confidence / connection type). Check database policies or try again."
          );
        }
      }

      if (isEditMode && oldSuspectLinkedProfileIds.size > 0) {
        const keep = new Set(linkedProfileIds);
        for (const pid of oldSuspectLinkedProfileIds) {
          if (keep.has(pid)) continue;
          const { error: delPi } = await supabase
            .from("profile_incidents")
            .delete()
            .eq("incident_id", incidentId)
            .eq("profile_id", pid);
          if (delPi) console.warn("profile_incidents cleanup:", delPi.message);
        }
      }

      if (!isEditMode && suspectEntries.length > 0) {
        for (const suspect of suspectEntries) {
          // Already linked in the report; do not prompt to create a new profile.
          if (suspect.linked_profile_id) continue;
          const evidenceRowId = formEntryIdToEvidenceId[suspect.id];
          const matches = await analyzeEvidenceForMatches(suspect, incidentDataForMatch);

          if (matches.length > 0) {
            if (evidenceRowId) {
              await createMatchQueueEntries(matches, incidentId, evidenceRowId);
              toast.success(`Potential profile matches found for suspect. Review in Intelligence > Match Queue.`);
            } else {
              console.error("Match queue skipped: no incident_evidence row id for suspect form entry", suspect.id);
            }
          } else {
            const profileQuery =
              evidenceRowId != null
                ? `incident=${incidentId}&evidence=${evidenceRowId}`
                : `incident=${incidentId}`;
            toast(
              (t) => (
                <div>
                  <p>No existing profiles match this suspect.</p>
                  <button
                    type="button"
                    onClick={() => {
                      toast.dismiss(t.id);
                      navigate(`/intelligence/profiles/new?${profileQuery}`);
                    }}
                    className="mt-2 px-3 py-1 bg-teal-600 text-white rounded text-sm"
                  >
                    Create New Profile
                  </button>
                </div>
              ),
              { duration: 7000 }
            );
          }
        }
      }

      if (isEditMode) {
        toast.success("Incident updated.");
        navigate(`/incidents/${incidentId}`);
      } else {
        try {
          sessionStorage.removeItem(INCIDENT_DRAFT_STORAGE_KEY);
        } catch (_) {
          /* ignore */
        }
        toast.success("Incident reported successfully with structured evidence!");
        navigate("/dashboard");
      }
    } catch (err) {
      console.error("Submission error:", err);
      toast.error("Failed to submit: " + err.message);
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isEditMode && editLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <BrandedLoader message="Loading incident…" size="lg" />
      </div>
    );
  }

  if (isEditMode && editLoadError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 px-4 gap-4">
        <p className="text-red-600 dark:text-red-400 text-center">{editLoadError}</p>
        <button
          type="button"
          onClick={() => navigate("/incidents")}
          className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-xl text-sm font-medium"
        >
          Back to incidents
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex flex-col gap-4 mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => navigate(isEditMode ? `/incidents/${editIncidentId}` : "/dashboard")}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 transition text-sm font-medium"
            >
              <FaArrowLeft className="w-3 h-3" />
              {isEditMode ? "Back" : "Dashboard"}
            </button>
            <ThemeToggle variant="toolbar" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white text-center">
            {isEditMode ? "Edit incident" : "Report an Incident"}
          </h1>
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
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-teal-600 focus:ring-teal-500"
                />
                <span>Witness present</span>
              </label>
              
              {form.witnessPresent && (
                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Witness details (optional)
                  </label>
                  <WitnessMemberPicker
                    witnessUserId={form.witnessUserId}
                    witnessName={form.witnessName}
                    witnessAvatarUrl={form.witnessAvatarUrl}
                    onChange={(patch) =>
                      setForm((prev) => ({
                        ...prev,
                        ...patch,
                      }))
                    }
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
                    <div className="mt-4 p-4 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-lg">
                      <div className="flex items-center gap-2 mb-3">
                        <FaSearch className="w-4 h-4 text-teal-600" />
                        <h4 className="font-semibold text-teal-700 dark:text-teal-300">Search Existing Profiles</h4>
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
                className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition shadow-sm flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {isEditMode ? "Saving…" : "Submitting…"}
                  </>
                ) : isEditMode ? (
                  "Save changes"
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