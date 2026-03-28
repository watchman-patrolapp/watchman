import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../supabase/client"; // ✅ Supabase client

export default function UserManagement() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

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

  if (loading) return <div className="text-center p-8 dark:text-white">Loading users...</div>;

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
      <div className="mb-4 flex justify-between items-center">
        <button
          onClick={() => navigate("/dashboard")}
          className="bg-gray-500 text-white dark:bg-gray-600 px-4 py-2 rounded hover:bg-gray-600 dark:hover:bg-gray-700 transition"
        >
          ← Back to Dashboard
        </button>
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
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.uid} className="border-b hover:bg-gray-50 dark:hover:bg-gray-700 dark:border-gray-700">
                <td className="px-4 py-2 border dark:border-gray-600 dark:text-gray-300">{u.fullName || "—"}</td>
                <td className="px-4 py-2 border dark:border-gray-600 dark:text-gray-300">{u.email}</td>
                <td className="px-4 py-2 border dark:border-gray-600">
                  <span className={`px-2 py-1 rounded text-sm ${
                    u.role === 'admin' 
                      ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' 
                      : u.role === 'committee' 
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' 
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
                    disabled={u.uid === currentUser?.id}
                  >
                    <option value="volunteer" className="dark:bg-gray-700">Volunteer</option>
                    <option value="patroller" className="dark:bg-gray-700">Patroller</option>
                    <option value="investigator" className="dark:bg-gray-700">Investigator</option>
                    <option value="admin" className="dark:bg-gray-700">Admin</option>
                    <option value="committee" className="dark:bg-gray-700">Committee</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}