import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaArrowLeft, FaFileExcel, FaHistory, FaSearch } from "react-icons/fa";
import toast from "react-hot-toast";
import ExcelJS from "exceljs";
import { supabase } from "../supabase/client";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";
import { useAuth } from "../auth/useAuth";
import { canAccessPlatformConsole } from "../auth/platformRoles";
import { isGlobalAppRole } from "../auth/roleMatrix";
import { useActiveOrganization } from "../auth/useActiveOrganization";
import AreaContextBar from "../components/layout/AreaContextBar";
import ThemeToggle from "../components/ThemeToggle";
import BrandedLoader from "../components/layout/BrandedLoader";
import { displayWatchAreaName } from "../config/neighborhoodRegions";
import { formatWatchDateTime, watchDayStamp } from "../utils/watchTime";

const AUDIT_PAGE = 100;
const AUDIT_SQL_HINT = "Run the 20261003002000_audit_log_hardening.sql SQL in Supabase first.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AUDIT_ACTIONS = [
  ["", "All actions"],
  ["role_changed", "Role changed"],
  ["platform_role_changed", "Platform role changed"],
  ["resident_verified", "Verified"],
  ["resident_unverified", "Verification removed"],
  ["resident_assigned", "Assigned household"],
  ["area_broadcast", "Neighbourhood notice"],
  ["incident_moderated", "Incident moderated"],
  ["user_deleted", "User deleted"],
  ["account_self_deleted", "Account self-deleted"],
  ["city_hub_post_deleted", "City Hub post deleted"],
  ["city_hub_post_archived", "City Hub post archived"],
];

function formatWhen(iso) {
  if (!iso) return "—";
  return (
    formatWatchDateTime(iso, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) || "—"
  );
}

function roleLabel(role) {
  const r = String(role || "").toLowerCase();
  const labels = {
    nw_admin: "NW admin",
    committee: "Committee",
    technical_support: "Technical support",
    security_admin: "Security admin",
    city_admin: "City admin",
    admin: "Main admin",
    patroller: "Patroller",
    volunteer: "Volunteer",
    investigator: "Investigator",
    resident: "Resident",
  };
  if (labels[r]) return labels[r];
  return r ? r.replace(/_/g, " ") : "—";
}

function actionLabel(action) {
  switch (String(action || "")) {
    case "resident_verified":
      return "Verified resident";
    case "resident_unverified":
      return "Verification removed";
    case "resident_assigned":
      return "Assigned household";
    case "area_broadcast":
      return "Neighbourhood notice";
    case "role_changed":
      return "Role changed";
    case "platform_role_changed":
      return "Platform role changed";
    case "incident_moderated":
      return "Incident moderated";
    case "user_deleted":
      return "User deleted";
    case "account_self_deleted":
      return "Account self-deleted";
    case "city_hub_post_deleted":
      return "City Hub post deleted";
    case "city_hub_post_archived":
      return "City Hub post archived";
    default:
      return String(action || "Activity").replace(/_/g, " ");
  }
}

function actionDetail(row) {
  const d = row.details_json || {};
  if (row.action === "resident_verified") {
    return d.resident_name ? `Verified ${d.resident_name}` : "Verified a household";
  }
  if (row.action === "resident_unverified") {
    const who = d.resident_name || d.subject_name;
    return who ? `Verification removed for ${who}` : "Verification removed";
  }
  if (row.action === "resident_assigned") {
    return d.subject_name ? `Linked ${d.subject_name} to this suburb` : "Linked a household to a suburb";
  }
  if (row.action === "area_broadcast") {
    return d.headline || d.body_preview || "Posted a neighbourhood notice";
  }
  if (row.action === "role_changed") {
    const who = d.subject_name || "Member";
    return `${who}: ${roleLabel(d.from_role)} → ${roleLabel(d.to_role)}`;
  }
  if (row.action === "platform_role_changed") {
    const who = d.subject_name || "Member";
    return `${who}: ${d.from_platform_role || "none"} → ${d.to_platform_role || "none"}`;
  }
  if (row.action === "incident_moderated") {
    const title = d.title ? ` “${d.title}”` : "";
    return `${d.from_status || "?"} → ${d.to_status || "?"}${title}`;
  }
  if (row.action === "user_deleted" || row.action === "account_self_deleted") {
    const initials = d.subject_name_initials || "initials not recorded";
    const role = d.subject_role ? ` · ${roleLabel(d.subject_role)}` : "";
    const verb = row.action === "user_deleted" ? "Deleted account" : "Closed own account";
    return `${verb} ${initials}${role}`;
  }
  if (row.action === "city_hub_post_deleted" || row.action === "city_hub_post_archived") {
    return d.title || "City Hub post";
  }
  return "";
}

