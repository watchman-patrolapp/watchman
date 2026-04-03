import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import { FaExclamationTriangle, FaMapMarkerAlt, FaTimes } from 'react-icons/fa';
import { mergedSightingsForDisplay } from '../../utils/criminalProfileSightings';

/** Haversine distance in km */
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Parse Postgres point / string "(lat,lng)" from our app (see syncLegacyLastSeenFromSightings). */
function parseProfilePoint(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object' && raw !== null) {
    const lat = Number(raw.y ?? raw.lat);
    const lng = Number(raw.x ?? raw.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  if (typeof raw === 'string') {
    const m = raw.replace(/[()]/g, '').split(',');
    if (m.length >= 2) {
      const lat = Number(m[0].trim());
      const lng = Number(m[1].trim());
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
  }
  return null;
}

/**
 * Only alert when a high-risk profile has a sighting (or legacy last_seen) that is both
 * recent and within maxDistanceKm (requires coordinates on that sighting / point).
 */
function filterProfilesWithRecentNearbySightings(profiles, userLat, userLng, maxDistanceKm, recentWindowMs) {
  const now = Date.now();
  const out = [];

  for (const profile of profiles || []) {
    const sightings = mergedSightingsForDisplay(profile);
    let matched = null;

    for (const s of sightings) {
      if (!s.seen_at || String(s.seen_at).trim() === '') continue;
      const t = new Date(s.seen_at).getTime();
      if (!Number.isFinite(t) || now - t > recentWindowMs || now - t < 0) continue;

      const slat = s.lat != null ? Number(s.lat) : NaN;
      const slng = s.lng != null ? Number(s.lng) : NaN;
      if (Number.isFinite(slat) && Number.isFinite(slng)) {
        const d = distanceKm(userLat, userLng, slat, slng);
        if (d <= maxDistanceKm) {
          matched = { distanceKm: d, label: (s.location || '').trim() || 'Reported location', seenAt: s.seen_at };
          break;
        }
      }
    }

    if (!matched && profile.last_seen_at) {
      const t = new Date(profile.last_seen_at).getTime();
      if (Number.isFinite(t) && now - t <= recentWindowMs && now - t >= 0) {
        const pt = parseProfilePoint(profile.last_seen_coordinates);
        if (pt) {
          const d = distanceKm(userLat, userLng, pt.lat, pt.lng);
          if (d <= maxDistanceKm) {
            matched = {
              distanceKm: d,
              label: (profile.last_seen_location || '').trim() || 'Last known location',
              seenAt: profile.last_seen_at,
            };
          }
        }
      }
    }

    if (matched) {
      out.push({ ...profile, _threatMatch: matched });
    }
  }

  out.sort((a, b) => (a._threatMatch.distanceKm || 0) - (b._threatMatch.distanceKm || 0));
  return out;
}

export default function ActiveThreatsBanner({
  userLocation,
  maxDistanceKm = 2,
  /** Only sightings / last_seen within this many hours count (stale intel is not an “active” threat). */
  recentSightingHours = 3,
}) {
  const navigate = useNavigate();
  const [nearbyProfiles, setNearbyProfiles] = useState([]);
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

    try {
      const recentWindowMs = Math.max(1, recentSightingHours) * 60 * 60 * 1000;

      const { data, error } = await supabase
        .from('criminal_profiles')
        .select(
          'id, primary_name, photo_urls, risk_level, status, last_seen_location, last_seen_coordinates, last_seen_at, sightings_log'
        )
        .in('risk_level', ['critical', 'high'])
        .neq('status', 'incarcerated')
        .limit(80);

      if (!isMounted.current) return;

      if (error) {
        console.error('Error:', error);
        setError(error.message);
        setNearbyProfiles([]);
      } else {
        const filtered = filterProfilesWithRecentNearbySightings(
          data || [],
          userLocation.lat,
          userLocation.lng,
          maxDistanceKm,
          recentWindowMs
        );
        setNearbyProfiles(filtered);
      }
    } catch (err) {
      console.error('Error:', err);
      if (isMounted.current) setError(err.message);
    } finally {
      isFetching.current = false;
    }
  }, [userLocation?.lat, userLocation?.lng, maxDistanceKm, recentSightingHours]);

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

  /** Only show when there is at least one matching threat — no “all clear” banner (avoids noisy repeats). */
  if (nearbyProfiles.length === 0) return null;

  const criticalCount = nearbyProfiles.filter(p => p.risk_level === 'critical').length;

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
              Seen within last {recentSightingHours}h and within {maxDistanceKm}km (GPS)
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
                  {profile.risk_level?.toUpperCase()} • ~{profile._threatMatch?.distanceKm != null ? `${profile._threatMatch.distanceKm.toFixed(1)}km` : '?'} •{' '}
                  {profile._threatMatch?.label || profile.last_seen_location || 'Location'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
