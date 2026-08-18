import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveOrganization } from "../auth/useActiveOrganization";
import PageHeader from "../components/layout/PageHeader";
import { fetchParentCity } from "../utils/cityScope";
import { DEFAULT_CITY_FULL_NAME } from "../config/neighborhoodRegions";

export default function ChooseArea() {
  const navigate = useNavigate();
  const {
    organizations,
    activeOrganizationId,
    setActiveOrganizationId,
    loading,
  } = useActiveOrganization();
  const [cityName, setCityName] = useState(DEFAULT_CITY_FULL_NAME);

  useEffect(() => {
    let ignore = false;
    void fetchParentCity().then((city) => {
      if (!ignore && city?.name) setCityName(city.name);
    });
    return () => {
      ignore = true;
    };
  }, []);

  const handleChoose = async (organizationId) => {
    await setActiveOrganizationId(organizationId);
    navigate("/dashboard", { replace: true });
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <PageHeader
          title="Choose an area"
          subtitle={`${cityName} is the parent city. Each area below stays isolated; City Hub and Hotspots stay city-wide.`}
          backTo="/dashboard"
          backLabel="Back to dashboard"
        />

        <section className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
          <header className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              City
            </p>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{cityName}</h2>
          </header>

          <div className="p-4">
            {loading ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading areas…</p>
            ) : organizations.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No neighborhood areas yet. Create a neighborhood watch under Organizations. Security companies stay on the partner list, not here.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {organizations.map((org) => {
                  const selected = org.id === activeOrganizationId;
                  return (
                    <button
                      key={org.id}
                      type="button"
                      onClick={() => void handleChoose(org.id)}
                      className={`text-left rounded-xl border p-4 transition ${
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
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
