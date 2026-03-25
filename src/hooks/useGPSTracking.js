import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabase/client';
import toast from 'react-hot-toast';

// Calculate distance between two coordinates in km (Haversine formula)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

export function useGPSTracking(userId, patrolId, isActive) {
  const [isTracking, setIsTracking] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [totalDistance, setTotalDistance] = useState(0);
  const [routePoints, setRoutePoints] = useState([]);
  const [error, setError] = useState(null);
  
  const watchIdRef = useRef(null);
  const lastLocationRef = useRef(null);
  const batchBufferRef = useRef([]);
  const patrolIdRef = useRef(patrolId);
  const autoStopTimerRef = useRef(null);
  const totalDistanceRef = useRef(0);
  const routePointsRef = useRef([]);
  
  // Update patrol ID ref when it changes
  useEffect(() => {
    patrolIdRef.current = patrolId;
  }, [patrolId]);

  // Keep refs in sync with state
  useEffect(() => {
    totalDistanceRef.current = totalDistance;
  }, [totalDistance]);

  useEffect(() => {
    routePointsRef.current = routePoints;
  }, [routePoints]);

  // Batch insert locations to reduce API calls
  const flushBuffer = useCallback(async () => {
    if (batchBufferRef.current.length === 0 || !patrolIdRef.current) return;
    
    const batch = [...batchBufferRef.current];
    batchBufferRef.current = [];
    
    try {
      const { error } = await supabase
        .from('patrol_locations')
        .insert(batch.map(point => ({
          user_id: userId,
          patrol_id: patrolIdRef.current,
          latitude: point.lat,
          longitude: point.lng,
          accuracy: point.accuracy,
          altitude: point.altitude,
          speed: point.speed,
          timestamp: point.timestamp
        })));
      
      if (error) throw error;
    } catch (err) {
      console.error('Failed to save locations:', err);
      // Put back in buffer for retry
      batchBufferRef.current = [...batch, ...batchBufferRef.current].slice(0, 100);
    }
  }, [userId]);

  // Flush buffer every 10 seconds
  useEffect(() => {
    if (!isActive) return;
    
    const interval = setInterval(flushBuffer, 10000);
    return () => clearInterval(interval);
  }, [isActive, flushBuffer]);

  // Stop tracking
  async function stopTracking() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    
    // Clear auto-stop timer
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    
    // Flush remaining buffer
    await flushBuffer();
    
    setIsTracking(false);
    
    // Save final route summary
    if (patrolIdRef.current && routePointsRef.current.length > 0) {
      try {
        const currentRoute = routePointsRef.current;
        const currentDistance = totalDistanceRef.current;
        
        const geojson = {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: currentRoute.map(p => [p.lng, p.lat])
          },
          properties: {
            start: currentRoute[0].timestamp,
            end: currentRoute[currentRoute.length - 1].timestamp
          }
        };

        await supabase
          .from('patrol_routes')
          .upsert({
            user_id: userId,
            patrol_id: patrolIdRef.current,
            total_distance_km: currentDistance,
            total_duration_seconds: Math.floor((new Date() - new Date(currentRoute[0].timestamp)) / 1000),
            start_location: { lat: currentRoute[0].lat, lng: currentRoute[0].lng },
            end_location: { lat: currentRoute[currentRoute.length - 1].lat, lng: currentRoute[currentRoute.length - 1].lng },
            route_geojson: geojson
          }, { onConflict: 'patrol_id' });
      } catch (err) {
        console.error('Failed to save route:', err);
      }
    }
  }

  // Auto-stop GPS tracking after 2.5 hours (synced with patrol timer)
  const setupAutoStopTimer = useCallback((patrolStartTime) => {
    if (!patrolStartTime || !isActive) return;
    
    const PATROL_AUTO_END_MS = 2.5 * 60 * 60 * 1000; // 2.5 hours = 9,000,000ms
    const startTime = new Date(patrolStartTime).getTime();
    const endTime = startTime + PATROL_AUTO_END_MS;
    const now = Date.now();
    
    // Clear any existing timer
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    
    if (now >= endTime) {
      // Already exceeded - stop immediately
      toast.info('GPS tracking auto-stopped after 2.5 hours');
      stopTracking();
      return;
    }
    
    // Set auto-stop timer
    const timeUntilAutoStop = endTime - now;
    autoStopTimerRef.current = setTimeout(() => {
      toast.info('GPS tracking auto-stopped after 2.5 hours');
      stopTracking();
    }, timeUntilAutoStop);
  }, [isActive]);

  // Start tracking
  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser');
      toast.error('GPS not available on this device');
      return;
    }

    setIsTracking(true);
    setError(null);

    // Get initial position
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude,
          speed: position.coords.speed,
          timestamp: new Date().toISOString()
        };
        
        setCurrentLocation(point);
        lastLocationRef.current = point;
        setRoutePoints([point]);
        
        // Add to batch
        batchBufferRef.current.push(point);
      },
      (err) => {
        console.error('GPS Error:', err);
        setError(err.message);
        toast.error('GPS access denied. Please enable location permissions.');
        setIsTracking(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    // Watch position changes
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const point = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude,
          speed: position.coords.speed,
          timestamp: new Date().toISOString()
        };

        // Calculate distance from last point
        if (lastLocationRef.current) {
          const distance = calculateDistance(
            lastLocationRef.current.lat,
            lastLocationRef.current.lng,
            point.lat,
            point.lng
          );
          
          // Only add point if moved more than 10 meters (filter noise)
          if (distance >= 0.01) {
            setTotalDistance(prev => prev + distance);
            setRoutePoints(prev => [...prev, point]);
            batchBufferRef.current.push(point);
            lastLocationRef.current = point;
          }
        } else {
          lastLocationRef.current = point;
        }

        setCurrentLocation(point);
      },
      (err) => {
        console.error('GPS Watch Error:', err);
        // Don't stop tracking on temporary errors
        if (err.code === 1) { // Permission denied
          setError('Permission denied');
          toast.error('GPS permission denied');
          stopTracking();
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
        distanceFilter: 10 // Minimum distance (meters) before update
      }
    );
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (autoStopTimerRef.current) {
        clearTimeout(autoStopTimerRef.current);
      }
      flushBuffer();
    };
  }, [flushBuffer]);

  return {
    isTracking,
    currentLocation,
    totalDistance,
    routePoints,
    error,
    startTracking,
    stopTracking,
    setupAutoStopTimer
  };
}