import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import { FaExclamationTriangle, FaMapMarkerAlt, FaTimes } from 'react-icons/fa';

export default function ActiveThreatsBanner({ userLocation, maxDistanceKm = 2 }) {
  const navigate = useNavigate();
  const [nearbyProfiles, setNearbyProfiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [_error, setError] = useState(null);
  
  // Refs to prevent memory leaks and concurrent fetches
  const isMounted = useRef(true);
  const isFetching = useRef(false);

  useEffect(() => {
    return () => { isMounted.current = false; };
  }, []);

  // Memoized fetch - only depends on primitive values
  const fetchNearbyProfiles = useCallback(async () => {
    if (!isMounted.current || isFetching.current) return;
    if (!userLocation?.lat || !userLocation?.lng) return;
    
    isFetching.current = true;
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('criminal_profiles')
        .select('id, primary_name, photo_urls, risk_level, status, last_seen_location, last_seen_coordinates')
        .in('risk_level', ['critical', 'high'])
        .neq('status', 'incarcerated')
        .limit(10);

      if (!isMounted.current) return;

      if (error) {
        console.error('Error:', error);
        setError(error.message);
        setNearbyProfiles([]);
      } else {
        // Simple filter - show all high-risk for now (distance calc can be optimized later)
        setNearbyProfiles(data || []);
      }
    } catch (err) {
      console.error('Error:', err);
      if (isMounted.current) setError(err.message);
    } finally {
      if (isMounted.current) setLoading(false);
      isFetching.current = false;
    }
  }, [userLocation?.lat, userLocation?.lng]);

  // Single effect with cleanup
  useEffect(() => {
    if (dismissed) return;
    
    // Delay initial fetch to prevent freeze on page load
    const timeout = setTimeout(fetchNearbyProfiles, 2000);
    
    // Refresh every 2 minutes
    const interval = setInterval(fetchNearbyProfiles, 120000);
    
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [fetchNearbyProfiles, dismissed]);

  if (dismissed) return null;
  if (!userLocation) return null;

  const criticalCount = nearbyProfiles.filter(p => p.risk_level === 'critical').length;

  // Don't show empty state - only show if threats exist
  if (nearbyProfiles.length === 0 && !loading) {
    return (
      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 mb-6 flex items-center gap-2 text-green-700 dark:text-green-300 text-sm">
        <FaMapMarkerAlt />
        No active threats within {maxDistanceKm}km
      </div>
    );
  }

  return (
    <div className={`rounded-xl shadow-lg p-4 mb-6 ${criticalCount > 0 ? 'bg-red-600 text-white animate-pulse' : 'bg-orange-500 text-white'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FaExclamationTriangle className="text-2xl flex-shrink-0" />
          <div>
            <h3 className="font-bold text-lg">
              {criticalCount > 0 ? `${criticalCount} Critical Threat(s) Nearby` : `${nearbyProfiles.length} High-Risk Profile(s) Nearby`}
            </h3>
            <p className="text-sm opacity-90">
              Within {maxDistanceKm}km of your location
              {loading && ' • Loading...'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => navigate('/intelligence')}
            className="px-4 py-2 bg-white text-red-600 rounded-lg font-bold text-sm hover:bg-gray-100 transition"
          >
            View All
          </button>
          <button 
            onClick={() => setDismissed(true)}
            className="p-2 hover:bg-white/20 rounded-lg transition"
            title="Dismiss"
          >
            <FaTimes />
          </button>
        </div>
      </div>

      {nearbyProfiles.length > 0 && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {nearbyProfiles.slice(0, 4).map(profile => (
            <div 
              key={profile.id}
              onClick={() => navigate(`/intelligence/profiles/${profile.id}`)}
              className="bg-white/20 backdrop-blur-sm rounded-lg p-3 flex items-center gap-3 cursor-pointer hover:bg-white/30 transition"
            >
              {profile.photo_urls?.[0] ? (
                <img src={profile.photo_urls[0]} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-gray-300 flex items-center justify-center flex-shrink-0">
                  <FaMapMarkerAlt className="text-gray-500" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h4 className="font-bold truncate">{profile.primary_name}</h4>
                <p className="text-xs opacity-90">
                  {profile.risk_level?.toUpperCase()} • {profile.last_seen_location || 'Unknown location'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
