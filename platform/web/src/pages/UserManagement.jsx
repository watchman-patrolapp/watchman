import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { normalizeAppRole } from "../auth/staffRoles";
import { GLOBAL_APP_ROLE_LABELS, GLOBAL_APP_ROLES, isGlobalAppRole, isResidentAppRole } from "../auth/roleMatrix";
import { useActiveOrganization } from "../auth/useActiveOrganization";
import AreaContextBar from "../components/layout/AreaContextBar";
import { supabase } from "../supabase/client"; // ✅ Supabase client
import { isRpcNotFoundError } from "../utils/isRpcNotFound";
import toast from "react-hot-toast";
import { FaTrash } from "react-icons/fa";
import ThemeToggle from "../components/ThemeToggle";
import BrandedLoader from "../components/layout/BrandedLoader";
import { assignResidentToNeighborhood } from "../utils/residentVerification";
import { displayWatchAreaName } from "../config/neighborhoodRegions";
import { parsePatrolTime } from "../utils/watchTime";

function InlineConfirm({ label, onConfirm, onCancel, disabled }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled}
        className="px-2 py-1 text-white text-xs rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50"
      >
        Yes
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={disabled}
        className="px-2 py-1 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 text-xs rounded-lg"
      >
        No
      </button>
    </div>
  );
}