function sastBound(dateStr, end) {
  if (!dateStr) return null;
  const time = end ? "23:59:59.999" : "00:00:00.000";
  const ms = Date.parse(`${dateStr}T${time}+02:00`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function isBeforeIso(a, b) {
  if (!a || !b) return false;
  return Date.parse(a) < Date.parse(b);
}

function matchesActorText(row, actorQuery) {
  const q = actorQuery.trim();
  if (!q || UUID_RE.test(q)) return true;
  const hay = [row.actor_name, row.actor_role, actionDetail(row)].join(" ").toLowerCase();
  return hay.includes(q.toLowerCase());
}

async function fetchAuditPage({ limit, before, actionPrefix, actorId }) {
  return supabase.rpc("list_org_audit_log", {
    p_limit: limit,
    p_before: before,
    p_action_prefix: actionPrefix || null,
    p_actor: actorId,
  });
}

export default function AdminWatchStaffActivity() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeOrganizationId, activeOrganization } = useActiveOrganization();
  const canSeeStaffFeed =
    isGlobalAppRole(user?.role) || canAccessPlatformConsole(user?.platformRole);
  const [tab, setTab] = useState(canSeeStaffFeed ? "staff" : "audit");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState("");
  const [search, setSearch] = useState("");
  const [scopeAllAreas, setScopeAllAreas] = useState(false);
  const loadGen = useRef(0);

  const [auditRows, setAuditRows] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditLoadingMore, setAuditLoadingMore] = useState(false);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [actionPrefix, setActionPrefix] = useState("");
  const [actorQuery, setActorQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [exporting, setExporting] = useState(false);
  const auditGen = useRef(0);
  const auditCursor = useRef(null);
  const confirmedOrg = useRef(null);

  const actorId = UUID_RE.test(actorQuery.trim()) ? actorQuery.trim() : null;
  const fromIso = sastBound(fromDate, false);
  const toIso = sastBound(toDate, true);

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("list_watch_staff_activity", {
        p_limit: 250,
        p_role: roleFilter || null,
        p_all_areas: scopeAllAreas,
      });
      if (gen !== loadGen.current) return;
      if (error) {
        if (isRpcNotFoundError(error)) {
          toast.error("Apply the watch staff activity SQL on Supabase first.");
          setRows([]);
          return;
        }
        throw error;
      }
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      if (gen !== loadGen.current) return;
      console.error("Watch staff activity:", err);
      toast.error(err.message || "Could not load activity.");
      setRows([]);
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [roleFilter, scopeAllAreas]);

  useEffect(() => {
    if (tab !== "staff" || !canSeeStaffFeed) return;
    void load();
  }, [tab, canSeeStaffFeed, load]);

  const applyAuditBatch = useCallback((batch, reset) => {
    const inWindow = fromIso ? batch.filter((row) => !isBeforeIso(row.created_at, fromIso)) : batch;
    const passedStart = Boolean(fromIso && batch.some((row) => isBeforeIso(row.created_at, fromIso)));
    auditCursor.current = batch.length ? batch[batch.length - 1].created_at : auditCursor.current;
    setAuditHasMore(batch.length >= AUDIT_PAGE && !passedStart);
    setAuditRows((prev) => (reset ? inWindow : [...prev, ...inWindow]));
  }, [fromIso]);

  const loadAudit = useCallback(async ({ reset }) => {
    if (fromIso && toIso && Date.parse(fromIso) > Date.parse(toIso)) {
      toast.error("From date is after the to date.");
      setAuditRows([]);
      setAuditHasMore(false);
      return;
    }
    const gen = ++auditGen.current;
    if (reset) {
      setAuditLoading(true);
      auditCursor.current = toIso;
    } else {
      setAuditLoadingMore(true);
    }
    try {
      // Global staff switch the working area in the client first. Confirm it on
      // the server before reading, so the log matches the neighbourhood on screen.
      if (
        reset
        && canSeeStaffFeed
        && activeOrganizationId
        && confirmedOrg.current !== activeOrganizationId
      ) {
        const { error: areaError } = await supabase.rpc("set_active_organization", {
          p_organization_id: activeOrganizationId,
        });
        if (gen !== auditGen.current) return;
        if (areaError && !isRpcNotFoundError(areaError)) throw areaError;
        confirmedOrg.current = activeOrganizationId;
      }
      const { data, error } = await fetchAuditPage({
        limit: AUDIT_PAGE,
        before: reset ? toIso : auditCursor.current,
        actionPrefix,
        actorId,
      });
      if (gen !== auditGen.current) return;
      if (error) {
        if (isRpcNotFoundError(error)) {
          toast.error(AUDIT_SQL_HINT);
          setAuditRows([]);
          setAuditHasMore(false);
          return;
        }
        throw error;
      }
      applyAuditBatch(Array.isArray(data) ? data : [], reset);
    } catch (err) {
      if (gen !== auditGen.current) return;
      console.error("Org audit log:", err);
      toast.error(err.message || "Could not load the audit log.");
      if (reset) setAuditRows([]);
      setAuditHasMore(false);
    } finally {
      if (gen === auditGen.current) {
        setAuditLoading(false);
        setAuditLoadingMore(false);
      }
    }
  }, [actionPrefix, actorId, applyAuditBatch, fromIso, toIso, canSeeStaffFeed, activeOrganizationId]);

  useEffect(() => {
    if (tab !== "audit") return;
    void loadAudit({ reset: true });
  }, [tab, loadAudit]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (!scopeAllAreas && activeOrganizationId && row.organization_id !== activeOrganizationId) {
        return false;
      }
      if (!q) return true;
      const hay = [
        row.actor_name,
        row.actor_email,
        row.actor_role,
        row.action,
        row.organization_name,
        actionDetail(row),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, scopeAllAreas, activeOrganizationId]);

  const visibleAudit = useMemo(
    () => auditRows.filter((row) => matchesActorText(row, actorQuery)),
    [auditRows, actorQuery]
  );

  const suburbLabel =
    displayWatchAreaName(activeOrganization?.name) || activeOrganization?.name || "this suburb";

  const exportAudit = async () => {
    if (fromIso && toIso && Date.parse(fromIso) > Date.parse(toIso)) {
      toast.error("From date is after the to date.");
      return;
    }
    setExporting(true);
    try {
      const collected = [];
      let before = toIso;
      for (let page = 0; page < 20; page += 1) {
        const { data, error } = await fetchAuditPage({
          limit: 500,
          before,
          actionPrefix,
          actorId,
        });
        if (error) {
          if (isRpcNotFoundError(error)) {
            toast.error(AUDIT_SQL_HINT);
            return;
          }
          throw error;
        }
        const batch = Array.isArray(data) ? data : [];
        const inWindow = fromIso ? batch.filter((row) => !isBeforeIso(row.created_at, fromIso)) : batch;
        collected.push(...inWindow.filter((row) => matchesActorText(row, actorQuery)));
        const passedStart = Boolean(fromIso && batch.some((row) => isBeforeIso(row.created_at, fromIso)));
        if (batch.length < 500 || passedStart) break;
        before = batch[batch.length - 1].created_at;
      }

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Audit log");
      sheet.columns = [
        { header: "When", key: "when", width: 22 },
        { header: "Who", key: "who", width: 28 },
        { header: "Role", key: "role", width: 18 },
        { header: "Action", key: "action", width: 28 },
        { header: "Detail", key: "detail", width: 60 },
      ];
      sheet.getRow(1).font = { bold: true };
      collected.forEach((row) => {
        sheet.addRow({
          when: formatWhen(row.created_at),
          who: row.actor_name || "—",
          role: roleLabel(row.actor_role),
          action: actionLabel(row.action),
          detail: actionDetail(row) || "—",
        });
      });
      const buffer = await workbook.csv.writeBuffer();
      const blob = new Blob([buffer], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `audit_log_${watchDayStamp()}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${collected.length} audit rows.`);
    } catch (err) {
      console.error("Audit export:", err);
      toast.error(err.message || "Could not export the audit log.");
    } finally {
      setExporting(false);
    }
  };

  const showStaff = canSeeStaffFeed && tab === "staff";
  const showAudit = tab === "audit" || !canSeeStaffFeed;

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate("/admin")}
            className="inline-flex items-center gap-2 rounded-xl bg-gray-200 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            <FaArrowLeft className="h-3 w-3" aria-hidden />
            Back to Admin Dashboard
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <AreaContextBar />
            <ThemeToggle variant="toolbar" />
          </div>
        </div>

        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white">
            <FaHistory className="h-5 w-5 text-slate-600 dark:text-slate-300" aria-hidden />
            {showStaff ? "NW admin & committee activity" : "Audit log"}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {showStaff
              ? "Actions by neighbourhood staff and other non-resident actors — verifying households, notices, role changes, and incident moderation. Visible to main admin and technical support."
              : `Every logged action for ${suburbLabel}. Neighbourhood admins see their own watch. Main admin and technical support see the working area.`}
          </p>
        </div>

        {canSeeStaffFeed ? (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Activity views">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "staff"}
              onClick={() => setTab("staff")}
              className={`rounded-xl px-4 py-2 text-sm font-medium ${
                tab === "staff"
                  ? "bg-slate-700 text-white"
                  : "bg-white text-gray-700 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700"
              }`}
            >
              Staff activity
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "audit"}
              onClick={() => setTab("audit")}
              className={`rounded-xl px-4 py-2 text-sm font-medium ${
                tab === "audit"
                  ? "bg-slate-700 text-white"
                  : "bg-white text-gray-700 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700"
              }`}
            >
              Audit log
            </button>
          </div>
        ) : null}

        {showStaff ? (
          <>
            <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div>
                <label htmlFor="staff-activity-role" className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                  Role
                </label>
                <select
                  id="staff-activity-role"
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="mt-1 rounded-lg border px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                >
                  <option value="">All non-resident actors</option>
                  <option value="nw_admin">NW admin</option>
                  <option value="committee">Committee</option>
                  <option value="patroller">Patroller</option>
                  <option value="volunteer">Volunteer</option>
                  <option value="investigator">Investigator</option>
                  <option value="admin">Main admin</option>
                  <option value="technical_support">Technical support</option>
                </select>
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={scopeAllAreas}
                  onChange={(e) => setScopeAllAreas(e.target.checked)}
                  className="h-4 w-4"
                />
                All suburbs
              </label>
              <div className="relative min-w-[12rem] flex-1">
                <FaSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, action, suburb"
                  className="w-full rounded-lg border py-2 pl-10 pr-3 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                />
              </div>
            </div>

            {loading ? (
              <div className="flex justify-center py-16">
                <BrandedLoader message="Loading activity…" size="md" />
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-100 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    <tr>
                      <th className="px-4 py-3">When</th>
                      <th className="px-4 py-3">Who</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Suburb</th>
                      <th className="px-4 py-3">Action</th>
                      <th className="px-4 py-3">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                          {scopeAllAreas
                            ? "No staff activity recorded yet."
                            : `No activity for ${suburbLabel} yet. Try “All suburbs”.`}
                        </td>
                      </tr>
                    ) : (
                      visible.map((row) => (
                        <tr
                          key={row.id}
                          className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40"
                        >
                          <td className="whitespace-nowrap px-4 py-3 text-gray-700 dark:text-gray-300">
                            {formatWhen(row.created_at)}
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900 dark:text-white">{row.actor_name || "—"}</p>
                            {row.actor_email ? (
                              <p className="text-xs text-gray-500 dark:text-gray-400">{row.actor_email}</p>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-gray-700 dark:text-gray-300">
                            {roleLabel(row.actor_role)}
                          </td>
                          <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                            {displayWatchAreaName(row.organization_name) || row.organization_name || "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900 dark:text-white">
                            {actionLabel(row.action)}
                          </td>
                          <td className="max-w-sm px-4 py-3 text-gray-600 dark:text-gray-300">
                            {actionDetail(row) || "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}

        {showAudit ? (
          <>
            <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div>
                <label htmlFor="audit-action" className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                  Action
                </label>
                <select
                  id="audit-action"
                  value={actionPrefix}
                  onChange={(e) => setActionPrefix(e.target.value)}
                  className="mt-1 rounded-lg border px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                >
                  {AUDIT_ACTIONS.map(([value, label]) => (
                    <option key={value || "all"} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="audit-from" className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                  From
                </label>
                <input
                  id="audit-from"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="mt-1 rounded-lg border px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label htmlFor="audit-to" className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                  To
                </label>
                <input
                  id="audit-to"
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="mt-1 rounded-lg border px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                />
              </div>
              <div className="relative min-w-[12rem] flex-1">
                <label htmlFor="audit-actor" className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                  Actor
                </label>
                <input
                  id="audit-actor"
                  type="search"
                  value={actorQuery}
                  onChange={(e) => setActorQuery(e.target.value)}
                  placeholder="Name, or paste a user id"
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                />
              </div>
              <button
                type="button"
                onClick={() => void exportAudit()}
                disabled={exporting || auditLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                <FaFileExcel className="h-4 w-4" aria-hidden />
                {exporting ? "Exporting…" : "Export CSV"}
              </button>
            </div>

            {auditLoading ? (
              <div className="flex justify-center py-16">
                <BrandedLoader message="Loading audit log…" size="md" />
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-100 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    <tr>
                      <th className="px-4 py-3">When</th>
                      <th className="px-4 py-3">Who</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Action</th>
                      <th className="px-4 py-3">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAudit.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                          No audit rows for {suburbLabel} yet.
                        </td>
                      </tr>
                    ) : (
                      visibleAudit.map((row) => (
                        <tr
                          key={row.id}
                          className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40"
                        >
                          <td className="whitespace-nowrap px-4 py-3 text-gray-700 dark:text-gray-300">
                            {formatWhen(row.created_at)}
                          </td>
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                            {row.actor_name || "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-gray-700 dark:text-gray-300">
                            {roleLabel(row.actor_role)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900 dark:text-white">
                            {actionLabel(row.action)}
                          </td>
                          <td className="max-w-sm px-4 py-3 text-gray-600 dark:text-gray-300">
                            {actionDetail(row) || "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {auditHasMore ? (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => void loadAudit({ reset: false })}
                  disabled={auditLoadingMore}
                  className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {auditLoadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
