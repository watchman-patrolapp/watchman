import { useEffect, useMemo, useState } from "react";
import { fetchAreaHourlyWeather } from "../utils/areaWeather";
import { patrolDateSpan } from "../utils/patrolWeather";

export function useAreaHourlyWeather(organizationId, logs) {
  const [lookup, setLookup] = useState(null);
  const spanKey = useMemo(() => {
    const span = patrolDateSpan(logs);
    return span ? `${span.start}:${span.end}` : "";
  }, [logs]);

  useEffect(() => {
    if (!spanKey) {
      setLookup(null);
      return undefined;
    }
    let ignore = false;
    const [start, end] = spanKey.split(":");
    (async () => {
      try {
        const next = await fetchAreaHourlyWeather(organizationId, start, end);
        if (!ignore) setLookup(next);
      } catch {
        if (!ignore) setLookup(null);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [organizationId, spanKey]);

  return lookup;
}
