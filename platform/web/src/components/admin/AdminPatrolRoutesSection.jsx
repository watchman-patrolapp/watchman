import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { FaMapMarkedAlt, FaChevronUp, FaFilter } from 'react-icons/fa';
import { supabase } from '../../supabase/client';
import { displayPatrolZone } from '../../config/neighborhoodRegions';
import {
  patrolLogKeyScoped,
  matchRouteRowToLog,
  latLngsFromRouteGeoJson,
  distanceKmFromLatLngPoints,
} from '../../utils/patrolHistoryRoute';
import { reverseGeocodeStartEnd } from '../../utils/reverseGeocodeNominatim';
import PatrolRouteMapPanel from '../leaderboard/PatrolRouteMapPanel';
import BrandedLoader from '../layout/BrandedLoader';

const MAX_ROWS = 50;

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

function matchesVolunteerFilter(log, filterId) {
  if (!filterId) return true;
  if (log.user_id != null && String(log.user_id).length > 0) {
    return String(log.user_id) === filterId;
  }
  const nameKey = `name:${(log.user_name || 'unknown').toString().trim()}`;
  return nameKey === filterId;
}

export default function AdminPatrolRoutesSection({ patrolLogs = [], volunteerOptions = [] }) {
  const [volunteerFilter, setVolunteerFilter] = useState('');
  const [expandedKey, setExpandedKey] = useState(null);
  const [loadingKey, setLoadingKey] = useState(null);
  const [errorKey, setErrorKey] = useState(null);
  const [routeCache, setRouteCache] = useState({});
  const [streetsByKey, setStreetsByKey] = useState({});
  const streetsFetchedRef = useRef(new Set());
  const [routeRows, setRouteRows] = useState([]);
  const [expandedDays, setExpandedDays] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('patrol_routes')
          .select(
            'user_id, total_distance_km, total_duration_seconds, route_geojson, created_at, start_location, end_location'
          )
          .order('created_at', { ascending: false })
          .limit(500);
        if (cancelled) return;
        if (!error && Array.isArray(data)) setRouteRows(data);
        else setRouteRows([]);
      } catch {
        if (!cancelled) setRouteRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setExpandedKey(null);
    setRouteCache({});
    setStreetsByKey({});
    streetsFetchedRef.current.clear();
    setErrorKey(null);
  }, [volunteerFilter]);

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
    return [...(patrolLogs || [])]
      .filter((log) => log.end_time && matchesVolunteerFilter(log, volunteerFilter))
      .sort((a, b) => new Date(b.start_time) - new Date(a.start_time))
      .slice(0, MAX_ROWS);
  }, [patrolLogs, volunteerFilter]);

  const groupedByDay = useMemo(() => {
    const groups = new Map();
    for (const log of sorted) {
      const d = new Date(log.start_time);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-ZA', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      if (!groups.has(key)) groups.set(key, { key, label, items: [] });
      groups.get(key).items.push(log);
    }
    return Array.from(groups.values());
  }, [sorted]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    setExpandedDays(new Set([today]));
  }, [volunteerFilter]);

  const routesForLog = useCallback(
    (log) => {
      if (!log.user_id) return [];
      return routeRows.filter((r) => r.user_id === log.user_id);
    },
    [routeRows]
  );

  const fetchLatlngsForPatrol = useCallback(
    async (log) => {
      if (!log.user_id) return [];
      const rows = routesForLog(log);
      const matched = matchRouteRowToLog(log, rows);
      const fromGeo = latLngsFromRouteGeoJson(matched?.route_geojson);
      if (fromGeo.length >= 2) {
        return fromGeo;
      }

      const { data, error } = await supabase
        .from('patrol_locations')
        .select('latitude, longitude, timestamp')
        .eq('user_id', log.user_id)
        .gte('timestamp', log.start_time)
        .lte('timestamp', log.end_time)
        .order('timestamp', { ascending: true })
        .limit(8000);

      if (error) throw error;
      const rowsLoc = data || [];
      return rowsLoc
        .filter(
          (r) =>
            typeof r.latitude === 'number' &&
            typeof r.longitude === 'number' &&
            !Number.isNaN(r.latitude) &&
            !Number.isNaN(r.longitude)
        )
        .map((r) => [r.latitude, r.longitude]);
    },
    [routesForLog]
  );

  const toggleMap = async (log) => {
    const key = patrolLogKeyScoped(log);
    if (!log.user_id) return;

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
      console.error('Admin patrol route load failed', e);
      setErrorKey(key);
      setRouteCache((prev) => ({ ...prev, [key]: [] }));
    } finally {
      setLoadingKey(null);
    }
  };

  if (!patrolLogs?.length) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
        No completed patrol logs yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Completed patrols log with GPS location data. Open a map to load stored GPS for that patrol window. Active patrols
        appear here only after the session ends and a log row is written.
      </p>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <FaFilter className="text-teal-500 shrink-0" aria-hidden />
          <span className="whitespace-nowrap">Volunteer</span>
          <select
            value={volunteerFilter}
            onChange={(e) => setVolunteerFilter(e.target.value)}
            className="rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm px-3 py-2 min-w-[200px]"
          >
            <option value="">All volunteers</option>
            {volunteerOptions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.displayName}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Showing up to {MAX_ROWS} most recent {volunteerFilter ? 'filtered ' : ''}patrols.
        </span>
      </div>

      {!sorted.length ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
          No patrols match this filter.
        </p>
      ) : (
        <div className="space-y-4">
          {groupedByDay.map((group) => {
            const dayOpen = expandedDays.has(group.key);
            return (
              <div key={group.key} className="space-y-3">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedDays((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.key)) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    })
                  }
                  className="w-full flex items-center justify-between rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-800 dark:text-gray-100"
                >
                  <span>{group.label}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {group.items.length} patrol{group.items.length === 1 ? '' : 's'} {dayOpen ? '▲' : '▼'}
                  </span>
                </button>
                {!dayOpen ? null : group.items.map((log) => {
            const key = patrolLogKeyScoped(log);
            const expanded = expandedKey === key;
            const loading = loadingKey === key;
            const matched = matchRouteRowToLog(log, routesForLog(log));
            const cached = routeCache[key];
            const fromPoints =
              cached && cached.length >= 2
                ? distanceKmFromLatLngPoints(cached.map(([lat, lng]) => ({ lat, lng })))
                : null;
            const distKm =
              matched?.total_distance_km != null && matched.total_distance_km > 0
                ? matched.total_distance_km
                : fromPoints != null && fromPoints > 0
                  ? fromPoints
                  : null;
            const { title, sub } = formatPatrolPeriod(log);
            const dur = log.duration_minutes ?? 0;
            const canMap = !!log.user_id;
            const streetInfo = streetsByKey[key];

            return (
              <div
                key={key}
                className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/40 overflow-hidden"
              >
                <div className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-teal-700 dark:text-teal-300 truncate">
                      {log.user_name || 'Unknown'}
                    </p>
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
                      {log.admin_ended && (
                        <span className="text-amber-700 dark:text-amber-300">Admin end</span>
                      )}
                      {log.auto_closed && (
                        <span className="text-gray-500 dark:text-gray-400">Auto-closed</span>
                      )}
                    </div>
                    {canMap && expanded && routeCache[key]?.length >= 2 && (
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
                          Street and suburb from OpenStreetMap (near first/last GPS point; electoral ward labels are skipped when possible).
                        </p>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleMap(log)}
                    disabled={loading || !canMap}
                    title={!canMap ? 'This log has no user id — GPS cannot be loaded.' : undefined}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium shrink-0 transition"
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

                {expanded && canMap && (
                  <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-4">
                    {errorKey === key && (
                      <p className="text-sm text-amber-700 dark:text-amber-300 mb-2">
                        Could not load route data, or no GPS was stored for this patrol. Confirm RLS migration is applied
                        and the patroller had GPS tracking during this window.
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
            );
          })}
        </div>
      )}
    </div>
  );
}
