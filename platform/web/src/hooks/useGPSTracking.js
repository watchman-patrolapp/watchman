// src/hooks/useGPSTracking.js - FIXED VERSION
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../supabase/client';
import { devLog, devWarn } from '../utils/devLog';
import { distanceMeters, getGpsUploadThrottle } from '../utils/dataSaverProfile';

async function ensureNativeLocationPermission() {
  if (!Capacitor.isNativePlatform()) return true;
  try {
    const { Geolocation } = await import('@capacitor/geolocation');
    let perm = await Geolocation.checkPermissions();
    if (perm.location !== 'granted') {
      perm = await Geolocation.requestPermissions();
    }
    return perm.location === 'granted';
  } catch (e) {
    devWarn('Native location permission check failed', e);
    return false;
  }
}

// ==========================================
// GLOBAL GPS SINGLETON - Persists across navigation
// ==========================================

const globalGPS = {
  watchId: null,
  listeners: new Set(),
  location: null,
  history: [],
  error: null,
  isActive: false,
  isLoading: true,
  hasPermission: false,
  currentPatrolId: null,
  userId: null,
  lastTrackUploadAt: 0,
  lastTrackLat: null,
  lastTrackLng: null,
  /** Last options used for watch — needed when resuming after tab visibility / pauseWatch */
  lastWatchOptions: null,

  subscribe(listener) {
    this.listeners.add(listener);
    listener({
      location: this.location,
      history: this.history,
      error: this.error,
      isActive: this.isActive,
      isLoading: this.isLoading
    });
    return () => this.listeners.delete(listener);
  },

  notify(updates) {
    Object.assign(this, updates);
    const state = {
      location: this.location,
      history: this.history,
      error: this.error,
      isActive: this.isActive,
      isLoading: this.isLoading
    };
    this.listeners.forEach(cb => cb(state));
  },

  validateCoords(coords) {
    if (!coords) return false;
    const { latitude, longitude } = coords;
    return (
      typeof latitude === 'number' &&
      typeof longitude === 'number' &&
      !isNaN(latitude) &&
      !isNaN(longitude) &&
      latitude !== 0 &&
      longitude !== 0 &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180
    );
  },

  async trackLocation(position) {
    // patrol_id must match active_patrols PK — in this project that is user_id (one row per patroller).
    // Reads must filter by patrol start_time so old session points aren’t drawn as one polyline.
    const effectivePatrolId = this.currentPatrolId;

    if (!effectivePatrolId || !this.userId) {
      devWarn('Cannot track location: missing patrol_id (active session key) or user_id', {
        currentPatrolId: this.currentPatrolId,
        userId: this.userId,
      });
      return;
    }

    devLog('Tracking location', {
      patrol_id: effectivePatrolId,
      user_id: this.userId,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude
    });

    // Omit `timestamp` — let Postgres DEFAULT NOW() apply. Client `new Date().toISOString()`
    // follows the device clock; wrong timezone or manual clock skew would corrupt history.
    const { error } = await supabase
      .from('patrol_locations')
      .insert({
        patrol_id: effectivePatrolId,
        user_id: this.userId,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude,
        speed: position.coords.speed,
      });

    if (error) {
      console.error('❌ Location insert error:', error);
    } else {
      devLog('Location saved to database');
    }
  },

  start(options = {}) {
    const {
      patrolId,
      userId,
      enableHighAccuracy = true,
      timeout = 10000,
      maximumAge = 0,
      historyLimit = 50
    } = options;

    if (userId != null && userId !== '') {
      this.userId = userId;
    }
    if (patrolId != null && patrolId !== '') {
      this.currentPatrolId = patrolId;
    } else {
      this.currentPatrolId = null;
    }

    if (!this.userId) {
      console.error('❌ Cannot start GPS: userId is required');
      this.notify({ error: 'User ID required', isLoading: false });
      return;
    }

    this.lastWatchOptions = {
      patrolId: this.currentPatrolId,
      userId: this.userId,
      enableHighAccuracy,
      timeout,
      maximumAge,
      historyLimit
    };

    devLog('GPS starting', { patrolId: this.currentPatrolId, userId: this.userId });

    if (this.watchId !== null) {
      devLog('GPS already active', this.watchId);
      this.notify({ isActive: true, isLoading: false });
      return;
    }

    if (!navigator.geolocation) {
      this.notify({
        error: 'Geolocation not supported',
        isLoading: false,
        isActive: false
      });
      return;
    }

    void this._beginWatch({
      enableHighAccuracy,
      timeout,
      maximumAge,
      historyLimit
    });
  },

  async _beginWatch({ enableHighAccuracy, timeout, maximumAge, historyLimit }) {
    this.notify({ isLoading: true });

    const allowed = await ensureNativeLocationPermission();
    if (!allowed) {
      this.hasPermission = false;
      this.notify({
        error: 'Location permission denied. Allow location for this app in system settings.',
        isActive: false,
        isLoading: false
      });
      return;
    }

    const handleSuccess = async (position) => {
      const { latitude, longitude, accuracy, heading, speed } = position.coords;

      if (!this.validateCoords(position.coords)) {
        devWarn('Invalid coordinates', position.coords);
        return;
      }

      this.hasPermission = true;

      const newLocation = {
        lat: latitude,
        lng: longitude,
        accuracy: accuracy || 0,
        heading: heading || 0,
        speed: speed || 0,
        timestamp: new Date().toISOString()
      };

      const newHistory = [...this.history.slice(-(historyLimit - 1)), newLocation];

      this.notify({
        location: newLocation,
        history: newHistory,
        error: null,
        isActive: true,
        isLoading: false
      });

      const throttle = getGpsUploadThrottle();
      const now = Date.now();
      let shouldUpload = true;
      if (this.lastTrackUploadAt && this.lastTrackLat != null && this.lastTrackLng != null) {
        const dt = now - this.lastTrackUploadAt;
        const d = distanceMeters(this.lastTrackLat, this.lastTrackLng, latitude, longitude);
        if (dt < throttle.minIntervalMs && d < throttle.minDistanceM) {
          shouldUpload = false;
        }
      }
      if (shouldUpload) {
        this.lastTrackUploadAt = now;
        this.lastTrackLat = latitude;
        this.lastTrackLng = longitude;
        await this.trackLocation(position);
      }
    };

    const handleError = (error) => {
      if (error.code === 1) {
        devWarn('Geolocation permission denied');
      } else {
        devLog('Geolocation error', error.code, error.message);
      }
      let errorMessage = 'Location error';
      switch (error.code) {
        case 1: errorMessage = 'Permission denied. Enable GPS.'; this.hasPermission = false; break;
        case 2: errorMessage = 'GPS signal lost.'; break;
        case 3: errorMessage = 'Request timed out.'; break;
        default: errorMessage = error.message;
      }
      this.notify({ error: errorMessage, isActive: false, isLoading: false });
    };

    const throttle = getGpsUploadThrottle();
    const watchHigh = enableHighAccuracy && throttle.enableHighAccuracy;
    const watchMaxAge = Math.max(maximumAge ?? 0, throttle.maximumAge);
    navigator.geolocation.getCurrentPosition(handleSuccess, handleError, {
      enableHighAccuracy: watchHigh,
      timeout,
      maximumAge: watchMaxAge,
    });
    this.watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, {
      enableHighAccuracy: watchHigh,
      maximumAge: watchMaxAge,
      timeout,
    });
    this.isActive = true;
    devLog('GPS started', this.watchId);
  },

  /** Stop watch only — keeps patrol/user ids for resume (e.g. web tab refresh path). */
  pauseWatch() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      devLog('GPS watch cleared', this.watchId);
      this.watchId = null;
      this.isActive = false;
      this.notify({ isActive: false });
    }
  },

  stop() {
    this.pauseWatch();
    this.currentPatrolId = null;
    this.userId = null;
    this.lastWatchOptions = null;
    this.lastTrackUploadAt = 0;
    this.lastTrackLat = null;
    this.lastTrackLng = null;
    this.notify({ isActive: false });
  },

  setupAutoStopTimer(durationMinutes = 480) {
    const durationMs = durationMinutes * 60 * 1000;

    devLog(`Auto-stop timer set for ${durationMinutes} minutes`);

    const timer = setTimeout(() => {
      devLog('Auto-stop timer triggered — ending patrol');
      this.stop();
    }, durationMs);

    return () => {
      clearTimeout(timer);
      devLog('Auto-stop timer cleared');
    };
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (Capacitor.isNativePlatform()) return;
    globalGPS.pauseWatch();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!globalGPS.hasPermission || globalGPS.isActive || !globalGPS.userId) return;
    devLog('Tab visible, restarting GPS');
    globalGPS.start(globalGPS.lastWatchOptions || {
      userId: globalGPS.userId,
      patrolId: globalGPS.currentPatrolId
    });
  });
}