export default function UserManagement() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const { activeOrganizationId, activeOrganization, organizations, isGlobalOperator } =
    useActiveOrganization();
  const [users, setUsers] = useState([]);
  const [memberUserIds, setMemberUserIds] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [pendingDeleteUid, setPendingDeleteUid] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [busyUid, setBusyUid] = useState(null);
  const [assignTargetByUid, setAssignTargetByUid] = useState({});
  const [sortBy, setSortBy] = useState("name");

  const currentRole = normalizeAppRole(currentUser?.role);
  const canDeleteUsers = currentRole === "admin" || currentRole === "technical_support";

  const globalSlots = useMemo(
    () =>
      GLOBAL_APP_ROLES.map((role) => ({
        role,
        label: GLOBAL_APP_ROLE_LABELS[role],
        accounts: users.filter((u) => normalizeAppRole(u.role) === role),
      })),
    [users]
  );

  const neighborhoodUsers = useMemo(() => {
    if (!activeOrganizationId) {
      return [];
    }
    return users.filter((u) => {
      if (isGlobalAppRole(u.role) || isResidentAppRole(u.role)) return false;
      if (u.organizationId === activeOrganizationId || memberUserIds.has(u.uid)) return true;
      return Boolean(isGlobalOperator && !u.organizationId);
    });
  }, [users, activeOrganizationId, memberUserIds, isGlobalOperator]);

  const sortedUsers = useMemo(() => {
    const list = [...neighborhoodUsers];
    const tie = (a, b) => String(a.uid).localeCompare(String(b.uid));
    list.sort((a, b) => {
      if (sortBy === "joined_desc" || sortBy === "joined_asc") {
        const ta = parsePatrolTime(a.createdAt)?.getTime() || 0;
        const tb = parsePatrolTime(b.createdAt)?.getTime() || 0;
        if (ta !== tb) return sortBy === "joined_desc" ? tb - ta : ta - tb;
        return tie(a, b);
      }
      if (sortBy === "name") {
        const va = (a.fullName || "").trim().toLowerCase() || "\uffff";
        const vb = (b.fullName || "").trim().toLowerCase() || "\uffff";
        const c = va.localeCompare(vb, undefined, { sensitivity: "base" });
        return c !== 0 ? c : tie(a, b);
      }
      if (sortBy === "email") {
        const va = (a.email || "").trim().toLowerCase() || "\uffff";
        const vb = (b.email || "").trim().toLowerCase() || "\uffff";
        const c = va.localeCompare(vb, undefined, { sensitivity: "base" });
        return c !== 0 ? c : tie(a, b);
      }
      const va = (a.role || "volunteer").toLowerCase();
      const vb = (b.role || "volunteer").toLowerCase();
      const c = va.localeCompare(vb, undefined, { sensitivity: "base" });
      return c !== 0 ? c : tie(a, b);
    });
    return list;
  }, [neighborhoodUsers, sortBy]);

  useEffect(() => {
    let cancelled = false;
    async function fetchUsers() {
      setLoading(true);
      try {
        const { data: rpcRows, error: rpcErr } = await supabase.rpc("list_users_for_staff");
        let raw = [];
        if (!rpcErr && Array.isArray(rpcRows)) {
          raw = rpcRows;
        } else {
          if (rpcErr && !isRpcNotFoundError(rpcErr)) {
            console.warn("UserManagement: list_users_for_staff", rpcErr.message);
          }
          const { data, error } = await supabase
            .from("users")
            .select("*")
            .order("created_at", { ascending: false });
          if (error) throw error;
          raw = data || [];
        }

        const usersData = raw.map((u) => ({
          uid: u.id,
          fullName: u.full_name,
          email: u.email,
          role: u.role || "volunteer",
          createdAt: u.created_at || null,
          organizationId: u.organization_id || null,
        }));
        const { data: memberRows, error: memberErr } = activeOrganizationId
          ? await supabase
              .from("organization_members")
              .select("user_id")
              .eq("organization_id", activeOrganizationId)
              .eq("status", "active")
          : { data: [], error: null };
        if (memberErr) throw memberErr;
        if (!cancelled) {
          setUsers(usersData);
          setMemberUserIds(new Set((memberRows || []).map((row) => row.user_id)));
        }
      } catch (err) {
        console.error("Error fetching users:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchUsers();
    return () => {
      cancelled = true;
    };
  }, [activeOrganizationId]);

  const handleRoleChange = async (uid, newRole) => {
    if (isGlobalAppRole(newRole)) {
      toast.error("Main admin and technical support are global and cannot be assigned here.");
      return;
    }
    try {
      const { error } = await supabase
        .from('users')
        .update({ role: newRole })
        .eq('id', uid);

      if (error) throw error;

      setUsers(users.map(u => u.uid === uid ? { ...u, role: newRole } : u));
      if (isResidentAppRole(newRole)) {
        toast.success("Moved to Residents.");
      } else if (activeOrganizationId) {
        const { error: assignErr } = await assignResidentToNeighborhood(uid, activeOrganizationId);
        if (!assignErr) {
          setMemberUserIds((prev) => new Set(prev).add(uid));
          setUsers((prev) =>
            prev.map((u) => (u.uid === uid ? { ...u, role: newRole, organizationId: activeOrganizationId } : u))
          );
        }
      }
    } catch (err) {
      console.error("Error updating role:", err);
      alert("Failed to update role. Check console.");
    }
  };

  const handleAssignToNeighborhood = async (uid, organizationId) => {
    if (busyUid) return;
    const orgId = organizationId || activeOrganizationId;
    if (!orgId) {
      toast.error("Select a neighborhood first.");
      return;
    }
    setBusyUid(uid);
    try {
      const { data, error } = await assignResidentToNeighborhood(uid, orgId);
      if (error) {
        if (isRpcNotFoundError(error)) {
          toast.error("Apply the move-to-suburb SQL on Supabase first.");
          return;
        }
        throw error;
      }
      const linkedId = data?.organization_id || orgId;
      const label =
        displayWatchAreaName(data?.organization_name) ||
        displayWatchAreaName(organizations.find((org) => org.id === linkedId)?.name) ||
        "this neighborhood";
      setMemberUserIds((prev) => {
        const next = new Set(prev);
        next.delete(uid);
        if (linkedId === activeOrganizationId) next.add(uid);
        return next;
      });
      setUsers((prev) =>
        prev.map((row) => (row.uid === uid ? { ...row, organizationId: linkedId } : row))
      );
      toast.success(`Moved to ${label}.`);
    } catch (err) {
      console.error("Assign watch member failed:", err);
      toast.error(err.message || "Could not move this user.");
    } finally {
      setBusyUid(null);
    }
  };

  const handleDeleteUser = async (uid) => {
    if (deleteLoading) return;
    setDeleteLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-delete-user", {
        body: { userId: uid },
      });

      if (error) {
        let msg = error.message || "Request failed";
        try {
          const ctx = error.context;
          if (ctx && typeof ctx.json === "function") {
            const bodyJson = await ctx.json();
            if (bodyJson?.error) msg = String(bodyJson.error);
          }
        } catch {
          /* keep msg */
        }
        throw new Error(msg);
      }

      if (data && typeof data === "object" && "error" in data && data.error) {
        throw new Error(String(data.error));
      }

      setUsers((prev) => prev.filter((u) => u.uid !== uid));
      setPendingDeleteUid(null);
      toast.success("User deleted.");
    } catch (err) {
      console.error("Delete user failed:", err);
      toast.error(err.message || "Failed to delete user. Deploy the admin-delete-user Edge Function if this persists.");
    } finally {
      setDeleteLoading(false);
    }
  };


  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 dark:bg-gray-900">
        <BrandedLoader message="Loading users…" size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate("/admin")}
            className="bg-gray-500 text-white dark:bg-gray-600 px-4 py-2 rounded hover:bg-gray-600 dark:hover:bg-gray-700 transition"
          >
            ← Back to Admin Dashboard
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <AreaContextBar />
            <ThemeToggle variant="toolbar" />
            <label htmlFor="user-mgmt-sort" className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
              Sort by
            </label>
            <select
              id="user-mgmt-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="border rounded px-2 py-1.5 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-white min-w-[10rem]"
            >
              <option value="name">Name</option>
              <option value="email">Email</option>
              <option value="role">Current role</option>
              <option value="joined_desc">Date joined (newest)</option>
              <option value="joined_asc">Date joined (oldest)</option>
            </select>
          </div>
        </div>
        <h1 className="text-2xl font-bold dark:text-white">User Management</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Watch and operational accounts for this neighborhood. To move someone later, pick their new suburb
          under their name and choose Move. Create that neighborhood first under Organizations if it does not
          exist yet.
        </p>
        <button
          type="button"
          onClick={() => navigate("/admin/residents")}
          className="mt-2 text-sm font-medium text-teal-700 dark:text-teal-400 hover:underline"
        >
          Open Residents →
        </button>
      </div>

      <section className="bg-white dark:bg-gray-800 p-4 rounded shadow mb-6">
        <h2 className="text-lg font-semibold dark:text-white">Global accounts</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 mb-4">
          Main admin and technical support are platform-wide. They are not transferred into a neighborhood
          and each area keeps its own NW admin.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {globalSlots.map((slot) => (
            <div key={slot.role} className="border rounded-lg p-3 dark:border-gray-700">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="font-medium text-gray-900 dark:text-white">{slot.label}</p>
                <span className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                  Global
                </span>
              </div>
              {slot.accounts.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">Not assigned yet</p>
              ) : (
                <ul className="space-y-2">
                  {slot.accounts.map((account) => (
                    <li key={account.uid} className="text-sm text-gray-700 dark:text-gray-300">
                      <p className="font-medium">{account.fullName || "—"}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{account.email || "No email"}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="bg-white dark:bg-gray-800 p-4 rounded shadow overflow-x-auto">
        <h2 className="text-lg font-semibold dark:text-white mb-3">
          Watch users{activeOrganization ? ` · ${activeOrganization.name}` : ""}
        </h2>
        <table className="min-w-full border dark:border-gray-700">
          <thead className="bg-gray-200 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-2 border dark:border-gray-600 dark:text-white">Name</th>
              <th className="px-4 py-2 border dark:border-gray-600 dark:text-white">Email</th>
              <th className="px-4 py-2 border dark:border-gray-600 dark:text-white">Current Role</th>
              <th className="px-4 py-2 border dark:border-gray-600 dark:text-white">Change Role</th>
              {canDeleteUsers && (
                <th className="px-4 py-2 border dark:border-gray-600 dark:text-white w-48">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedUsers.length === 0 ? (
              <tr>
                <td
                  colSpan={canDeleteUsers ? 5 : 4}
                  className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  No watch users in this neighborhood. Registered residents are on the{" "}
                  <button
                    type="button"
                    onClick={() => navigate("/admin/residents")}
                    className="font-medium text-teal-700 dark:text-teal-400 hover:underline"
                  >
                    Residents
                  </button>{" "}
                  page.
                </td>
              </tr>
            ) : null}
            {sortedUsers.map(u => {
              const linkedToArea =
                u.organizationId === activeOrganizationId || memberUserIds.has(u.uid);
              const moveTarget =
                assignTargetByUid[u.uid] ||
                (!linkedToArea ? activeOrganizationId : "") ||
                "";
              return (
              <tr key={u.uid} className="border-b hover:bg-gray-50 dark:hover:bg-gray-700 dark:border-gray-700">
                <td className="px-4 py-2 border dark:border-gray-600 dark:text-gray-300">
                  <p>{u.fullName || "—"}</p>
                  {!linkedToArea ? (
                    <p className="mt-1 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                      Not linked to this neighborhood
                    </p>
                  ) : null}
                  {isGlobalOperator ? (
                    <div className="mt-1.5 space-y-1">
                      <select
                        value={moveTarget}
                        onChange={(event) =>
                          setAssignTargetByUid((prev) => ({
                            ...prev,
                            [u.uid]: event.target.value,
                          }))
                        }
                        className="w-full max-w-[14rem] rounded border px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        aria-label={`Suburb for ${u.fullName || "user"}`}
                      >
                        <option value="">
                          {linkedToArea ? "Move to suburb…" : "Assign to suburb…"}
                        </option>
                        {organizations.map((org) => (
                          <option key={org.id} value={org.id}>
                            {displayWatchAreaName(org.name)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleAssignToNeighborhood(u.uid, moveTarget)}
                        disabled={
                          busyUid === u.uid ||
                          !moveTarget ||
                          (linkedToArea && moveTarget === u.organizationId)
                        }
                        className="px-2 py-1 text-xs rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
                      >
                        {busyUid === u.uid
                          ? "Saving…"
                          : linkedToArea
                            ? `Move to ${displayWatchAreaName(
                                organizations.find((org) => org.id === moveTarget)?.name
                              ) || "suburb"}`
                            : `Assign to ${displayWatchAreaName(
                                organizations.find((org) => org.id === moveTarget)?.name
                              ) || "suburb"}`}
                      </button>
                    </div>
                  ) : !linkedToArea ? (
                    <button
                      type="button"
                      onClick={() => void handleAssignToNeighborhood(u.uid, activeOrganizationId)}
                      disabled={busyUid === u.uid || !activeOrganizationId}
                      className="mt-1.5 px-2 py-1 text-xs rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
                    >
                      {busyUid === u.uid
                        ? "Assigning…"
                        : `Assign to ${displayWatchAreaName(activeOrganization?.name) || "this suburb"}`}
                    </button>
                  ) : null}
                </td>
                <td className="px-4 py-2 border dark:border-gray-600 dark:text-gray-300">{u.email}</td>
                <td className="px-4 py-2 border dark:border-gray-600">
                  <span className={`px-2 py-1 rounded text-sm ${
                    u.role === 'admin' 
                      ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' 
                      : u.role === 'nw_admin' || u.role === 'city_admin' || u.role === 'security_admin'
                      ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200'
                      : u.role === 'committee' 
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' 
                      : u.role === 'technical_support'
                      ? 'bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200'
                      : u.role === 'patroller' || u.role === 'investigator'
                      ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200'
                      : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                  }`}>
                    {u.role || 'volunteer'}
                  </span>
                </td>
                <td className="px-4 py-2 border dark:border-gray-600">
                  <select
                    value={u.role || 'volunteer'}
                    onChange={(e) => handleRoleChange(u.uid, e.target.value)}
                    className="border rounded px-2 py-1 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    disabled={
                      u.uid === currentUser?.id ||
                      String(u.role || '').toLowerCase() === 'technical_support'
                    }
                  >
                    <option value="resident" className="dark:bg-gray-700">Resident</option>
                    <option value="volunteer" className="dark:bg-gray-700">Volunteer</option>
                    <option value="patroller" className="dark:bg-gray-700">Patroller</option>
                    <option value="investigator" className="dark:bg-gray-700">Investigator</option>
                    <option value="nw_admin" className="dark:bg-gray-700">NW Admin</option>
                    <option value="security_admin" className="dark:bg-gray-700">Security Admin</option>
                    <option value="city_admin" className="dark:bg-gray-700">City Admin</option>
                    <option value="committee" className="dark:bg-gray-700">Committee</option>
                  </select>
                </td>
                {canDeleteUsers && (
                  <td className="px-4 py-2 border dark:border-gray-600 align-top">
                    {u.uid === currentUser?.id ? (
                      <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                    ) : pendingDeleteUid === u.uid ? (
                      <InlineConfirm
                        label="Delete this user?"
                        disabled={deleteLoading}
                        onConfirm={() => handleDeleteUser(u.uid)}
                        onCancel={() => setPendingDeleteUid(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPendingDeleteUid(u.uid)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 transition"
                        title="Remove account (auth + profile)"
                      >
                        <FaTrash className="text-[10px]" />
                        Delete
                      </button>
                    )}
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}