import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabase/client";
import { 
  FaArrowLeft, 
  FaPrint, 
  FaPlus, 
  FaExclamationTriangle, 
  FaMapMarkerAlt, 
  FaCalendarAlt, 
  FaUser, 
  FaImage,
  FaSync
} from "react-icons/fa";
import toast from "react-hot-toast";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Badge({ children, variant = 'default' }) {
  const variants = {
    default: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
    success: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    danger: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  };
  
  return (
    <span className={`px-3 py-1 text-xs font-semibold rounded-full ${variants[variant]}`}>
      {children}
    </span>
  );
}

function EmptyState({ message }) {
  return (
    <div className="text-center py-12">
      <FaExclamationTriangle className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
      <p className="text-gray-500 dark:text-gray-400">{message}</p>
    </div>
  );
}

function InfoRow({ label, value, icon: Icon }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 text-sm">
      {Icon && <Icon className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />}
      <div className="min-w-0">
        <span className="font-semibold text-gray-700 dark:text-gray-300">{label}:</span>{' '}
        <span className="text-gray-600 dark:text-gray-400 break-words">{value}</span>
      </div>
    </div>
  );
}

function PhotoGallery({ urls }) {
  const [showAll, setShowAll] = useState(false);
  
  if (!urls || urls.length === 0) return null;
  
  const displayUrls = showAll ? urls : urls.slice(0, 3);
  const remaining = urls.length - 3;
  
  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-2">
        <FaImage className="w-4 h-4 text-gray-400" />
        <span className="font-semibold text-gray-700 dark:text-gray-300 text-sm">
          Evidence Photos ({urls.length})
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {displayUrls.map((url, idx) => (
          <a 
            key={idx} 
            href={url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="relative group"
          >
            <img
              src={url}
              alt={`Evidence ${idx + 1}`}
              className="w-24 h-24 object-cover rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:opacity-90 transition"
            />
          </a>
        ))}
        {!showAll && remaining > 0 && (
          <button
            onClick={() => setShowAll(true)}
            className="w-24 h-24 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition"
          >
            +{remaining} more
          </button>
        )}
      </div>
    </div>
  );
}

function IncidentCard({ incident }) {
  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-ZA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 hover:shadow-md transition">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-2 mb-4">
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <FaCalendarAlt className="w-4 h-4" />
          <span>{formatDate(incident.incident_date)}</span>
        </div>
        <Badge variant="success">Approved</Badge>
      </div>

      {/* Main Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <InfoRow 
          label="Location" 
          value={incident.location} 
          icon={FaMapMarkerAlt}
        />
        <InfoRow 
          label="Type" 
          value={incident.type}
        />
      </div>

      {/* Description */}
      <div className="mb-4">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Description</p>
        <p className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 p-3 rounded-xl leading-relaxed">
          {incident.description}
        </p>
      </div>

      {/* Suspect Info */}
      {(incident.suspect_name || incident.suspect_description || incident.vehicle_info) && (
        <div className="space-y-1 mb-3">
          <InfoRow label="Suspect Name" value={incident.suspect_name} />
          <InfoRow label="Suspect Description" value={incident.suspect_description} />
          <InfoRow label="Vehicle Info" value={incident.vehicle_info} />
        </div>
      )}

      {/* SAPS Case */}
      {incident.saps_case_number && (
        <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <InfoRow label="SAPS Case #" value={incident.saps_case_number} />
        </div>
      )}

      {/* Photos */}
      <PhotoGallery urls={incident.media_urls} />

      {/* Footer */}
      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
        <FaUser className="w-3 h-3" />
        <span>Reported by {incident.submitted_by_name}</span>
        <span className="mx-1">•</span>
        <span>{formatDate(incident.submitted_at)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function IncidentList() {
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchIncidents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('incidents')
        .select('*')
        .eq('status', 'approved')
        .order('submitted_at', { ascending: false });
        
      if (fetchError) throw fetchError;
      setIncidents(data || []);
    } catch (err) {
      console.error("Error fetching incidents:", err);
      setError(err.message);
      toast.error("Failed to load incidents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">Loading incidents...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">

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
            Incident Reports
          </h1>
          
          <div className="flex gap-3">
            <button
              onClick={() => window.open("/incidents/print", "_blank")}
              className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl transition text-sm font-medium shadow-sm"
            >
              <FaPrint className="w-4 h-4" />
              Print
            </button>
            <button
              onClick={() => navigate("/incident/new")}
              className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition text-sm font-medium shadow-sm"
            >
              <FaPlus className="w-4 h-4" />
              Report
            </button>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-6 mb-6 text-center">
            <FaExclamationTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
            <p className="text-red-700 dark:text-red-300 mb-3">Failed to load incidents</p>
            <button
              onClick={fetchIncidents}
              className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition"
            >
              <FaSync className="w-4 h-4" />
              Retry
            </button>
          </div>
        )}

        {/* Content */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
          {incidents.length === 0 ? (
            <EmptyState message="No incidents reported yet." />
          ) : (
            <div className="space-y-6">
              {incidents.map(incident => (
                <IncidentCard key={incident.id} incident={incident} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}