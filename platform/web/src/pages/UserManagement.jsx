import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../supabase/client"; // ✅ Supabase client
import toast from "react-hot-toast";
import { FaTrash } from "react-icons/fa";
import ThemeToggle from "../components/ThemeToggle";
import BrandedLoader from "../components/layout/BrandedLoader";

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
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pendingDeleteUid, setPendingDeleteUid] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [sortBy, setSortBy] = useState("name");

  const currentRole = String(currentUser?.role || "").toLowerCase();
  const isAdmin = currentRole === "admin";
  const canDeleteUsers = currentRole === "admin" || currentRole === "technical_support";

  const sortedUsers = useMemo(() => {
    const list = [...users];
    const tie = (a, b) => String(a.uid).localeCompare(String(b.uid));
    list.sort((a, b) => {
      if (sortBy === "joined_desc" || sortBy === "joined_asc") {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
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
  }, [users, sortBy]);

  useEffect(() => {
    async function fetchUsers() {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;

        // Map Supabase fields to the expected format (uid, fullName, email, role)
        const usersData = (data || []).map(u => ({
          uid: u.id,
          fullName: u.full_name,
          email: u.email,
          role: u.role || 'volunteer',
          createdAt: u.created_at || null,
          // Include other fields if needed (e.g., address, carType, etc.) but not used here
        }));
        setUsers(usersData);
      } catch (err) {
        console.error("Error fetching users:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchUsers();
  }, []);

  const handleRoleChange = async (uid, newRole) => {
    try {
      const { error } = await supabase
        .from('users')
        .update({ role: newRole })
        .eq('id', uid);

      if (error) throw error;

      // Update local state
      setUsers(users.map(u => u.uid === uid ? { ...u, role: newRole } : u));
    } catch (err) {
      console.error("Error updating role:", err);
      alert("Failed to update role. Check console.");
    }
  };

  const handleDeleteUser = async (uid) => {
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
      </div>

      <div className="bg-white dark:bg-gray-800 p-4 rounded shadow overflow-x-auto">
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
            {sortedUsers.map(u => (
              <tr key={u.uid} className="border-b hover:bg-gray-50 dark:hover:bg-gray-700 dark:border-gray-700">
                <td className="px-4 py-2 border dark:border-gray-600 dark:text-gray-300">{u.fullName || "—"}</td>
                <td className="px-4 py-2 border dark:border-gray-600 dark:text-gray-300">{u.email}</td>
                <td className="px-4 py-2 border dark:border-gray-600">
                  <span className={`px-2 py-1 rounded text-sm ${
                    u.role === 'admin' 
                      ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' 
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
                    <option value="volunteer" className="dark:bg-gray-700">Volunteer</option>
                    <option value="patroller" className="dark:bg-gray-700">Patroller</option>
                    <option value="investigator" className="dark:bg-gray-700">Investigator</option>
                    <option value="admin" className="dark:bg-gray-700">Admin</option>
                    <option value="committee" className="dark:bg-gray-700">Committee</option>
                    <option value="technical_support" disabled className="dark:bg-gray-700">
                      Technical support (Supabase only)
                    </option>
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}