import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabase/client";
import { useAuth } from "../auth/useAuth";
import { deleteIncidentFully } from "../utils/deleteIncident";
import ThemeToggle from "../components/ThemeToggle";
import BrandedLoader from "../components/layout/BrandedLoader";
import { 
  FaArrowLeft, 
  FaPrint,
  FaFilePdf,
  FaPlus, 
  FaExclamationTriangle, 
  FaMapMarkerAlt, 
  FaCalendarAlt, 
  FaUser, 
  FaSync,
  FaTrash,
  FaChevronRight,
  FaEdit,
  FaHistory,
} from "react-icons/fa";
import toast from "react-hot-toast";
import StructuredEvidenceList, { normalizeMediaUrls } from "../components/evidence/StructuredEvidenceList";
import IncidentUpdateCard from "../components/incident/IncidentUpdateCard";
import { INCIDENT_SECTION_LABELS } from "../constants/incidentSectionUpdates";
import { canStaffManageIncidents } from "../auth/staffRoles";

/** Newest / latest-first timestamps for date-style sorts */
const SORT_OPTIONS = [
  { id: "incident_date", label: "Incident date (when it happened, newest first)" },
  { id: "submitted_at", label: "Date created — submitted (newest first)" },
  { id: "incident_row_modified", label: "Date modified — incident record (newest first)" },
  { id: "last_updated", label: "Date updated — includes evidence & official notes (newest first)" },
  { id: "type", label: "Incident type (A–Z)" },
  { id: "suspect_name", label: "Suspect name (A–Z)" },
  { id: "submitted_by", label: "Submitted by (A–Z)" },
];

