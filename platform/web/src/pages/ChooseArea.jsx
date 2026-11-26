import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useActiveOrganization } from "../auth/useActiveOrganization";
import PageHeader from "../components/layout/PageHeader";
import MyAreaSection from "../components/places/MyAreaSection";
import { fetchOrganizationCities } from "../utils/cityScope";
import { groupAreasByCity } from "../utils/placesView";

/**
 * Staff: choose the working area, grouped by city (SA places P4).
 * Everyone else: their own city and watch (same flow as Profile and Find your watch).
 */
export default function ChooseArea() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = typeof location.state?.from === "string" && location.state.from.startsWith("/") && !location.state.from.startsWith("//") ? location.state.from : "/dashboard";
  const {
    organizations,
    activeOrganizationId,
    setActiveOrganizationId,
    loading,
    isGlobalOperator,
  } = useActiveOrganization();
  const [cityByOrg, setCityByOrg] = useState(() => new Map());
  const [filter, setFilter] = useState("");
  const [choosingId, setChoosingId] = useState(null);

  const orgIdsKey = organizations.map((o) => o.id).join(",");
  useEffect(() => {
    if (!isGlobalOperator || !orgIdsKey) return undefined;
    let ignore = false;
    void fetchOrganizationCities(orgIdsKey.split(",")).then((map) => {
      if (!ignore) setCityByOrg(map);
    });
    return () => {
      ignore = true;
    };
  }, [isGlobalOperator, orgIdsKey]);

  const groups = useMemo(() => groupAreasByCity(organizations, cityByOrg, filter), [organizations, cityByOrg, filter]);

  const handleChoose = async (organizationId) => {
    if (!organizationId || choosingId) return;
    setChoosingId(organizationId);
    try {
      await setActiveOrganizationId(organizationId);
      navigate(from, { replace: true });
    } finally {
      setChoosingId(null);
    }
  };

  if (!isGlobalOperator) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <PageHeader
            title="Your area"
            subtitle="Your city or town and the watch for your suburb."
            backTo="/dashboard"
            backLabel="Back to dashboard"
          />
          <MyAreaSection startOpen />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <PageHeader
          title="Choose an area"
          subtitle="Each area stays isolated; City Hub and Hotspots stay city-wide."
          backTo="/dashboard"
          backLabel="Back to dashboard"
        />

        {organizations.length > 8 ? (
          <input
            type="search"
            aria-label="Filter areas by name or city"
            placeholder="Filter by area or city"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="input border w-full"
          />
        ) : null}

        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading areas…</p>
        ) : organizations.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No neighborhood areas yet. Create a neighborhood watch under Organizations. Security companies stay on the partner list, not here.
          </p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No area matches that.</p>
        ) : (
          groups.map((group) => (
            <section
              key={group.cityId || "other"}
              className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden"
            >
              <header className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">City</p>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{group.cityName}</h2>
              </header>
              <div className="p-4 grid gap-3 sm:grid-cols-2">
                {group.orgs.map((org) => {
                  const selected = org.id === activeOrganizationId;
                  return (
                    <button
                      key={org.id}
                      type="button"
                      onClick={() => void handleChoose(org.id)}
                      disabled={Boolean(choosingId)}
                      className={`text-left rounded-xl border p-4 transition disabled:opacity-60 ${
                        selected
                          ? "border-teal-500 bg-teal-50 dark:bg-teal-900/20"
                          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-teal-500 hover:shadow-sm"
                      }`}
                    >
                      <p className="font-semibold text-gray-900 dark:text-white">{org.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 capitalize">
                        {String(org.type || "").replace(/_/g, " ")} · {org.status}
                        {selected ? " · current" : ""}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
