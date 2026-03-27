// src/hooks/useGPSTracking.js - FIXED VERSION
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabase/client';

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
  
  // ✅ FIXED: Location tracking uses user_id as patrol_id (matches your schema)
  async trackLocation(position) {
    // Use userId as patrolId since active_patrols uses user_id as primary key
    const effectivePatrolId = this.currentPatrolId || this.userId;
    
    if (!effectivePatrolId || !this.userId) {
      console.warn('⚠️ Cannot track location: missing patrol_id or user_id');
      console.warn('Current patrol_id:', this.currentPatrolId);
      console.warn('Current user_id:', this.userId);
      console.warn('Effective patrol_id (used for DB):', effectivePatrolId);
      return;
    }

    console.log('📍 Tracking location:', {
      patrol_id: effectivePatrolId,
      user_id: this.userId,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy
    });

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
        timestamp: new Date().toISOString()
      });

    if (error) {
      console.error('❌ Location insert error:', error);
    } else {
      console.log('✅ Location successfully saved to database');
    }
  },
  
  start(options = {}) {
    const { patrolId, userId } = options;
    
    // ✅ FIXED: Store patrol and user info - fallback to userId as patrolId
    this.userId = userId;
    this.currentPatrolId = patrolId || userId; // If no patrolId provided, use userId

    if (!this.userId) {
      console.error('❌ Cannot start GPS: userId is required');
      this.notify({ error: 'User ID required', isLoading: false });
      return;
    }

    console.log('🔑 GPS starting with:', { 
      patrolId: this.currentPatrolId, 
      userId: this.userId 
    });

    if (this.watchId !== null) {
      console.log('🌍 GPS already active, ID:', this.watchId);
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

    const { 
      enableHighAccuracy = true, 
      timeout = 10000, 
      maximumAge = 0, 
      historyLimit = 50 
    } = options;

    this.notify({ isLoading: true });

    const handleSuccess = async (position) => {
      const { latitude, longitude, accuracy, heading, speed } = position.coords;
      
      if (!this.validateCoords(position.coords)) {
        console.warn('⚠️ Invalid coordinates:', position.coords);
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

      // ✅ Track location in database
      await this.trackLocation(position);
    };

    const handleError = (error) => {
      console.error('❌ Geolocation error:', error.code, error.message);
      let errorMessage = 'Location error';
      switch (error.code) {
        case 1: errorMessage = 'Permission denied. Enable GPS.'; this.hasPermission = false; break;
        case 2: errorMessage = 'GPS signal lost.'; break;
        case 3: errorMessage = 'Request timed out.'; break;
        default: errorMessage = error.message;
      }
      this.notify({ error: errorMessage, isActive: false, isLoading: false });
    };

    navigator.geolocation.getCurrentPosition(handleSuccess, handleError, { enableHighAccuracy, timeout, maximumAge });
    this.watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, { enableHighAccuracy, maximumAge, timeout, distanceFilter: 10 });
    this.isActive = true;
    console.log('✅ GPS started:', this.watchId);
  },
  
  stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      console.log('🛑 GPS stopped:', this.watchId);
      this.watchId = null;
      this.isActive = false;
      this.currentPatrolId = null;
      this.userId = null;
      this.notify({ isActive: false });
    }
  },
  
  setupAutoStopTimer(durationMinutes = 480) {
    const durationMs = durationMinutes * 60 * 1000;
    
    console.log(`⏱️ Auto-stop timer set for ${durationMinutes} minutes`);
    
    const timer = setTimeout(() => {
      console.log('🛑 Auto-stop timer triggered - ending patrol');
      this.stop();
    }, durationMs);

    return () => {
      clearTimeout(timer);
      console.log('⏱️ Auto-stop timer cleared');
    };
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => globalGPS.stop());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && globalGPS.hasPermission && !globalGPS.isActive) {
      console.log('👁️ Tab visible, restarting GPS...');
      globalGPS.start();
    }
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

  // ✅ FIXED: Properly update IDs when options change
  useEffect(() => {
    if (options.patrolId || options.userId) {
      const newPatrolId = options.patrolId || options.userId; // Fallback to userId
      const newUserId = options.userId;
      
      globalGPS.currentPatrolId = newPatrolId;
      globalGPS.userId = newUserId;
      
      console.log('🔑 GPS IDs updated:', { 
        patrolId: newPatrolId, 
        userId: newUserId 
      });
    }
  }, [options.patrolId, options.userId]);

  return {
    ...state,
    currentLocation: state.location,
    routePoints: state.history,
    isTracking: state.isActive,
    startTracking,
    stopTracking,
    restartTracking,
    setupAutoStopTimer: globalGPS.setupAutoStopTimer,
    hasPermission: globalGPS.hasPermission
  };
}