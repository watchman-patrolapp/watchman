import { useState, useEffect, useCallback, useRef } from 'react';

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
  
  subscribe(listener) {
    this.listeners.add(listener);
    // Immediately send current state
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
  
  start(options = {}) {
    // If already running, just notify current state
    if (this.watchId !== null) {
      console.log('🌍 GPS already active, ID:', this.watchId);
      this.notify({ isActive: true, isLoading: false });
      return;
    }

    if (!navigator.geolocation) {
      this.notify({ 
        error: 'Geolocation not supported by this browser', 
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

    const handleSuccess = (position) => {
      const { latitude, longitude, accuracy, heading, speed } = position.coords;
      
      // Validate coordinates
      if (!this.validateCoords(position.coords)) {
        console.warn('⚠️ Invalid coordinates received:', position.coords);
        return;
      }

      this.hasPermission = true;

      const newLocation = {
        lat: latitude,
        lng: longitude,
        accuracy: accuracy || 0,
        altitude: position.coords.altitude || null,
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
    };

    const handleError = (error) => {
      console.error('❌ Geolocation error:', error.code, error.message);

      let errorMessage = 'Unknown location error';
      switch (error.code) {
        case 1:
          errorMessage = 'Location permission denied. Please enable GPS permissions in your browser settings.';
          this.hasPermission = false;
          break;
        case 2:
          errorMessage = 'Location unavailable. GPS signal lost or device in airplane mode.';
          break;
        case 3:
          errorMessage = 'Location request timed out. Try moving to an area with better GPS signal.';
          break;
        default:
          errorMessage = error.message;
      }

      this.notify({
        error: errorMessage,
        isActive: false,
        isLoading: false
      });
    };

    // Get initial position immediately
    navigator.geolocation.getCurrentPosition(
      handleSuccess,
      handleError,
      { enableHighAccuracy, timeout, maximumAge }
    );

    // Start continuous watching
    this.watchId = navigator.geolocation.watchPosition(
      handleSuccess,
      handleError,
      { 
        enableHighAccuracy, 
        maximumAge, 
        timeout,
        distanceFilter: 10 // Minimum 10 meters before update
      }
    );

    this.isActive = true;
    console.log('✅ GPS tracking started, watch ID:', this.watchId);
  },
  
  stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      console.log('🛑 GPS tracking stopped, watch ID:', this.watchId);
      this.watchId = null;
      this.isActive = false;
      this.notify({ isActive: false });
    }
  },
  
  restart(options) {
    this.stop();
    // Small delay to ensure clean restart
    setTimeout(() => this.start(options), 100);
  }
};

// Cleanup on actual page unload (not navigation)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    globalGPS.stop();
  });
  
  // Handle visibility change - restart if needed when tab becomes visible
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && globalGPS.hasPermission && !globalGPS.isActive) {
      console.log('👁️ Tab visible, restarting GPS...');
      globalGPS.restart();
    }
  });
}

// ==========================================
// REACT HOOK
// ==========================================

export function useLiveLocation(options = {}) {
  const [state, setState] = useState({
    location: globalGPS.location,
    history: globalGPS.history,
    error: globalGPS.error,
    isActive: globalGPS.isActive,
    isLoading: globalGPS.isLoading
  });

  const optionsRef = useRef(options);

  useEffect(() => {
    // Subscribe to global GPS state changes
    const unsubscribe = globalGPS.subscribe((newState) => {
      setState(newState);
    });

    // Start GPS if not already running (idempotent)
    globalGPS.start(optionsRef.current);

    // IMPORTANT: Don't stop GPS on unmount - let it persist across navigation!
    return () => {
      unsubscribe();
      // We intentionally do NOT call globalGPS.stop() here
      // GPS should persist across page navigation
    };
  }, []); // Empty deps - only run on mount

  // Manual controls (if needed)
  const startWatching = useCallback(() => {
    globalGPS.start(optionsRef.current);
  }, []);

  const stopWatching = useCallback(() => {
    globalGPS.stop();
  }, []);

  const restartWatching = useCallback(() => {
    globalGPS.restart(optionsRef.current);
  }, []);

  return {
    ...state,
    startWatching,
    stopWatching,
    restartWatching,
    hasPermission: globalGPS.hasPermission
  };
}

export default useLiveLocation;