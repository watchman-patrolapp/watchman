import { useEffect, useState, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle, useMap } from 'react-leaflet';
import { supabase } from '../supabase/client';
import { useAuth } from '../auth/useAuth';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { COLOR_MAP, normalizeVehicleType } from './VehicleIcon';
import { mapVehicleTypeToEmoji } from '../utils/vehicleTypeConstants';
import { FaMapMarkerAlt, FaUser } from 'react-icons/fa';
import { enrichPatrolRowsWithAvatars } from '../utils/enrichPatrolAvatars';
import { resolvePatrolAvatarUrl } from '../utils/patrolAvatarUrl';
import {
  groupUserVehiclesByUserId,
  resolvePatrolVehicleColorKey,
} from '../utils/resolvePatrolVehicleForMap';
import { isRpcNotFoundError } from '../utils/isRpcNotFound';
import { adaptivePollIntervalMs, subscribeDataBudgetHints, distanceMeters } from '../utils/dataSaverProfile';
import { formatLastGpsForMap } from '../utils/formatPatrolClock';
import PatrollerPhotoPreview from './patrol/PatrollerPhotoPreview';
import BrandedLoader from './layout/BrandedLoader';

let garageRpcTriedAndMissing = false;

/** Never plot points older than this wall-clock age (same user_id may hold years of history). */
const MAX_POINT_AGE_MS = 8 * 60 * 60 * 1000;
/** Popup "Active" vs "Idle" — last fix must be newer than this (not chat permission; DB GPS age only). */
const ACTIVE_GPS_MAX_AGE_MS = 5 * 60 * 1000;

function isPatrolLocationActive(location) {
  if (!location) return false;
  const raw = location.displayTime ?? location.timestamp;
  if (raw == null) return false;
  const ms = new Date(raw).getTime();
  return !Number.isNaN(ms) && Date.now() - ms < ACTIVE_GPS_MAX_AGE_MS;
}

function isPatrolActiveNow(patrol, location) {
  if (isPatrolLocationActive(location)) return true;
  const startMs = patrol?.start_time ? new Date(patrol.start_time).getTime() : NaN;
  // Grace period: immediately after check-in, GPS permission/acquire can lag.
  return !Number.isNaN(startMs) && Date.now() - startMs < ACTIVE_GPS_MAX_AGE_MS;
}
/** If consecutive fixes jump farther than this, treat as a new session (legacy rows mixed under user_id). */
const MAX_SEGMENT_METERS = 120_000;

/**
 * DB filter: last N hours only. Do NOT use active_patrols.start_time here — if start_time is late
 * vs real GPS (re-check-in, clock skew, or row updated after first fixes), max(start−slack, wall)
 * excluded every point before that and the patroller disappears from the map.
 * Session separation is handled by keepLastPlausibleRun + segment cap.
 */
function computeLowerBoundIso() {
  return new Date(Date.now() - MAX_POINT_AGE_MS).toISOString();
}

/** Millis for the latest known instant (client `timestamp` vs server `created_at`). */
function latestInstantMs(row) {
  if (!row) return NaN;
  const ts = row.timestamp != null ? new Date(row.timestamp).getTime() : NaN;
  const caRaw = row.created_at ?? row.createdAt;
  const ca = caRaw != null ? new Date(caRaw).getTime() : NaN;
  const vals = [ts, ca].filter((n) => !Number.isNaN(n));
  if (!vals.length) return NaN;
  return Math.max(...vals);
}

