import { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle } from 'react-leaflet';
import { supabase } from '../supabase/client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Custom icons for different vehicle types
const createPatrolIcon = (vehicleType, isActive) => {
  const color = vehicleType === 'on_foot' ? '#14b8a6' : 
                vehicleType === 'bicycle' ? '#6366f1' : '#3b82f6';
  
  return L.divIcon({
    className: 'custom-patrol-marker',
    html: `
      <div style="
        width: 20px;
        height: 20px;
        background-color: ${color};
        border: 3px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        animation: ${isActive ? 'pulse 2s infinite' : 'none'};
      "></div>
    `,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
};

export default function LivePatrolMap() {
  const [patrols, setPatrols] = useState([]);
  const mapRef = useRef(null);

  // Fetch active patrols with latest locations
  useEffect(() => {
    const fetchPatrols = async () => {
      const { data: activePatrols } = await supabase
        .from('active_patrols')
        .select('*');
      
      if (!activePatrols) return;

      // Get latest location for each patrol
      const patrolsWithLocations = await Promise.all(
        activePatrols.map(async (patrol) => {
          const { data: locations } = await supabase
            .from('patrol_locations')
            .select('*')
            .eq('patrol_id', patrol.id)
            .order('timestamp', { ascending: false })
            .limit(1);
          
          // Get route points for this patrol
          const { data: routePoints } = await supabase
            .from('patrol_locations')
            .select('latitude, longitude')
            .eq('patrol_id', patrol.id)
            .order('timestamp', { ascending: true });
          
          return {
            ...patrol,
            currentLocation: locations?.[0] || null,
            route: routePoints || []
          };
        })
      );

      setPatrols(patrolsWithLocations.filter(p => p.currentLocation));
    };

    fetchPatrols();

    // Subscribe to real-time location updates
    const subscription = supabase
      .channel('patrol-locations')
      .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'patrol_locations' },
        (payload) => {
          setPatrols(prev => prev.map(p => {
            if (p.id === payload.new.patrol_id) {
              return {
                ...p,
                currentLocation: payload.new,
                route: [...p.route, { latitude: payload.new.latitude, longitude: payload.new.longitude }]
              };
            }
            return p;
          }));
        }
      )
      .subscribe();

    return () => supabase.removeChannel(subscription);
  }, []);

  // Center map on first patrol
  const center = patrols[0]?.currentLocation 
    ? [patrols[0].currentLocation.latitude, patrols[0].currentLocation.longitude]
    : [-33.9, 25.6]; // Default: Gqeberha area

  return (
    <div className="h-[600px] w-full rounded-2xl overflow-hidden shadow-lg border border-gray-200 dark:border-gray-700">
      <MapContainer
        center={center}
        zoom={13}
        ref={mapRef}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {patrols.map((patrol) => (
          patrol.currentLocation && (
            <div key={patrol.id}>
              {/* Route line */}
              {patrol.route.length > 1 && (
                <Polyline
                  positions={patrol.route.map(r => [r.latitude, r.longitude])}
                  color={patrol.vehicle_type === 'on_foot' ? '#14b8a6' : 
                         patrol.vehicle_type === 'bicycle' ? '#6366f1' : '#3b82f6'}
                  weight={3}
                  opacity={0.7}
                />
              )}
              
              {/* Current position marker */}
              <Marker
                position={[
                  patrol.currentLocation.latitude,
                  patrol.currentLocation.longitude
                ]}
                icon={createPatrolIcon(patrol.vehicle_type, true)}
              >
                <Popup>
                  <div className="p-2">
                    <h3 className="font-bold text-gray-900">{patrol.user_name}</h3>
                    <p className="text-sm text-gray-600">
                      {patrol.vehicle_make_model || patrol.car_type || 'On foot'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Last update: {new Date(patrol.currentLocation.timestamp).toLocaleTimeString()}
                    </p>
                    <p className="text-xs text-gray-500">
                      Accuracy: {Math.round(patrol.currentLocation.accuracy)}m
                    </p>
                  </div>
                </Popup>
              </Marker>
              
              {/* Accuracy circle */}
              <Circle
                center={[
                  patrol.currentLocation.latitude,
                  patrol.currentLocation.longitude
                ]}
                radius={patrol.currentLocation.accuracy}
                pathOptions={{ 
                  fillColor: 'blue', 
                  fillOpacity: 0.1, 
                  color: 'blue', 
                  weight: 1,
                  opacity: 0.3
                }}
              />
            </div>
          )
        ))}
      </MapContainer>
      
      {/* Legend */}
      <div className="absolute bottom-4 right-4 bg-white dark:bg-gray-800 p-3 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 z-[1000]">
        <h4 className="text-sm font-semibold mb-2 dark:text-white">Active Patrols</h4>
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-teal-500"></span>
            <span className="dark:text-gray-300">On Foot</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-indigo-500"></span>
            <span className="dark:text-gray-300">Bicycle</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-blue-500"></span>
            <span className="dark:text-gray-300">Vehicle</span>
          </div>
        </div>
      </div>
    </div>
  );
}