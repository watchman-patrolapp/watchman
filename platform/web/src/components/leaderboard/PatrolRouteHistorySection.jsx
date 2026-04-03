import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { FaRoute, FaMapMarkedAlt, FaChevronUp } from 'react-icons/fa';
import { supabase } from '../../supabase/client';
import { displayPatrolZone } from '../../config/neighborhoodRegions';
import {
  patrolLogKey,
  matchRouteRowToLog,
  latLngsFromRouteGeoJson,
  distanceKmFromLatLngPoints,
} from '../../utils/patrolHistoryRoute';
import { reverseGeocodeStartEnd } from '../../utils/reverseGeocodeNominatim';
import PatrolRouteMapPanel from './PatrolRouteMapPanel';
import BrandedLoader from '../layout/BrandedLoader';

const MAX_PATROLS = 25;

function formatPatrolPeriod(log) {
  const start = new Date(log.start_time);
  const end = new Date(log.end_time);
  const dateStr = start.toLocaleDateString('en-ZA', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const timeStr = `${start.toLocaleTimeString('en-ZA', {
    hour: '2-digit',
    minute: '2-digit',
  })} – ${end.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}`;
  return { title: dateStr, sub: timeStr };
}

export default function PatrolRouteHistorySection({ userPatrols, userId, routeRows = [] }) {
  const [expandedKey, setExpandedKey] = useState(null);
  const [loadingKey, setLoadingKey] = useState(null);
  const [errorKey, setErrorKey] = useState(null);
  /** undefined = not fetched; array = result (may be empty) */
  const [routeCache, setRouteCache] = useState({});
  const [streetsByKey, setStreetsByKey] = useState({});
  const streetsFetchedRef = useRef(new Set());

  useEffect(() => {
    setExpandedKey(null);
    setRouteCache({});
    setStreetsByKey({});
    streetsFetchedRef.current.clear();
  }, [userId]);

  useEffect(() => {
    if (!expandedKey) return;
    const latlngs = routeCache[expandedKey];
    if (!latlngs || latlngs.length < 2) return;
    if (streetsFetchedRef.current.has(expandedKey)) return;
    streetsFetchedRef.current.add(expandedKey);

    let cancelled = false;
    setStreetsByKey((prev) => ({
      ...prev,
      [expandedKey]: { loading: true, start: '', end: '' },
    }));

    (async () => {
      try {
        const { start, end } = await reverseGeocodeStartEnd(latlngs);
        if (!cancelled) {
          setStreetsByKey((prev) => ({
            ...prev,
            [expandedKey]: { loading: false, start, end },
          }));
        }
      } catch {
        if (!cancelled) {
          setStreetsByKey((prev) => ({
            ...prev,
            [expandedKey]: { loading: false, start: '—', end: '—' },
          }));
        }
      }
    })();

    return () => {
      cancelled = true;
      streetsFetchedRef.current.delete(expandedKey);
    };
  }, [expandedKey, routeCache]);

  const sorted = useMemo(() => {
    return [...(userPatrols || [])]
      .sort((a, b) => new Date(b.start_time) - new Date(a.start_time))
      .slice(0, MAX_PATROLS);
  }, [userPatrols]);

  const fetchLatlngsForPatrol = useCallback(
    async (log) => {
      const matched = matchRouteRowToLog(log, routeRows);
      const fromGeo = latLngsFromRouteGeoJson(matched?.route_geojson);
      if (fromGeo.length >= 2) {
        return fromGeo;
      }

      const { data, error } = await supabase
        .from('patrol_locations')
        .select('latitude, longitude, timestamp')
        .eq('user_id', userId)
        .gte('timestamp', log.start_time)
        .lte('timestamp', log.end_time)
        .order('timestamp', { ascending: true })
        .limit(8000);

      if (error) throw error;
      const rows = data || [];
      return rows
        .filter(
          (r) =>
            typeof r.latitude === 'number' &&
            typeof r.longitude === 'number' &&
            !Number.isNaN(r.latitude) &&
            !Number.isNaN(r.longitude)
        )
        .map((r) => [r.latitude, r.longitude]);
    },
    [userId, routeRows]
  );

  const toggleMap = async (log) => {
    const key = patrolLogKey(log);
    if (expandedKey === key) {
      setExpandedKey(null);
      setErrorKey(null);
      return;
    }
    setExpandedKey(key);
    setErrorKey(null);

    if (routeCache[key] !== undefined) return;

    setLoadingKey(key);
    try {
      const latlngs = await fetchLatlngsForPatrol(log);
      setRouteCache((prev) => ({ ...prev, [key]: latlngs }));
    } catch (e) {
      console.error('Patrol route load failed', e);
      setErrorKey(key);
      setRouteCache((prev) => ({ ...prev, [key]: [] }));
    } finally {
      setLoadingKey(null);
    }
  };

  if (!sorted.length) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 min-w-0">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
        <FaRoute className="text-teal-500 shrink-0" />
        Patrol routes
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Each card is one completed patrol window. Open the map to see your GPS track (when location was recorded for that period).
      </p>

      <div className="space-y-3">
        {sorted.map((log) => {
          const key = patrolLogKey(log);
          const expanded = expandedKey === key;
          const loading = loadingKey === key;
          const matched = matchRouteRowToLog(log, routeRows);
          const cached = routeCache[key];
          const fromPoints =
            cached && cached.length >= 2 ? distanceKmFromLatLngPoints(
              cached.map(([lat, lng]) => ({ lat, lng }))
            ) : null;
          const distKm =
            matched?.total_distance_km != null && matched.total_distance_km > 0
              ? matched.total_distance_km
              : fromPoints != null && fromPoints > 0
                ? fromPoints
                : null;
          const { title, sub } = formatPatrolPeriod(log);
          const dur = log.duration_minutes ?? 0;
          const streetInfo = streetsByKey[key];

          return (
            <div
              key={key}
              className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/40 overflow-hidden"
            >
              <div className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 dark:text-white">{title}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{sub}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-600 dark:text-gray-300">
                    <span>
                      Distance{' '}
                      <strong className="text-gray-900 dark:text-white">
                        {distKm != null ? `${distKm.toFixed(2)} km` : '—'}
                      </strong>
                    </span>
                    <span>
                      Duration{' '}
                      <strong className="text-gray-900 dark:text-white">
                        {Math.floor(dur / 60)}h {dur % 60}m
                      </strong>
                    </span>
                    {log.zone && (
                      <span className="text-gray-500 dark:text-gray-400">
                        {displayPatrolZone(log.zone)}
                      </span>
                    )}
                  </div>
                  {expanded && routeCache[key]?.length >= 2 && (
                    <div className="mt-2 space-y-0.5 text-xs text-gray-600 dark:text-gray-300 border-t border-gray-100 dark:border-gray-700/80 pt-2">
                      <p>
                        <span className="text-gray-500 dark:text-gray-400">Starting point: </span>
                        <strong className="text-gray-900 dark:text-white font-normal">
                          {streetInfo?.loading ? 'Looking up…' : streetInfo?.start ?? '—'}
                        </strong>
                      </p>
                      <p>
                        <span className="text-gray-500 dark:text-gray-400">Ending point: </span>
                        <strong className="text-gray-900 dark:text-white font-normal">
                          {streetInfo?.loading ? 'Looking up…' : streetInfo?.end ?? '—'}
                        </strong>
                      </p>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 pt-1">
                        Street and suburb from OpenStreetMap (near first/last GPS point; ward labels skipped when possible).
                      </p>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void toggleMap(log)}
                  disabled={loading}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-sm font-medium shrink-0 transition"
                >
                  {loading ? (
                    'Loading…'
                  ) : expanded ? (
                    <>
                      <FaChevronUp className="w-4 h-4" />
                      Hide map
                    </>
                  ) : (
                    <>
                      <FaMapMarkedAlt className="w-4 h-4" />
                      View map
                    </>
                  )}
                </button>
              </div>

              {expanded && (
                <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-4">
                  {errorKey === key && (
                    <p className="text-sm text-amber-700 dark:text-amber-300 mb-2">
                      Could not load route data. If this patrol was before GPS tracking or points were cleared, no trail will appear.
                    </p>
                  )}
                  {loading ? (
                    <div className="flex h-[220px] items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-900/80">
                      <BrandedLoader message="Loading map…" size="sm" />
                    </div>
                  ) : (
                    <PatrolRouteMapPanel latlngs={routeCache[key] || []} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
