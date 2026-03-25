import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../supabase/client";
import { FaArrowLeft, FaCamera, FaExclamationTriangle, FaCheckCircle, FaTimes } from "react-icons/fa";
import toast from "react-hot-toast";

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
  const { user } = useAuth();
  const [form, setForm] = useState(INITIAL_FORM);
  const [files, setFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value
    }));
  };

  const handleFileChange = (e) => {
    const selectedFiles = Array.from(e.target.files);
    
    if (selectedFiles.length > MAX_FILES) {
      toast.error(`Maximum ${MAX_FILES} images allowed`);
      return;
    }
    
    const invalidFile = selectedFiles.find(f => !f.type.startsWith('image/'));
    if (invalidFile) {
      toast.error(`${invalidFile.name} is not a valid image`);
      return;
    }
    
    setFiles(selectedFiles);
    toast.success(`${selectedFiles.length} image(s) selected`);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    setUploadProgress(0);
    setCurrentFileIndex(0);

    try {
      let photoURLs = [];
      
      if (files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const fileName = `${Date.now()}_${i}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
          setCurrentFileIndex(i + 1);
          
          const { error: uploadError } = await supabase.storage
            .from('incident-photos')
            .upload(fileName, file);
            
          if (uploadError) throw uploadError;

          const { data: urlData } = supabase.storage
            .from('incident-photos')
            .getPublicUrl(fileName);
          photoURLs.push(urlData.publicUrl);
          setUploadProgress(Math.round(((i + 1) / files.length) * 100));
        }
      }

      const { error: insertError } = await supabase
        .from('incidents')
        .insert({
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
          media_urls: photoURLs,
          status: 'pending',
          submitted_at: new Date().toISOString(),
        });
        
      if (insertError) throw insertError;
      
      toast.success("Incident reported successfully!");
      navigate("/dashboard");
      
    } catch (err) {
      console.error("Submission error:", err);
      toast.error("Failed to submit: " + err.message);
      setError(err.message);
    } finally {
      setLoading(false);
      setFiles([]);
      const fileInput = document.querySelector('input[type="file"]');
      if (fileInput) fileInput.value = '';
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

            <SectionCard title="Photo Evidence">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Photos (optional, max {MAX_FILES})
              </label>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileChange}
                className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-3 text-gray-900 dark:text-white file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 dark:file:bg-gray-600 dark:file:text-gray-200 transition"
              />
              
              {files.length > 0 && !uploadProgress && (
                <div className="mt-2 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <FaCheckCircle className="w-4 h-4 text-green-500" />
                  {files.length} file(s) ready to upload
                </div>
              )}
              
              {uploadProgress > 0 && (
                <UploadProgress 
                  current={currentFileIndex} 
                  total={files.length} 
                  progress={uploadProgress} 
                />
              )}
            </SectionCard>

            <div className="pt-4">
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition shadow-sm flex items-center justify-center gap-2"
              >
                {loading ? (
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