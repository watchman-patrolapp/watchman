import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaArrowLeft, FaHistory, FaSearch } from "react-icons/fa";
import toast from "react-hot-toast";
import { supabase } from "../supabase/client";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";
import { useActiveOrganization } from "../auth/useActiveOrganization";
import AreaContextBar from "../components/layout/AreaContextBar";
import ThemeToggle from "../components/ThemeToggle";
import BrandedLoader from "../components/layout/BrandedLoader";
import { displayWatchAreaName } from "../config/neighborhoodRegions";
import { formatWatchDateTime } from "../utils/watchTime";

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
  if (r === "nw_admin") return "NW admin";
  if (r === "committee") return "Committee";
  return r || "—";
}

function actionLabel(action) {
  switch (String(action || "")) {
    case "resident_verified":
      return "Verified resident";
    case "resident_assigned":
      return "Assigned household";
    case "area_broadcast":
      return "Neighbourhood notice";
    case "role_changed":
      return "Role changed";
    case "incident_moderated":
      return "Incident moderated";
    default:
      return String(action || "Activity").replace(/_/g, " ");
  }
}

function actionDetail(row) {
  const d = row.details_json || {};
  if (row.action === "resident_verified") {
    return d.resident_name ? `Verified ${d.resident_name}` : "Verified a household";
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
  if (row.action === "incident_moderated") {
    const title = d.title ? ` “${d.title}”` : "";
    return `${d.from_status || "?"} → ${d.to_status || "?"}${title}`;
  }
  return "";
}

export default function AdminWatchStaffActivity() {
  const navigate = useNavigate();
  const { activeOrganizationId, activeOrganization } = useActiveOrganization();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState("");
  const [search, setSearch] = useState("");
  const [scopeAllAreas, setScopeAllAreas] = useState(false);
  const loadGen = useRef(0);

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
    void load();
  }, [load]);

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

  const suburbLabel =
    displayWatchAreaName(activeOrganization?.name) || activeOrganization?.name || "this suburb";

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
            NW admin & committee activity
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Actions by neighborhood admins and committee — verifying households, notices, role
            changes, and incident moderation. Visible to main admin and technical support.
          </p>
        </div>

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
              <option value="">All (NW admin + committee)</option>
              <option value="nw_admin">NW admin</option>
              <option value="committee">Committee</option>
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
                        ? "No NW admin or committee activity recorded yet."
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
      </div>
    </div>
  );
}