/** ISO string for map / “last GPS” — prefers the more recent of client vs server time. */
function displayTimeIsoFromRow(row) {
  const ms = latestInstantMs(row);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * Keep only the last contiguous run (by time) where each step is < maxM — drops a ghost prefix
 * (e.g. Cape Town) when the current patrol is in Gqeberha under the same patrol_id.
 */
/** Postgres numeric / JSON may return strings; Leaflet needs real numbers. */
function normalizeLocationRow(row) {
  if (!row) return null;
  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return {
    ...row,
    latitude: lat,
    longitude: lng,
    displayTime: displayTimeIsoFromRow(row),
  };
}

function hasValidMapCoords(p) {
  const c = p?.currentLocation;
  if (!c) return false;
  const lat = Number(c.latitude);
  const lng = Number(c.longitude);
  return !Number.isNaN(lat) && !Number.isNaN(lng);
}

function keepLastPlausibleRun(points, maxM) {
  if (!points?.length) return [];
  const normalized = points.map(normalizeLocationRow).filter(Boolean);
  if (normalized.length < 2) return normalized;
  const runs = [];
  let run = [normalized[0]];
  for (let i = 1; i < normalized.length; i++) {
    const prev = run[run.length - 1];
    const d = distanceMeters(
      prev.latitude,
      prev.longitude,
      normalized[i].latitude,
      normalized[i].longitude
    );
    if (d > maxM) {
      runs.push(run);
      run = [normalized[i]];
    } else {
      run.push(normalized[i]);
    }
  }
  runs.push(run);
  return runs[runs.length - 1];
}

/**
 * Load trail + latest fix for one active patrol.
 * patrol_id = user_id (PK); DB may contain many sessions — bound by session start + wall clock + segment sanity.
 */
async function fetchPatrolLocationAndRoute(supabaseClient, patrol) {
  if (!patrol.user_id) {
    return { currentLocation: null, route: [] };
  }

  const lowerIso = computeLowerBoundIso();
  const lowerQuoted = `"${lowerIso}"`;

  const uid = patrol.user_id;
  // One `.or()` only (PostgREST): wrong device `timestamp` can lag hours behind `created_at`.
  const recentWindowOr = `timestamp.gte.${lowerQuoted},created_at.gte.${lowerQuoted}`;

  let { data, error } = await supabaseClient
    .from('patrol_locations')
    .select('latitude, longitude, timestamp, created_at, id, is_archived')
    .eq('user_id', uid)
    .is('deleted_at', null)
    .not('timestamp', 'is', null)
    .or(recentWindowOr)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(8000);

  if (error?.message?.includes('is_archived')) {
    ({ data, error } = await supabaseClient
      .from('patrol_locations')
      .select('latitude, longitude, timestamp, created_at, id')
      .eq('user_id', uid)
      .is('deleted_at', null)
      .not('timestamp', 'is', null)
      .or(recentWindowOr)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(8000));
  }

  if (error?.message?.includes('created_at')) {
    ({ data, error } = await supabaseClient
      .from('patrol_locations')
      .select('latitude, longitude, timestamp, id, is_archived')
      .eq('user_id', uid)
      .is('deleted_at', null)
      .not('timestamp', 'is', null)
      .gte('timestamp', lowerIso)
      .order('timestamp', { ascending: true })
      .limit(8000));
  }

  if (error) throw error;

  let rowsIn = data || [];
  rowsIn = rowsIn.filter((r) => r.is_archived !== true);
  let rows = keepLastPlausibleRun(rowsIn, MAX_SEGMENT_METERS);
  rows = rows.slice(-50);

  if (!rows.length) {
    return { currentLocation: null, route: [] };
  }
  const last = rows[rows.length - 1];
  return {
    currentLocation: last,
    route: rows,
  };
}

/** GPS uncertainty ring (always red tint) — not the patrol vehicle colour */
const ACCURACY_CIRCLE_STYLE = {
  fillColor: '#dc2626',
  fillOpacity: 0.14,
  color: '#b91c1c',
  weight: 2,
  opacity: 0.85,
  dashArray: '8, 6',
};

// Custom hook for map bounds
function MapBoundsSetter({ patrols }) {
  const map = useMap();
  
  useEffect(() => {
    if (patrols.length === 0) return;
    
    const validLocations = patrols.filter(p => 
      p.currentLocation?.latitude && 
      p.currentLocation?.longitude &&
      !isNaN(p.currentLocation.latitude) &&
      !isNaN(p.currentLocation.longitude)
    );
    
    if (validLocations.length === 0) return;
    
    const bounds = L.latLngBounds(
      validLocations.map(p => [p.currentLocation.latitude, p.currentLocation.longitude])
    );
    
    if (validLocations.length === 1) {
      map.setView(bounds.getCenter(), 16, { animate: true, duration: 1 });
    } else {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16, animate: true });
    }
  }, [patrols, map]);
  
  return null;
}

