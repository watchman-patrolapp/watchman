import { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle, useMap } from 'react-leaflet';
import { supabase } from '../supabase/client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { COLOR_MAP, normalizeVehicleType } from './VehicleIcon';
import { FaClock, FaMapMarkerAlt, FaRuler, FaUser, FaRoad, FaRoute } from 'react-icons/fa';

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

// Create custom icon for patrol marker
const createPatrolIcon = (patrol, isActive) => {
  const colorData = COLOR_MAP[patrol.vehicleColor?.toLowerCase()] || COLOR_MAP.blue;
  const firstName = (patrol.user_name || 'Unknown').split(' ')[0];
  
  return L.divIcon({
    className: 'custom-patrol-marker',
    html: `
      <div class="relative flex flex-col items-center">
        <div class="w-10 h-10 rounded-full border-2 border-white dark:border-gray-800 shadow-lg flex items-center justify-center text-lg ${isActive ? 'marker-active' : ''}"
             style="background-color: ${colorData.hex};">
          ${normalizeVehicleType(patrol.vehicle_type) === 'on_foot' ? '🚶' : 
            normalizeVehicleType(patrol.vehicle_type) === 'bicycle' ? '🚲' : 
            normalizeVehicleType(patrol.vehicle_type) === 'motorcycle' ? '🏍️' : '🚗'}
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
  const [patrols, setPatrols] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Default center (Theescombe, Gqeberha)
  const defaultCenter = [-33.95, 25.58];

  useEffect(() => {
    let subscription;
    let interval;
    
    const fetchPatrols = async () => {
      try {
        setLoading(true);
        
        const { data: activePatrols, error: patrolError } = await supabase
          .from('active_patrols')
          .select('*');

        if (patrolError) throw patrolError;
        
        if (!activePatrols?.length) {
          setPatrols([]);
          setLoading(false);
          return;
        }

        // Fetch locations for each patrol
        const patrolsWithLocations = await Promise.all(
          activePatrols.map(async (patrol) => {
            try {
              const { data: location } = await supabase
                .from('patrol_locations')
                .select('*')
                .eq('patrol_id', patrol.user_id)
                .order('timestamp', { ascending: false })
                .limit(1)
                .maybeSingle();

              const { data: route } = await supabase
                .from('patrol_locations')
                .select('latitude, longitude, timestamp')
                .eq('patrol_id', patrol.user_id)
                .order('timestamp', { ascending: true })
                .limit(50);

              const vehicleType = patrol.vehicle_type || 
                (patrol.vehicle_make_model?.toLowerCase().includes('bike') ? 'bicycle' : 'car');

              return {
                ...patrol,
                id: patrol.user_id,
                currentLocation: location,
                route: route || [],
                vehicleType,
                vehicleColor: patrol.vehicle_color || 'blue',
                isActive: location ? (new Date() - new Date(location.timestamp)) < 300000 : false
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
        setLoading(false);
      }
    };

    fetchPatrols();
    interval = setInterval(fetchPatrols, 10000);

    subscription = supabase
      .channel('patrol-locations')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'patrol_locations' }, (payload) => {
        setPatrols(prev => prev.map(p => {
          if (p.id === payload.new.patrol_id) {
            return {
              ...p,
              currentLocation: payload.new,
              route: [...(p.route || []), { 
                latitude: payload.new.latitude, 
                longitude: payload.new.longitude,
                timestamp: payload.new.timestamp 
              }].slice(-50)
            };
          }
          return p;
        }));
      })
      .subscribe();

    return () => {
      if (subscription) supabase.removeChannel(subscription);
      clearInterval(interval);
    };
  }, []);

  const validPatrols = useMemo(() => 
    patrols.filter(p => p.currentLocation?.latitude && p.currentLocation?.longitude),
  [patrols]);

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
        className="h-full w-full z-0"
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        <MapBoundsSetter patrols={validPatrols} />

        {validPatrols.map((patrol) => {
          const pos = [patrol.currentLocation.latitude, patrol.currentLocation.longitude];
          const accuracy = patrol.currentLocation.accuracy || 0;
          
          return (
            <div key={patrol.id}>
              {/* Route trail */}
              {patrol.route?.length > 1 && (
                <Polyline
                  positions={patrol.route.map(r => [r.latitude, r.longitude])}
                  color={COLOR_MAP[patrol.vehicleColor]?.hex || '#6366f1'}
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
                  pathOptions={{
                    fillColor: COLOR_MAP[patrol.vehicleColor]?.hex || '#6366f1',
                    fillOpacity: 0.1,
                    color: COLOR_MAP[patrol.vehicleColor]?.hex || '#6366f1',
                    weight: 1,
                    opacity: 0.3,
                    dashArray: '4, 4'
                  }}
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
                        className="w-12 h-12 rounded-full flex items-center justify-center text-2xl shadow-md"
                        style={{ backgroundColor: COLOR_MAP[patrol.vehicleColor]?.hex || '#6366f1' }}
                      >
                        <span className="text-white text-lg">
                          {normalizeVehicleType(patrol.vehicle_type) === 'on_foot' ? '🚶' : 
                           normalizeVehicleType(patrol.vehicle_type) === 'bicycle' ? '🚲' : '🚗'}
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
                      <div className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                        <span className="text-gray-500 dark:text-gray-400">Accuracy</span>
                        <span className="font-medium text-gray-900 dark:text-white">{Math.round(accuracy)}m</span>
                      </div>
                      <div className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                        <span className="text-gray-500 dark:text-gray-400">Last Update</span>
                        <span className="font-medium text-gray-900 dark:text-white">{new Date(patrol.currentLocation.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
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
        <div className="absolute inset-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm flex items-center justify-center z-[1000]">
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-3"></div>
            <p className="text-gray-600 dark:text-gray-300 font-medium">Loading patrol data...</p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && validPatrols.length === 0 && (
        <div className="absolute inset-0 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm flex items-center justify-center z-[500]">
          <div className="text-center p-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
              <FaUser className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No Active Patrols</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm max-w-xs">
              There are currently no active patrols with location data available.
            </p>
          </div>
        </div>
      )}

      {/* Patrol list sidebar */}
      <div className="absolute top-4 left-4 z-[1000] w-64 max-w-[calc(100%-2rem)]">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 border-b border-indigo-500">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                Live Patrols ({validPatrols.length})
              </h3>
            </div>
          </div>
          
          <div className="max-h-[250px] overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
            {validPatrols.length === 0 ? (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                {loading ? 'Loading...' : 'No active patrols'}
              </div>
            ) : (
              validPatrols.map((patrol) => (
                <div key={patrol.id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <div 
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shadow-sm"
                    style={{ backgroundColor: COLOR_MAP[patrol.vehicleColor]?.hex || '#6366f1' }}
                  >
                    {(patrol.user_name || 'U')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white text-sm truncate">
                      {patrol.user_name || 'Unknown'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {new Date(patrol.currentLocation.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 right-4 z-[1000]">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
          <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">Vehicle Types</h4>
          <div className="space-y-1.5">
            {[
              { icon: '🚶', label: 'On Foot', color: 'bg-teal-100 text-teal-700' },
              { icon: '🚲', label: 'Bicycle', color: 'bg-violet-100 text-violet-700' },
              { icon: '🚗', label: 'Vehicle', color: 'bg-blue-100 text-blue-700' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs bg-white dark:bg-gray-700 shadow-sm border border-gray-200 dark:border-gray-600">
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