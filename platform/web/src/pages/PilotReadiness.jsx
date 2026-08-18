import { useEffect, useState } from "react";
import { supabase } from "../supabase/client";
import toast from "react-hot-toast";
import PageHeader from "../components/layout/PageHeader";

export default function PilotReadiness() {
  const [stats, setStats] = useState({
    organizations: 0,
    members: 0,
    residents: 0,
    patrollers: 0,
    subscriptionsPaid: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      setLoading(true);
      try {
        const [orgRes, memberRes, userRes, paidRes] = await Promise.all([
          supabase.from("organizations").select("*", { count: "exact", head: true }),
          supabase.from("organization_members").select("*", { count: "exact", head: true }),
          supabase.from("users").select("role"),
          supabase.from("subscriptions").select("*", { count: "exact", head: true }).eq("payment_status", "paid"),
        ]);

        if (orgRes.error) throw orgRes.error;
        if (memberRes.error) throw memberRes.error;
        if (userRes.error) throw userRes.error;
        if (paidRes.error) throw paidRes.error;

        const users = userRes.data || [];
        const residents = users.filter((u) => ["resident", "user", "volunteer"].includes(String(u.role || "").toLowerCase())).length;
        const patrollers = users.filter((u) => ["patroller", "investigator"].includes(String(u.role || "").toLowerCase())).length;

        if (!ignore) {
          setStats({
            organizations: orgRes.count || 0,
            members: memberRes.count || 0,
            residents,
            patrollers,
            subscriptionsPaid: paidRes.count || 0,
          });
        }
      } catch (err) {
        console.error(err);
        toast.error("Could not load pilot readiness metrics.");
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
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <PageHeader
          title="Pilot readiness board"
          subtitle="Track readiness to expand from one neighborhood to 2-5 pilots."
          backTo="/admin"
          backLabel="Back to admin"
        />

        {loading ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow">
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading pilot metrics...</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <MetricCard label="Organizations" value={stats.organizations} />
            <MetricCard label="Members" value={stats.members} />
            <MetricCard label="Residents" value={stats.residents} />
            <MetricCard label="Patrollers" value={stats.patrollers} />
            <MetricCard label="Paid NWs" value={stats.subscriptionsPaid} />
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Pilot checklist</h2>
          <ul className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-300 list-disc pl-5">
            <li>Confirm tenant isolation by testing cross-org data access with separate test users.</li>
            <li>Onboard at least two additional neighborhood organizations and verify staff flows.</li>
            <li>Run resident SOS tabletop drills and capture median response time.</li>
            <li>Verify annual subscription collection for NW organizations before expansion.</li>
            <li>Prepare partner security-company pitch using aggregated resident-membership metrics.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow">
      <p className="text-xs uppercase text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{value}</p>
    </div>
  );
}