/** OSM CDN can rate-limit or fail; switch to Carto after a burst of tile errors. */
const TILE_SOURCES = [
  {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    subdomains: 'abcd',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
];

function ResilientPatrolTileLayer() {
  const [sourceIndex, setSourceIndex] = useState(0);
  const burstRef = useRef({ count: 0, windowStart: 0 });
  const src = TILE_SOURCES[sourceIndex] ?? TILE_SOURCES[0];

  const bumpTileError = () => {
    const now = Date.now();
    const b = burstRef.current;
    if (now - b.windowStart > 2500) {
      b.windowStart = now;
      b.count = 1;
    } else {
      b.count += 1;
    }
    if (b.count >= 8 && sourceIndex < TILE_SOURCES.length - 1) {
      burstRef.current = { count: 0, windowStart: now };
      setSourceIndex((i) => i + 1);
    }
  };

  return (
    <TileLayer
      key={sourceIndex}
      attribution={src.attribution}
      url={src.url}
      subdomains={src.subdomains}
      maxZoom={19}
      eventHandlers={{ tileerror: bumpTileError }}
    />
  );
}

/** After sleep/tab background, Leaflet sometimes needs a size refresh so tiles load. */
function InvalidateMapOnVisibility() {
  const map = useMap();
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        window.requestAnimationFrame(() => {
          map.invalidateSize({ animate: false });
        });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onVis);
    };
  }, [map]);
  return null;
}

/** Map often mounts before layout is final — grey tiles until invalidateSize runs. */
function InvalidateMapWhenReady() {
  const map = useMap();
  useEffect(() => {
    const run = () => map.invalidateSize({ animate: false });
    run();
    const t1 = window.setTimeout(run, 50);
    const t2 = window.setTimeout(run, 300);
    const t3 = window.setTimeout(run, 1000);
    window.addEventListener('resize', run);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.removeEventListener('resize', run);
    };
  }, [map]);
  return null;
}

// Create custom icon for patrol marker
const createPatrolIcon = (patrol, isActive) => {
  const colorData = COLOR_MAP[patrol.vehicleColor?.toLowerCase()] || COLOR_MAP.blue;
  const firstName = (patrol.user_name || 'Unknown').split(' ')[0];
  
  return L.divIcon({
    className: 'custom-patrol-marker',
    html: `
      <div class="relative flex flex-col items-center">
        <div class="w-10 h-10 rounded-full shadow-lg flex items-center justify-center text-lg ${isActive ? 'marker-active' : ''}"
             style="background-color: #ffffff; border: 3px solid ${colorData.hex}; box-shadow: 0 1px 4px rgba(0,0,0,0.2);">
          ${mapVehicleTypeToEmoji(normalizeVehicleType(patrol.vehicle_type))}
        </div>
        <div class="mt-1 px-2 py-0.5 bg-gray-900/90 dark:bg-gray-800 text-white text-xs font-semibold rounded-full shadow-md whitespace-nowrap backdrop-blur-sm">
          ${firstName}
        </div>
      </div>
    `,
    iconSize: [40, 60],
    iconAnchor: [20, 50],
    popupAnchor: [0, -50]
  });
};

