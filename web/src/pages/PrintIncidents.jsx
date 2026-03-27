import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabase/client";

export default function PrintIncidents() {
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchIncidents() {
      const { data, error } = await supabase
        .from('incidents')
        .select('*')
        .eq('status', 'approved')
        .order('submitted_at', { ascending: false });
      if (error) {
        console.error("Error fetching incidents:", error);
      } else {
        setIncidents(data || []);
      }
      setLoading(false);
    }
    fetchIncidents();
  }, []);

  // Trigger print automatically when page loads
  useEffect(() => {
    if (!loading && incidents.length > 0) {
      window.print();
    }
  }, [loading, incidents]);

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading incident data...</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 py-8 px-4 print:p-4">
      <div className="max-w-6xl mx-auto">
        <div className="print:hidden mb-4 flex justify-between items-center">
          <button
            onClick={() => navigate("/incidents")}
            className="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-4 py-2 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 transition"
          >
            ← Back to Incidents
          </button>
          <button
            onClick={() => window.print()}
            className="bg-blue-600 text-white px-4 py-2 rounded-xl hover:bg-blue-700 transition"
          >
            🖨️ Print
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-soft border border-gray-100 dark:border-gray-700 p-6 print:p-0 print:shadow-none">
          <h1 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">Approved Incident Reports</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Generated on {new Date().toLocaleString()}
          </p>

          {incidents.length === 0 ? (
            <p>No incidents to display.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border border-gray-200 dark:border-gray-700 print:border-black">
                <thead className="bg-gray-50 dark:bg-gray-900 print:bg-gray-300">
                  <tr>
                    <th className="border px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                    <th className="border px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Location</th>
                    <th className="border px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                    <th className="border px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Description</th>
                    <th className="border px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Reported By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {incidents.map(inc => (
                    <tr key={inc.id} className="print:break-inside-avoid">
                      <td className="border px-4 py-2 text-sm text-gray-900 dark:text-gray-200">{new Date(inc.incident_date).toLocaleDateString()}</td>
                      <td className="border px-4 py-2 text-sm text-gray-900 dark:text-gray-200">{inc.location}</td>
                      <td className="border px-4 py-2 text-sm text-gray-900 dark:text-gray-200">{inc.type}</td>
                      <td className="border px-4 py-2 text-sm text-gray-900 dark:text-gray-200">{inc.description}</td>
                      <td className="border px-4 py-2 text-sm text-gray-900 dark:text-gray-200">{inc.submitted_by_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Print-only footer */}
          <div className="hidden print:block text-xs text-center mt-8">
            Neighbourhood Watch Platform – Confidential – For internal use only
          </div>
        </div>
      </div>
    </div>
  );
}