function timeMs(d) {
  if (d == null || d === "") return null;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Latest activity: incident timestamps + section updates + evidence rows */
/** Latest timestamp on the incidents row only (updated → created → submitted). */
function incidentRowModifiedMs(incident) {
  const t =
    timeMs(incident.updated_at) ??
    timeMs(incident.created_at) ??
    timeMs(incident.submitted_at);
  return t ?? 0;
}

/** Latest activity anywhere on the report (row, evidence, section updates). */
function lastUpdatedMs(incident) {
  let best = null;
  const bump = (d) => {
    const t = timeMs(d);
    if (t == null) return;
    if (best == null || t > best) best = t;
  };
  bump(incident.updated_at);
  bump(incident.created_at);
  bump(incident.submitted_at);
  for (const u of incident.sectionUpdates || []) bump(u.created_at);
  for (const e of incident.evidenceRows || []) bump(e.updated_at || e.created_at);
  return best ?? 0;
}

function incidentDateMs(incident) {
  const raw = incident.incident_date;
  if (raw == null || raw === "") return null;
  const t = timeMs(typeof raw === "string" ? raw.split("T")[0] : raw);
  return t;
}

function compareIncidents(a, b, sortId) {
  if (sortId === "incident_date") {
    const ta = incidentDateMs(a);
    const tb = incidentDateMs(b);
    if (ta == null && tb == null) return 0;
    if (ta == null) return 1;
    if (tb == null) return -1;
    return tb - ta;
  }
  if (sortId === "submitted_at") {
    const ta = timeMs(a.submitted_at);
    const tb = timeMs(b.submitted_at);
    if (ta == null && tb == null) return 0;
    if (ta == null) return 1;
    if (tb == null) return -1;
    return tb - ta;
  }
  if (sortId === "incident_row_modified") {
    return incidentRowModifiedMs(b) - incidentRowModifiedMs(a);
  }
  if (sortId === "last_updated") {
    return lastUpdatedMs(b) - lastUpdatedMs(a);
  }
  if (sortId === "type") {
    return String(a.type || "").localeCompare(String(b.type || ""), undefined, {
      sensitivity: "base",
    });
  }
  if (sortId === "suspect_name") {
    const sa = String(a.suspect_name || "").trim();
    const sb = String(b.suspect_name || "").trim();
    if (!sa && !sb) return 0;
    if (!sa) return 1;
    if (!sb) return -1;
    return sa.localeCompare(sb, undefined, { sensitivity: "base" });
  }
  if (sortId === "submitted_by") {
    const sa = String(a.submitted_by_name || "").trim();
    const sb = String(b.submitted_by_name || "").trim();
    if (!sa && !sb) return 0;
    if (!sa) return 1;
    if (!sb) return -1;
    return sa.localeCompare(sb, undefined, { sensitivity: "base" });
  }
  return 0;
}

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

function isEvidenceSectionKey(sectionKey) {
  const k = String(sectionKey || "");
  return k.startsWith("evidence_") || k === "evidence";
}

function IncidentCard({ incident, showAdminDelete, onAdminDelete, deleteBusyId, onOpenDetail, onAdminEdit }) {
  const evidenceSectionUpdates =
    incident.sectionUpdates?.filter((u) => isEvidenceSectionKey(u.section_key)) ?? [];
  const narrativeSectionUpdates =
    incident.sectionUpdates?.filter((u) => !isEvidenceSectionKey(u.section_key)) ?? [];

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-ZA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  const deleting = deleteBusyId === incident.id;

  return (
    <div className="rounded-2xl border-2 border-gray-300 bg-white p-5 transition hover:shadow-md dark:border-gray-600 dark:bg-gray-800">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-2 mb-4">
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <FaCalendarAlt className="w-4 h-4" />
          <span>{formatDate(incident.incident_date)}</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant="success">Approved</Badge>
          <button
            type="button"
            onClick={() => onOpenDetail(incident.id)}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition"
          >
            Details
            <FaChevronRight className="w-3 h-3" />
          </button>
          {showAdminDelete && (
            <button
              type="button"
              onClick={() => onAdminEdit(incident.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition"
            >
              <FaEdit className="w-3 h-3" />
              Edit
            </button>
          )}
          {showAdminDelete && (
            <button
              type="button"
              disabled={deleting}
              onClick={() => onAdminDelete(incident.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              <FaTrash className="w-3 h-3" />
              {deleting ? "Deleting…" : "Delete (admin)"}
            </button>
          )}
        </div>
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

      <div className="mt-4">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Evidence</p>
        {(!incident.evidenceRows?.length && normalizeMediaUrls(incident.media_urls).length === 0) ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 italic">No evidence attached.</p>
        ) : (
          <StructuredEvidenceList
            items={incident.evidenceRows || []}
            emptyFallbackUrls={incident.media_urls}
            compact
            incidentSectionUpdates={evidenceSectionUpdates}
          />
        )}
      </div>

      {narrativeSectionUpdates.length > 0 && (
        <div className="mt-4 space-y-3">
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-2">
            <FaHistory className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            Official updates — report details ({narrativeSectionUpdates.length})
          </p>
          <div className="space-y-3">
            {narrativeSectionUpdates.map((u) => (
              <IncidentUpdateCard
                key={u.id}
                row={u}
                sectionLabel={INCIDENT_SECTION_LABELS[u.section_key] || u.section_key}
              />
            ))}
          </div>
        </div>
      )}

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
  const { user } = useAuth();
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleteBusyId, setDeleteBusyId] = useState(null);
  const [sortBy, setSortBy] = useState("incident_date");

  const showAdminDelete = canStaffManageIncidents(user?.role);

  const sortedIncidents = useMemo(() => {
    const list = [...incidents];
    list.sort((a, b) => compareIncidents(a, b, sortBy));
    return list;
  }, [incidents, sortBy]);

  const handleAdminDelete = async (incidentId) => {
    const msg =
      "Permanently delete this incident and all related data (evidence rows, suspects, profile links, match queue)?\n\n" +
      "Photos under this incident in Storage will be removed.\n\nThis cannot be undone.";
    if (!window.confirm(msg)) return;

    setDeleteBusyId(incidentId);
    try {
      const result = await deleteIncidentFully(incidentId);
      if (!result.ok) {
        toast.error(
          result.error?.includes("admin_delete_incident") || result.error?.includes("function")
            ? `Delete failed: ${result.error} — run the SQL migration admin_delete_incident in Supabase.`
            : `Delete failed: ${result.error || "Unknown error"}`
        );
        return;
      }
      toast.success("Incident deleted");
      setIncidents((prev) => prev.filter((i) => i.id !== incidentId));
    } finally {
      setDeleteBusyId(null);
    }
  };

  const fetchIncidents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from("incidents")
        .select("*")
        .eq("status", "approved");
        
      if (fetchError) throw fetchError;
      const rows = data || [];
      const ids = rows.map((i) => i.id);
      const evidenceMap = {};
      if (ids.length > 0) {
        const { data: evRows, error: evErr } = await supabase
          .from("incident_evidence")
          .select("*")
          .in("incident_id", ids)
          .order("created_at", { ascending: true });
        if (!evErr && evRows) {
          for (const row of evRows) {
            if (!evidenceMap[row.incident_id]) evidenceMap[row.incident_id] = [];
            evidenceMap[row.incident_id].push(row);
          }
        }
      }
      const updatesMap = {};
      if (ids.length > 0) {
        const { data: suRows, error: suErr } = await supabase
          .from("incident_section_updates")
          .select("*")
          .in("incident_id", ids)
          .order("created_at", { ascending: true });
        if (!suErr && suRows) {
          for (const row of suRows) {
            if (!updatesMap[row.incident_id]) updatesMap[row.incident_id] = [];
            updatesMap[row.incident_id].push(row);
          }
        }
      }
      setIncidents(
        rows.map((i) => ({
          ...i,
          evidenceRows: evidenceMap[i.id] || [],
          sectionUpdates: updatesMap[i.id] || [],
        }))
      );
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
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <BrandedLoader message="Loading incidents…" size="lg" />
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
          
          <div className="flex flex-wrap justify-end gap-2 sm:gap-3 items-center">
            <ThemeToggle variant="toolbar" />
            <button
              type="button"
              onClick={() => navigate("/incidents/print")}
              className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl transition text-sm font-medium shadow-sm"
            >
              <FaPrint className="w-4 h-4" />
              Print
            </button>
            <button
              type="button"
              onClick={() => navigate("/incidents/print?intent=pdf")}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-700 hover:bg-indigo-800 text-white rounded-xl transition text-sm font-medium shadow-sm"
            >
              <FaFilePdf className="w-4 h-4" />
              Save as PDF
            </button>
            <button
              type="button"
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
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-gray-100 dark:border-gray-700">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {incidents.length} approved report{incidents.length === 1 ? "" : "s"}
                </p>
                <label className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
                  <span className="text-gray-600 dark:text-gray-400 whitespace-nowrap font-medium">
                    Sort by
                  </span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent min-w-[min(100%,20rem)]"
                  >
                    {SORT_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id} className="dark:bg-gray-700">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {sortedIncidents.map((incident) => (
                <IncidentCard
                  key={incident.id}
                  incident={incident}
                  showAdminDelete={showAdminDelete}
                  onAdminDelete={handleAdminDelete}
                  deleteBusyId={deleteBusyId}
                  onOpenDetail={(id) => navigate(`/incidents/${id}`)}
                  onAdminEdit={(id) => navigate(`/incident/${id}/edit`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}