export default function LivePatrolMap() {
  const { user } = useAuth();
  const [patrols, setPatrols] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [patrolPhotoPreview, setPatrolPhotoPreview] = useState(null);
  const initialMapFetchDoneRef = useRef(false);

  // Default center (Theescombe, Gqeberha)
  const defaultCenter = [-33.95, 25.58];

  useEffect(() => {
    let subscription;
    let pollTimeoutId = 0;
    let cancelled = false;

    const fetchPatrols = async () => {
      const showSpinner = !initialMapFetchDoneRef.current;
      if (showSpinner) setLoading(true);
      try {
        const { data: activePatrols, error: patrolError } = await supabase
          .from('active_patrols')
          .select('*');

        if (patrolError) throw patrolError;
        
        if (!activePatrols?.length) {
          setPatrols([]);
          return;
        }

        const enrichedPatrols = await enrichPatrolRowsWithAvatars(supabase, activePatrols);

        const patrolUserIds = [...new Set(enrichedPatrols.map((p) => p.user_id).filter(Boolean))];

        let garageRows = [];
        if (!garageRpcTriedAndMissing) {
          const { data: rpcGarage, error: rpcGarageErr } = await supabase.rpc('get_patroller_garage_for_map');
          if (!rpcGarageErr && Array.isArray(rpcGarage)) {
            garageRows = rpcGarage;
          } else if (isRpcNotFoundError(rpcGarageErr)) {
            garageRpcTriedAndMissing = true;
          }
        }
        if (garageRows.length === 0 && patrolUserIds.length > 0) {
          const { data: directGarage, error: directGarageErr } = await supabase
            .from('user_vehicles')
            .select('id, user_id, color, is_primary, make_model, registration, vehicle_type')
            .in('user_id', patrolUserIds);
          if (directGarageErr) {
            console.warn('LivePatrolMap: user_vehicles fetch failed (map may use stale patrol colour)', directGarageErr.message);
          }
          garageRows = directGarage || [];
        }

        const vehiclesByUserId = groupUserVehiclesByUserId(garageRows);

        // Fetch locations for each patrol
        const patrolsWithLocations = await Promise.all(
          enrichedPatrols.map(async (patrol) => {
            try {
              const { currentLocation: location, route } = await fetchPatrolLocationAndRoute(
                supabase,
                patrol
              );

              const vehicleType = patrol.vehicle_type || 
                (patrol.vehicle_make_model?.toLowerCase().includes('bike') ? 'bicycle' : 'car');

              const garage = vehiclesByUserId[String(patrol.user_id)] || [];
              const vehicleColor = resolvePatrolVehicleColorKey(patrol, garage);

              return {
                ...patrol,
                currentLocation: location,
                route: route || [],
                vehicleType,
                vehicleColor,
                isActive: isPatrolActiveNow(patrol, location),
              };
            } catch (err) {
              console.error(`Error fetching location for ${patrol.user_id}:`, err);
              return null;
            }
          })
        );

        setPatrols(patrolsWithLocations.filter(Boolean));
        setError(null);
      } catch (err) {
        console.error('Error fetching patrols:', err);
        setError(err.message);
      } finally {
        initialMapFetchDoneRef.current = true;
        if (showSpinner) setLoading(false);
      }
    };

    const scheduleNextPoll = () => {
      if (pollTimeoutId) window.clearTimeout(pollTimeoutId);
      const ms = adaptivePollIntervalMs(12000, { maxMs: 120000, hiddenMultiplier: 2.5 });
      pollTimeoutId = window.setTimeout(() => {
        if (cancelled) return;
        void fetchPatrols().finally(() => {
          if (!cancelled) scheduleNextPoll();
        });
      }, ms);
    };

    void fetchPatrols().finally(() => {
      if (!cancelled) scheduleNextPoll();
    });

    const unsubBudget = subscribeDataBudgetHints(() => {
      if (!cancelled) scheduleNextPoll();
    });

    let reconnectRealtimeTimer = 0;

    const attachPatrolLocationsRealtime = () => {
      if (subscription) {
        supabase.removeChannel(subscription);
        subscription = null;
      }
      subscription = supabase
        .channel('patrol-locations')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'patrol_locations' }, (payload) => {
          const row = payload.new;
          if (row == null) return;
          if (row.deleted_at != null) return;
          if (row.is_archived === true) return;
          const loc = normalizeLocationRow(row);
          if (!loc) return;
          setPatrols((prev) =>
            prev.map((p) => {
              const rowMs = latestInstantMs(row);
              const wallMin = Date.now() - MAX_POINT_AGE_MS;
              const rowMatchesPatroller = p.user_id != null && row.user_id === p.user_id;
              const matchesPatrol =
                rowMatchesPatroller && !Number.isNaN(rowMs) && rowMs >= wallMin;
              if (!matchesPatrol) return p;
              const nextPt = {
                latitude: loc.latitude,
                longitude: loc.longitude,
                timestamp: row.timestamp,
                displayTime: loc.displayTime,
              };
              const prev = (p.route || [])[p.route.length - 1];
              let nextRoute;
              if (
                prev &&
                distanceMeters(prev.latitude, prev.longitude, nextPt.latitude, nextPt.longitude) >
                  MAX_SEGMENT_METERS
              ) {
                nextRoute = [nextPt];
              } else {
                nextRoute = [...(p.route || []), nextPt].slice(-50);
              }
              return {
                ...p,
                currentLocation: loc,
                route: nextRoute,
                isActive: isPatrolActiveNow(p, loc),
              };
            })
          );
        })
        .subscribe((status) => {
          if (cancelled) return;
          if (status === 'SUBSCRIBED') {
            void fetchPatrols();
            return;
          }
          // Do not use CLOSED — it also fires when we removeChannel() during reconnect.
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            if (reconnectRealtimeTimer) window.clearTimeout(reconnectRealtimeTimer);
            reconnectRealtimeTimer = window.setTimeout(() => {
              reconnectRealtimeTimer = 0;
              if (!cancelled) attachPatrolLocationsRealtime();
            }, 2000);
          }
        });
    };

    attachPatrolLocationsRealtime();

    return () => {
      cancelled = true;
      if (reconnectRealtimeTimer) window.clearTimeout(reconnectRealtimeTimer);
      if (pollTimeoutId) window.clearTimeout(pollTimeoutId);
      unsubBudget();
      if (subscription) supabase.removeChannel(subscription);
    };
  }, []);

  const validPatrols = useMemo(() => patrols.filter(hasValidMapCoords), [patrols]);

  if (error) {
    return (
      <div className="h-[400px] md:h-[600px] w-full rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
            <FaMapMarkerAlt className="w-8 h-8 text-red-500" />
          </div>
          <h3 className="text-lg font-semibold text-red-900 dark:text-red-100 mb-2">Unable to Load Map</h3>
          <p className="text-red-600 dark:text-red-300 text-sm mb-4">{error}</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-[400px] md:h-[500px] lg:h-[600px] w-full rounded-2xl overflow-hidden shadow-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">
      <MapContainer
        center={validPatrols[0]?.currentLocation ? 
          [validPatrols[0].currentLocation.latitude, validPatrols[0].currentLocation.longitude] : 
          defaultCenter
        }
        zoom={14}
        style={{ height: '100%', width: '100%', minHeight: '400px' }}
        className="h-full w-full z-0"
        scrollWheelZoom={true}
      >
        <ResilientPatrolTileLayer />
        <InvalidateMapWhenReady />
        <InvalidateMapOnVisibility />

        <MapBoundsSetter patrols={validPatrols} />

        {validPatrols.map((patrol) => {
          const pos = [patrol.currentLocation.latitude, patrol.currentLocation.longitude];
          const accuracy = patrol.currentLocation.accuracy || 0;
          
          return (
            <div key={patrol.user_id}>
              {/* Route trail */}
              {patrol.route?.length > 1 && (
                <Polyline
                  positions={patrol.route.map(r => [r.latitude, r.longitude])}
                  color={COLOR_MAP[patrol.vehicleColor]?.hex || '#0d9488'}
                  weight={4}
                  opacity={0.8}
                  dashArray="6, 6"
                  lineCap="round"
                />
              )}

              {/* Accuracy circle */}
              {accuracy > 0 && (
                <Circle
                  center={pos}
                  radius={accuracy}
                  pathOptions={ACCURACY_CIRCLE_STYLE}
                />
              )}

              {/* Patrol marker */}
              <Marker
                position={pos}
                icon={createPatrolIcon(patrol, patrol.isActive)}
              >
                <Popup>
                  <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg min-w-[250px]">
                    <div className="flex items-center gap-3 mb-3">
                      <div 
                        className="w-12 h-12 rounded-full flex items-center justify-center text-2xl shadow-md bg-white dark:bg-gray-800"
                        style={{ border: `3px solid ${COLOR_MAP[patrol.vehicleColor]?.hex || '#0d9488'}` }}
                      >
                        <span className="text-lg leading-none">
                          {mapVehicleTypeToEmoji(normalizeVehicleType(patrol.vehicle_type))}
                        </span>
                      </div>
                      <div className="flex-1">
                        <h3 className="font-bold text-gray-900 dark:text-white text-lg">
                          {patrol.user_name || 'Unknown'}
                        </h3>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${patrol.isActive ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${patrol.isActive ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`}></span>
                          {patrol.isActive ? 'Active' : 'Idle'}
                        </span>
                      </div>
                    </div>
                    
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                        <span className="text-gray-500 dark:text-gray-400">Vehicle</span>
                        <span className="font-medium text-gray-900 dark:text-white">{patrol.vehicle_make_model || 'Unknown'}</span>
                      </div>
                      <div className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                        <span className="text-gray-500 dark:text-gray-400">Registration</span>
                        <span className="font-medium text-gray-900 dark:text-white">{patrol.vehicle_reg || patrol.reg_number || 'N/A'}</span>
                      </div>
                      <div className="p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-500 dark:text-gray-400">Last GPS fix</span>
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">your local time</span>
                        </div>
                        {(() => {
                          const gps = formatLastGpsForMap(
                            patrol.currentLocation.displayTime ?? patrol.currentLocation.timestamp
                          );
                          return (
                            <>
                              <p className="font-medium text-gray-900 dark:text-white font-mono tabular-nums text-sm" title={gps.title}>
                                {gps.primary}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">{gps.secondary}</p>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </Popup>
              </Marker>
            </div>
          );
        })}
      </MapContainer>

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/80 backdrop-blur-sm dark:bg-gray-900/80">
          <BrandedLoader message="Loading patrol data…" size="md" />
        </div>
      )}

      {/* Empty state */}
      {!loading && validPatrols.length === 0 && (
        <div className="absolute inset-0 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm flex items-center justify-center z-30">
          <div className="text-center p-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
              <FaUser className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              {patrols.length > 0 ? 'No GPS on map yet' : 'No Active Patrols'}
            </h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm max-w-xs">
              {patrols.length > 0
                ? 'Patrols are listed, but no location points matched (app may still be acquiring GPS, or the database has no points in the current window).'
                : 'There are currently no active patrols with location data available.'}
            </p>
          </div>
        </div>
      )}

      {/* Patrol list sidebar */}
      <div className="absolute top-3 left-3 md:top-4 md:left-4 z-30 w-56 sm:w-64 max-w-[calc(100%-1.5rem)] md:max-w-[calc(100%-2rem)]">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 bg-gradient-to-r from-teal-600 to-violet-600 border-b border-teal-500">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                <span>
                  On map ({validPatrols.length})
                  {patrols.length > 0 && (
                    <span className="font-normal opacity-90"> · {patrols.length} checked in</span>
                  )}
                </span>
              </h3>
            </div>
          </div>
          
          <div className="max-h-[180px] sm:max-h-[250px] overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
            {validPatrols.length === 0 ? (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                {loading
                  ? 'Loading...'
                  : patrols.length > 0
                    ? `${patrols.length} on patrol — no GPS points in the last window yet`
                    : 'No active patrols'}
              </div>
            ) : (
              validPatrols.map((patrol) => {
                const listAvatarUrl = resolvePatrolAvatarUrl(patrol, user);
                const borderHex = COLOR_MAP[patrol.vehicleColor]?.hex || '#0d9488';
                return (
                <div key={patrol.user_id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <button
                    type="button"
                    className="inline-flex items-center justify-center shrink-0 rounded-full border-0 bg-transparent p-0 m-0 appearance-none focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-800"
                    onClick={() =>
                      setPatrolPhotoPreview({
                        name: patrol.user_name || 'Unknown',
                        imageUrl: listAvatarUrl,
                      })
                    }
                    aria-label={`View photo of ${patrol.user_name || 'patroller'}`}
                  >
                    {listAvatarUrl ? (
                      <img
                        src={listAvatarUrl}
                        alt=""
                        className="w-10 h-10 rounded-full object-cover shadow-sm bg-white dark:bg-gray-800"
                        style={{ border: `3px solid ${borderHex}` }}
                      />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shadow-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        style={{ border: `3px solid ${borderHex}` }}
                      >
                        {(patrol.user_name || 'U')[0].toUpperCase()}
                      </div>
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white text-sm truncate">
                      {patrol.user_name || 'Unknown'}
                    </p>
                    {(() => {
                      const gps = formatLastGpsForMap(
                            patrol.currentLocation.displayTime ?? patrol.currentLocation.timestamp
                          );
                      return (
                        <div className="mt-0.5 space-y-0.5">
                          <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            Last GPS
                          </p>
                          <p
                            className="text-xs text-gray-700 dark:text-gray-300 font-mono tabular-nums leading-tight"
                            title={gps.title}
                          >
                            {gps.primary}
                          </p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{gps.secondary}</p>
                        </div>
                      );
                    })()}
                  </div>
                </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <PatrollerPhotoPreview
        open={!!patrolPhotoPreview}
        onClose={() => setPatrolPhotoPreview(null)}
        name={patrolPhotoPreview?.name}
        imageUrl={patrolPhotoPreview?.imageUrl}
      />

      {/* Legend */}
      <div className="absolute bottom-3 right-3 md:bottom-4 md:right-4 z-30">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
          <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">Vehicle Types</h4>
          <div className="space-y-1.5">
            {[
              { icon: '🚶', label: 'On Foot', color: 'bg-teal-100 text-teal-700' },
              { icon: '🚲', label: 'Bicycle', color: 'bg-violet-100 text-violet-700' },
              { icon: '🚗', label: 'Vehicle', color: 'bg-blue-100 text-blue-700' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs bg-white dark:bg-gray-100 shadow-sm border border-gray-200 dark:border-gray-300">
                  {item.icon}
                </span>
                <span className="text-xs text-gray-600 dark:text-gray-400">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes marker-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.1); opacity: 0.8; }
        }
        .marker-active {
          animation: marker-pulse 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}