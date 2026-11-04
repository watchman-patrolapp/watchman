import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { devLog, devWarn } from '../utils/devLog';
import { sharedGeolocation } from '../geo/sharedGeolocationClient';

// ==========================================
// Shared-watch adapter. Does not call watchPosition itself.
// Holders are ref-counted so unmount releases the consumer.
// ==========================================

const globalLive = {
  release: null,
  holders: 0,
  listeners: new Set(),
  location: null,
  history: [],
  error: null,
  isActive: false,
  isLoading: true,
  hasPermission: false,
  historyLimit: 50,

  subscribe(listener) {
    this.listeners.add(listener);
    listener({
      location: this.location,
      history: this.history,
      error: this.error,
      isActive: this.isActive,
      isLoading: this.isLoading,
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
      isLoading: this.isLoading,
    };
    this.listeners.forEach((cb) => cb(state));
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
    this.historyLimit = options.historyLimit ?? this.historyLimit ?? 50;
    if (this.release) {
      devLog('Live location already active');
      this.notify({ isActive: true, isLoading: false });
      return;
    }

    const purpose = options.purpose === 'patrol' ? 'patrol' : 'banner';
    this.notify({ isLoading: true });
    this.release = sharedGeolocation.acquire({
      purpose,
      onPosition: (position) => this._onPosition(position),
      onError: (error) => this._onError(error),
    });
    this.isActive = true;
    devLog('Live location joined shared geolocation', purpose);
  },

  _onPosition(position) {
    const { latitude, longitude, accuracy, heading, speed } = position.coords || {};
    if (!this.validateCoords(position.coords)) {
      devWarn('Invalid coordinates received', position.coords);
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
      timestamp: new Date().toISOString(),
    };
    const limit = this.historyLimit || 50;
    const newHistory = [...this.history.slice(-(limit - 1)), newLocation];
    this.notify({
      location: newLocation,
      history: newHistory,
      error: null,
      isActive: true,
      isLoading: false,
    });
  },

  _onError(error) {
    if (error?.code === 1) devWarn('Geolocation permission denied');
    else devLog('Geolocation error', error?.code, error?.message);

    let errorMessage = 'Unknown location error';
    switch (error?.code) {
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
        errorMessage = error?.message || errorMessage;
    }
    this.notify({
      error: errorMessage,
      isActive: false,
      isLoading: false,
    });
  },

  stop() {
    if (!this.release) return;
    this.release();
    this.release = null;
    this.isActive = false;
    this.notify({ isActive: false });
    devLog('Live location released shared geolocation');
  },

  restart(options) {
    this.stop();
    setTimeout(() => this.start(options), 100);
  },
};

export function useLiveLocation(options = {}) {
  const [state, setState] = useState({
    location: globalLive.location,
    history: globalLive.history,
    error: globalLive.error,
    isActive: globalLive.isActive,
    isLoading: globalLive.isLoading,
  });

  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    const unsubscribe = globalLive.subscribe((newState) => {
      setState(newState);
    });
    globalLive.holders += 1;
    if (globalLive.holders === 1) globalLive.start(optionsRef.current);
    return () => {
      unsubscribe();
      globalLive.holders = Math.max(0, globalLive.holders - 1);
      if (globalLive.holders === 0) globalLive.stop();
    };
  }, []);

  const startWatching = useCallback(() => {
    globalLive.start(optionsRef.current);
  }, []);

  const stopWatching = useCallback(() => {
    globalLive.stop();
  }, []);

  const restartWatching = useCallback(() => {
    globalLive.restart(optionsRef.current);
  }, []);

  return {
    ...state,
    startWatching,
    stopWatching,
    restartWatching,
    hasPermission: globalLive.hasPermission,
  };
}

export default useLiveLocation;
