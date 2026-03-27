import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabase/client";

export default function PrintPatrolLogs() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLogs() {
      try {
        const { data, error } = await supabase
          .from('patrol_logs')
          .select('*')
          .order('start_time', { ascending: false });

        if (error) throw error;

        const formattedData = (data || []).map(log => ({
          id: log.id,
          userName: log.user_name,
          start: log.start_time ? new Date(log.start_time) : null,
          end: log.end_time ? new Date(log.end_time) : null,
          durationMinutes: log.duration_minutes,
          zone: log.zone,
        }));
        setLogs(formattedData);
      } catch (err) {
        console.error("Error fetching logs:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchLogs();
  }, []);

  // Trigger print automatically when page loads
  useEffect(() => {
    if (!loading && logs.length > 0) {
      window.print();
    }
  }, [loading, logs]);

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading print data...</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 py-8 px-4 print:p-4">
      <div className="max-w-6xl mx-auto">
        <div className="print:hidden mb-4 flex justify-between items-center">
          <button
            onClick={() => navigate("/admin")}
            className="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-4 py-2 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 transition"
          >
            ← Back to Admin
          </button>
          <button
            onClick={() => window.print()}
            className="bg-blue-600 text-white px-4 py-2 rounded-xl hover:bg-blue-700 transition"
          >
            🖨️ Print
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-soft border border-gray-100 dark:border-gray-700 p-6 print:p-0 print:shadow-none">
          <h1 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">Patrol Logs – Neighbourhood Watch</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Generated on {new Date().toLocaleString()}
          </p>

          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-200 dark:border-gray-700 print:border-black">
              <thead className="bg-gray-50 dark:bg-gray-900 print:bg-gray-300">
                <tr>
                  <th className="border px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Volunteer</th>
                  <th className="border px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                  <th className="border px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Start</th>
                  <th className="border px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">End</th>
                  <th className="border px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Duration</th>
                  <th className="border px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Zone</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {logs.map(log => (
                  <tr key={log.id} className="print:break-inside-avoid">
                    <td className="border px-4 py-2 text-sm text-gray-900 dark:text-gray-200">{log.userName}</td>
                    <td className="border px-4 py-2 text-sm text-gray-900 dark:text-gray-200">{log.start?.toLocaleDateString()}</td>
                    <td className="border px-4 py-2 text-sm text-gray-900 dark:text-gray-200">{log.start?.toLocaleTimeString()}</td>
                    <td className="border px-4 py-2 text-sm text-gray-900 dark:text-gray-200">{log.end?.toLocaleTimeString()}</td>
                    <td className="border px-4 py-2 text-sm text-gray-900 dark:text-gray-200">{log.durationMinutes} min</td>
                    <td className="border px-4 py-2 text-sm text-gray-900 dark:text-gray-200">{log.zone || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Print-only footer */}
          <div className="hidden print:block text-xs text-center mt-8">
            Neighbourhood Watch Platform – Confidential – For internal use only
          </div>
        </div>
      </div>
    </div>
  );
}