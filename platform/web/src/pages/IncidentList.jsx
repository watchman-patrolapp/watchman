import { useState, useEffect, useMemo, useRef, useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useAuth } from "../auth/useAuth";
import { deleteIncidentFully } from "../utils/deleteIncident";
import ThemeToggle from "../components/ThemeToggle";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import Skeleton from "../components/ui/Skeleton";
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
import toast from "../utils/notify";
import StructuredEvidenceList, { normalizeMediaUrls } from "../components/evidence/StructuredEvidenceList";
import IncidentUpdateCard from "../components/incident/IncidentUpdateCard";
import { INCIDENT_SECTION_LABELS } from "../constants/incidentSectionUpdates";
import { canStaffManageIncidents } from "../auth/staffRoles";
import { useScopedOrganization } from "../utils/organizationScope";
import { parsePatrolTime } from "../utils/watchTime";
import { approvedIncidentsQueryKey, fetchApprovedIncidentPage } from "../utils/incidentListQuery";

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
  const parsed = parsePatrolTime(d);
  if (parsed) return parsed.getTime();
  // Date-only YYYY-MM-DD → noon SAST so sort day is stable in ZA.
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = new Date(`${s}T12:00:00+02:00`).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
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
    const d = parsePatrolTime(dateStr) || (/^\d{4}-\d{2}-\d{2}/.test(String(dateStr || ""))
      ? new Date(`${String(dateStr).slice(0, 10)}T12:00:00+02:00`)
      : null);
    if (!d || Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString('en-ZA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
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
            className="inline-flex min-h-11 items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition"
          >
            Details
            <FaChevronRight className="w-3 h-3" />
          </button>
          {showAdminDelete && (
            <button
              type="button"
              onClick={() => onAdminEdit(incident.id)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-3 py-1 text-xs font-medium text-white shadow-[inset_0_0_0_2px_var(--color-primary-edge)] transition hover:bg-primary-800"
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
              className="inline-flex min-h-11 items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg bg-danger text-white hover:bg-danger disabled:opacity-50 disabled:cursor-not-allowed transition"
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
        {incident.evidenceUnknown ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">Evidence could not be loaded.</p>
        ) : (!incident.evidenceRows?.length && normalizeMediaUrls(incident.media_urls).length === 0) ? (
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
  const { scope, activeOrganizationId, includeUnscoped } = useScopedOrganization();
  const queryClient = useQueryClient();
  const [deleteBusyId, setDeleteBusyId] = useState(null);
  const [sortBy, setSortBy] = useState("incident_date");
  const listRef = useRef(null);
  const loadMoreRef = useRef(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const showAdminDelete = canStaffManageIncidents(user?.role);
  const queryKey = approvedIncidentsQueryKey(activeOrganizationId, includeUnscoped);

  const incidentsQuery = useInfiniteQuery({
    queryKey,
    initialPageParam: null,
    staleTime: 30_000,
    queryFn: ({ pageParam }) => fetchApprovedIncidentPage({ scope, pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const incidents = useMemo(
    () => (incidentsQuery.data?.pages || []).flatMap((page) => page.rows),
    [incidentsQuery.data]
  );
  const evidenceFailed = (incidentsQuery.data?.pages || []).some((page) => page.evidenceFailed);
  const updatesFailed = (incidentsQuery.data?.pages || []).some((page) => page.updatesFailed);
  const loading = incidentsQuery.isLoading;
  const error = incidentsQuery.isError && incidents.length === 0 ? incidentsQuery.error?.message || "Failed to load incidents" : null;

  const sortedIncidents = useMemo(() => {
    const list = [...incidents];
    list.sort((a, b) => compareIncidents(a, b, sortBy));
    return list;
  }, [incidents, sortBy]);

  const handleAdminDelete = async (incidentId) => {
    if (deleteBusyId) return;
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
      queryClient.setQueryData(queryKey, (old) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            rows: page.rows.filter((row) => row.id !== incidentId),
          })),
        };
      });
    } finally {
      setDeleteBusyId(null);
    }
  };

  const retryIncidents = () => {
    void incidentsQuery.refetch();
  };

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
  }, [sortedIncidents.length, sortBy, evidenceFailed, updatesFailed]);

  const virtualizer = useWindowVirtualizer({
    count: sortedIncidents.length,
    estimateSize: () => 420,
    overscan: 4,
    scrollMargin,
    getItemKey: (index) => sortedIncidents[index]?.id ?? index,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = incidentsQuery;

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasNextPage) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
        void fetchNextPage();
      }
    }, { rootMargin: "240px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, sortedIncidents.length]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="inline-flex min-h-11 items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 transition text-sm font-medium"
          >
            <FaArrowLeft className="w-3 h-3" aria-hidden />
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
              className="inline-flex min-h-11 items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl transition text-sm font-medium shadow-sm"
            >
              <FaPrint className="w-4 h-4" />
              Print
            </button>
            <button
              type="button"
              onClick={() => navigate("/incidents/print?intent=pdf")}
              className="inline-flex min-h-11 items-center gap-2 px-4 py-2 bg-indigo-700 hover:bg-indigo-800 text-white rounded-xl transition text-sm font-medium shadow-sm"
            >
              <FaFilePdf className="w-4 h-4" />
              Save as PDF
            </button>
            <Button type="button" onClick={() => navigate("/incident/new")}>
              <FaPlus className="mr-2 h-4 w-4" aria-hidden />
              Report
            </Button>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="mb-6">
            <ErrorState title="Failed to load incidents" message={error} onRetry={retryIncidents} />
          </div>
        )}

        {/* Content */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
          {loading ? (
            <Skeleton lines={6} />
          ) : incidents.length === 0 ? (
            <EmptyState
              title="No incidents reported yet."
              message="Approved reports from your neighbourhood will show up here."
              icon={FaExclamationTriangle}
            />
          ) : (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-gray-100 dark:border-gray-700">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {incidents.length} approved report{incidents.length === 1 ? "" : "s"}
                  {incidentsQuery.hasNextPage ? " loaded" : ""}
                </p>
                <label htmlFor="incident-sort" className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
                  <span className="text-gray-600 dark:text-gray-400 whitespace-nowrap font-medium">
                    Sort by
                  </span>
                  <select
                    id="incident-sort"
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
              {(evidenceFailed || updatesFailed) && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                  {evidenceFailed ? "Some evidence failed to load — " : "Some official updates failed to load — "}
                  <button type="button" onClick={retryIncidents} className="font-semibold underline">
                    Retry
                  </button>
                </div>
              )}
              <div ref={listRef}>
                <div
                  className="relative w-full"
                  style={{ height: virtualizer.getTotalSize() }}
                >
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const incident = sortedIncidents[virtualRow.index];
                    if (!incident) return null;
                    return (
                      <div
                        key={virtualRow.key}
                        data-index={virtualRow.index}
                        ref={virtualizer.measureElement}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
                        }}
                      >
                        <div className="pb-6">
                          <IncidentCard
                            incident={incident}
                            showAdminDelete={showAdminDelete}
                            onAdminDelete={handleAdminDelete}
                            deleteBusyId={deleteBusyId}
                            onOpenDetail={(id) => navigate(`/incidents/${id}`)}
                            onAdminEdit={(id) => navigate(`/incident/${id}/edit`)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {incidentsQuery.hasNextPage && (
                <div ref={loadMoreRef} className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={() => void incidentsQuery.fetchNextPage()}
                    disabled={incidentsQuery.isFetchingNextPage}
                    className="inline-flex min-h-11 items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl text-sm font-medium disabled:opacity-60"
                  >
                    <FaSync className={`w-3.5 h-3.5 ${incidentsQuery.isFetchingNextPage ? "animate-spin" : ""}`} />
                    {incidentsQuery.isFetchingNextPage ? "Loading more…" : "Load more"}
                  </button>
                </div>
              )}
              {incidentsQuery.isFetchNextPageError && (
                <p className="text-center text-sm text-red-600 dark:text-red-400">
                  Could not load more reports —{" "}
                  <button type="button" onClick={() => void incidentsQuery.fetchNextPage()} className="font-semibold underline">
                    Retry
                  </button>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}