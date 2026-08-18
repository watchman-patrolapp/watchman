import { useEffect, useState } from "react";
import { useActiveOrganization } from "../../auth/useActiveOrganization";
import { fetchParentCity } from "../../utils/cityScope";
import { DEFAULT_CITY_FULL_NAME, displayWatchAreaName } from "../../config/neighborhoodRegions";

export default function AreaContextBar({ className = "" }) {
  const {
    organizations,
    activeOrganizationId,
    setActiveOrganizationId,
    isGlobalOperator,
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

  if (!isGlobalOperator || organizations.length === 0) return null;

  return (
    <div className={`grid min-w-0 w-full grid-cols-2 items-end gap-3 ${className}`}>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">City</p>
        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{cityName}</p>
      </div>
      <div className="min-w-0">
        <label htmlFor="active-area" className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
          Area
        </label>
        <select
          id="active-area"
          value={activeOrganizationId || ""}
          onChange={(e) => setActiveOrganizationId(e.target.value)}
          className="input mt-0.5 w-full min-w-0 border text-sm"
        >
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {displayWatchAreaName(org.name)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
