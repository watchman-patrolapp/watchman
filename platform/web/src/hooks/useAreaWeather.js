import { useEffect, useState } from "react";
import { fetchAreaWeather } from "../utils/areaWeather";

export function useAreaWeather(organizationId) {
  const [weather, setWeather] = useState(null);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      try {
        const next = await fetchAreaWeather(organizationId);
        if (!ignore) setWeather(next);
      } catch {
        if (!ignore) setWeather(null);
      }
    };
    void load();
    return () => {
      ignore = true;
    };
  }, [organizationId]);

  return weather;
}
