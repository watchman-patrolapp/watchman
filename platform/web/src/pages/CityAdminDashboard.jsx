import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  FaBell,
  FaBuilding,
  FaClipboardList,
  FaFire,
  FaMapPin,
  FaPhone,
  FaUserSecret,
} from "react-icons/fa";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../supabase/client";
import PageHeader from "../components/layout/PageHeader";
import ThemeToggle from "../components/ThemeToggle";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";
import { useUnreadCityHubCount } from "../hooks/useUnreadCityHubCount";
import ActiveSosBanner from "../components/patrol/ActiveSosBanner";

const LINKS = [
  {
    to: "/sos",
    title: "SOS board",
    description: "Live resident emergencies across communities.",
    icon: FaBell,
    color: "bg-red-700",
  },
  {
    to: "/intelligence",
    title: "Intelligence",
    description: "Criminal profiles, search, and hotspots.",
    icon: FaUserSecret,
    color: "bg-slate-800",
  },
  {
    to: "/incidents",
    title: "Reports",
    description: "Incident reports across the city.",
    icon: FaClipboardList,
    color: "bg-teal-700",
  },
  {
    to: "/hotspots",
    title: "Hotspots",
    description: "Break-in pins, cameras, and hotspot entry.",
    icon: FaFire,
    color: "bg-red-600",
  },
  {
    to: "/city-hub",
    title: "City Hub",
    description: "Neighborhood-to-city briefings.",
    icon: FaMapPin,
    color: "bg-rose-600",
  },
];

export default function CityAdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const unreadCityHubCount = useUnreadCityHubCount(!!(user?.id || user?.uid), user?.id || user?.uid);
  const [communities, setCommunities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc("city_admin_communities");
        if (error) {
          if (isRpcNotFoundError(error)) {
            toast.error("Run the city admin dashboard SQL in Supabase to load community details.");
          } else {
            throw error;
          }
        }
        if (!cancelled) setCommunities(data || []);
      } catch (err) {
        console.error(err);
        if (!cancelled) toast.error(err.message || "Could not load communities.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <ActiveSosBanner />
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <PageHeader
          title="City admin / Police"
          subtitle="Gqeberha (Port Elizabeth) — city-wide intelligence, reports, hotspots, City Hub, and community admin contacts."
          rightSlot={<ThemeToggle />}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          {LINKS.map((link) => (
            <button
              key={link.to}
              type="button"
              onClick={() => navigate(link.to)}
              className="rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm hover:border-teal-300 dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="flex items-start gap-3">
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-white ${link.color}`}>
                  <link.icon />
                </span>
                <span>
                  <span className="block text-base font-semibold text-gray-900 dark:text-white">
                    {link.title}
                    {link.to === "/city-hub" && unreadCityHubCount > 0 ? ` (${unreadCityHubCount})` : ""}
                  </span>
                  <span className="mt-1 block text-sm text-gray-600 dark:text-gray-400">{link.description}</span>
                </span>
              </div>
            </button>
          ))}
        </div>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <FaBuilding className="text-teal-600" /> Gqeberha (Port Elizabeth)
          </h2>
          <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">Community admin details for areas in this city</p>
          {loading ? (
            <p className="text-sm text-gray-500">Loading communities…</p>
          ) : communities.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No neighborhood or partner organizations yet.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {communities.map((row) => (
                <article
                  key={row.organization_id}
                  className="rounded-xl border border-gray-200 p-4 dark:border-gray-700"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    {String(row.organization_type || "").replaceAll("_", " ")} · {row.status}
                  </p>
                  <h3 className="mt-1 text-base font-semibold text-gray-900 dark:text-white">
                    {row.organization_name}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300">{row.member_count || 0} active members</p>
                  <div className="mt-3 text-sm text-gray-700 dark:text-gray-200">
                    <p className="font-medium">{row.admin_name || "No admin listed"}</p>
                    {row.admin_role ? (
                      <p className="text-xs capitalize text-gray-500">{String(row.admin_role).replaceAll("_", " ")}</p>
                    ) : null}
                    {row.admin_email ? (
                      <a className="block text-teal-700 dark:text-teal-300" href={`mailto:${row.admin_email}`}>
                        {row.admin_email}
                      </a>
                    ) : null}
                    {row.admin_phone ? (
                      <a className="mt-1 inline-flex items-center gap-1 text-teal-700 dark:text-teal-300" href={`tel:${row.admin_phone}`}>
                        <FaPhone className="h-3 w-3" /> {row.admin_phone}
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
