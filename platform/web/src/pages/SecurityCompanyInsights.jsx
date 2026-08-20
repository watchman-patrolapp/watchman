import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { supabase } from "../supabase/client";
import PageHeader from "../components/layout/PageHeader";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";

export default function SecurityCompanyInsights() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc("list_security_company_resident_metrics");
        if (error) {
          if (isRpcNotFoundError(error)) {
            throw new Error("Apply the security metrics SQL on Supabase first.");
          }
          throw error;
        }
        if (!ignore) setRows(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(err);
        toast.error(err.message || "Could not load security-company insights.");
        if (!ignore) setRows([]);
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    void load();
    return () => {
      ignore = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 p-6 dark:bg-gray-900">
      <div className="mx-auto max-w-6xl rounded-xl bg-white p-5 shadow dark:bg-gray-800">
        <PageHeader
          title="Security company insights"
          subtitle="Linked clients, company-verified clients, neighborhood-watch areas those households belong to, and transfers in the last 30 days."
          backTo="/admin"
          backLabel="Back to admin"
          className="bg-transparent p-0 shadow-none dark:bg-transparent"
        />

        {loading ? (
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading insights...</p>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">No data yet. Link resident memberships first.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left dark:border-gray-700">
                  <th className="py-2 pr-4">Security company</th>
                  <th className="py-2 pr-4">Clients using the app</th>
                  <th className="py-2 pr-4">Pending claims</th>
                  <th className="py-2 pr-4">Verified clients</th>
                  <th className="py-2 pr-4">Watch areas</th>
                  <th className="py-2 pr-4">Won (30d)</th>
                  <th className="py-2 pr-4">Lost (30d)</th>
                  <th className="py-2 pr-4">Incidents (30d)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.security_company_id} className="border-b dark:border-gray-700/60">
                    <td className="py-2 pr-4 font-medium text-gray-900 dark:text-white">{row.security_company_name}</td>
                    <td className="py-2 pr-4">{row.residents_linked_count}</td>
                    <td className="py-2 pr-4">{row.residents_pending_count ?? 0}</td>
                    <td className="py-2 pr-4">{row.residents_verified_count}</td>
                    <td className="py-2 pr-4">{row.watch_areas_count ?? row.suburbs_covered_count ?? 0}</td>
                    <td className="py-2 pr-4">{row.clients_won_30d ?? 0}</td>
                    <td className="py-2 pr-4">{row.clients_lost_30d ?? 0}</td>
                    <td className="py-2 pr-4">{row.incidents_last_30d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