export function useGPSTracking(options = {}) {
  const [state, setState] = useState({
    location: globalGPS.location,
    history: globalGPS.history,
    error: globalGPS.error,
    isActive: globalGPS.isActive,
    isLoading: globalGPS.isLoading
  });

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const totalDistance = useMemo(() => {
    const pts = state.history || [];
    if (pts.length < 2) return 0;
    let m = 0;
    for (let i = 1; i < pts.length; i++) {
      m += distanceMeters(
        pts[i - 1].lat,
        pts[i - 1].lng,
        pts[i].lat,
        pts[i].lng
      );
    }
    return m / 1000;
  }, [state.history]);

  useEffect(() => {
    const unsubscribe = globalGPS.subscribe((newState) => {
      setState(newState);
    });
    globalGPS.start(optionsRef.current);
    return () => {
      unsubscribe();
    };
  }, []);

  const startTracking = useCallback(() => {
    globalGPS.start(optionsRef.current);
  }, []);

  const stopTracking = useCallback(() => {
    globalGPS.stop();
  }, []);

  const restartTracking = useCallback(() => {
    globalGPS.stop();
    setTimeout(() => globalGPS.start(optionsRef.current), 100);
  }, []);

  useEffect(() => {
    globalGPS.userId = options.userId ?? null;
    globalGPS.currentPatrolId =
      options.patrolId != null && options.patrolId !== '' ? options.patrolId : null;
    devLog('GPS IDs updated', {
      patrolId: globalGPS.currentPatrolId,
      userId: globalGPS.userId,
    });
  }, [options.patrolId, options.userId]);

  return {
    ...state,
    currentLocation: state.location,
    routePoints: state.history,
    totalDistance,
    isTracking: state.isActive,
    startTracking,
    stopTracking,
    restartTracking,
    setupAutoStopTimer: globalGPS.setupAutoStopTimer,
    hasPermission: globalGPS.hasPermission
  };
}
