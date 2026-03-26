// src/chat/components/MessageBubble/LocationMessage.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FaMapMarkerAlt, FaExternalLinkAlt, FaExclamationTriangle, FaMobileAlt, FaWifi, FaBatteryFull } from 'react-icons/fa';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Coordinate validation
const isValidCoordinate = (lat, lng) => {
  return (
    typeof lat === 'number' && 
    typeof lng === 'number' &&
    !isNaN(lat) && 
    !isNaN(lng) &&
    lat >= -90 && 
    lat <= 90 &&
    lng >= -180 && 
    lng <= 180
  );
};

// Mobile device detection
const isMobileDevice = () => {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

// Touch gesture handling
const useTouchGestures = (mapRef, isMobile) => {
  useEffect(() => {
    if (!mapRef.current || !isMobile) return;

    const map = mapRef.current;
    let touchStart = null;
    let touchStartTime = 0;

    const handleTouchStart = (e) => {
      touchStart = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY
      };
      touchStartTime = Date.now();
    };

    const handleTouchEnd = (e) => {
      if (!touchStart) return;

      const touchEnd = {
        x: e.changedTouches[0].clientX,
        y: e.changedTouches[0].clientY
      };

      const deltaX = touchEnd.x - touchStart.x;
      const deltaY = touchEnd.y - touchStart.y;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      const timeDiff = Date.now() - touchStartTime;

      // Handle tap
      if (distance < 10 && timeDiff < 300) {
        // Single tap - prevent default to avoid zoom
        e.preventDefault();
        return;
      }

      // Handle swipe
      if (distance > 30 && timeDiff < 500) {
        // Swipe gesture - allow map panning
        map.dragging.enable();
      }
    };

    const handleTouchMove = (e) => {
      if (!touchStart) return;
      
      // Prevent default scrolling behavior on map
      e.preventDefault();
    };

    map.getContainer().addEventListener('touchstart', handleTouchStart, { passive: false });
    map.getContainer().addEventListener('touchend', handleTouchEnd, { passive: false });
    map.getContainer().addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      map.getContainer().removeEventListener('touchstart', handleTouchStart);
      map.getContainer().removeEventListener('touchend', handleTouchEnd);
      map.getContainer().removeEventListener('touchmove', handleTouchMove);
    };
  }, [mapRef, isMobile]);
};

// Performance monitoring
const usePerformanceMonitoring = () => {
  const [loadTime, setLoadTime] = useState(0);
  const startTime = useRef(null);

  const startLoad = useCallback(() => {
    startTime.current = performance.now();
  }, []);

  const endLoad = useCallback(() => {
    if (startTime.current) {
      const duration = performance.now() - startTime.current;
      setLoadTime(duration);
      
      // Log performance metrics for analytics
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', 'map_load_time', {
          event_category: 'performance',
          event_label: 'location_message_map',
          value: Math.round(duration)
        });
      }
    }
  }, []);

  return { loadTime, startLoad, endLoad };
};

// Network status monitoring
const useNetworkStatus = () => {
  const [isOnline, setIsOnline] = useState(true);
  const [isSlowConnection, setIsSlowConnection] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    const checkConnectionSpeed = async () => {
      if (!navigator.connection) return;
      
      const connection = navigator.connection;
      const effectiveType = connection.effectiveType;
      
      // Consider 3G and slower as slow connection
      setIsSlowConnection(effectiveType === 'slow-2g' || effectiveType === '2g' || effectiveType === '3g');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    checkConnectionSpeed();
    setInterval(checkConnectionSpeed, 30000); // Check every 30 seconds

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { isOnline, isSlowConnection };
};

// Fix Leaflet default marker icon issue in React
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// Fix default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

export const LocationMessage = React.memo(function LocationMessage({ 
  text, // Emergency message text
  lat, 
  lng, 
  address,
  isEmergency = false
}) {
  const [mapError, setMapError] = useState(false);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [isMapVisible, setIsMapVisible] = useState(false);
  const mapRef = useRef(null);
  
  // SAFETY CHECK: Ensure lat/lng are valid numbers
  const isValidLocation = isValidCoordinate(lat, lng);
  
  const directionsUrl = isValidLocation 
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
    : '#';
  
  const coordsText = isValidLocation 
    ? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
    : 'Location unavailable';

  // Mobile and performance optimizations
  const isMobile = isMobileDevice();
  const { loadTime, endLoad } = usePerformanceMonitoring();
  const { isOnline, isSlowConnection } = useNetworkStatus();
  
  useTouchGestures(mapRef, isMobile);

  // Lazy loading - only load map when visible
  useEffect(() => {
    if (isValidLocation && !isMapLoaded) {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setIsMapVisible(true);
            observer.disconnect();
          }
        },
        { threshold: 0.1 }
      );

      const mapContainer = document.querySelector('.leaflet-container');
      if (mapContainer) {
        observer.observe(mapContainer);
      }

      return () => observer.disconnect();
    }
  }, [isValidLocation, isMapLoaded]);

  // Handle map load error
  const handleMapError = useCallback(() => {
    setMapError(true);
    
    // Log error for monitoring
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'map_error', {
        event_category: 'error',
        event_label: 'location_message_map',
        value: 1
      });
    }
  }, []);

  // Handle map load success
  const handleMapLoad = useCallback(() => {
    setIsMapLoaded(true);
    endLoad();
    
    // Add haptic feedback on mobile
    if (isMobile && navigator.vibrate) {
      navigator.vibrate(50); // Short vibration
    }
  }, [isMobile, endLoad]);

  // Accessibility: Screen reader support
  const mapAriaLabel = isValidLocation 
    ? `Map showing location at ${coordsText}. ${address || ''}`
    : 'Map unavailable - location data missing';

  return (
    <div className={`rounded-xl overflow-hidden border max-w-[320px] ${
      isEmergency ? 'border-red-500 shadow-lg shadow-red-500/20' : 'border-gray-200 dark:border-gray-600'
    }`}>
      {/* EMERGENCY TEXT HEADER - Always show first */}
      {(text || isEmergency) && (
        <div className={`p-3 border-b ${
          isEmergency 
            ? 'bg-red-600 text-white border-red-700' 
            : 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800'
        }`}>
          <p className="text-sm font-bold flex items-center gap-2">
            <span className="animate-pulse">🚨</span>
            {text || 'Emergency Alert'}
          </p>
        </div>
      )}
      
      {/* Location info bar */}
      <div className="bg-blue-50 dark:bg-blue-900/20 p-3 flex items-center gap-2 border-b border-blue-100 dark:border-blue-800">
        <FaMapMarkerAlt className={`w-4 h-4 flex-shrink-0 ${isValidLocation ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`} />
        <div className="min-w-0">
          <span className={`text-sm font-medium block truncate ${isValidLocation ? 'text-blue-800 dark:text-blue-200' : 'text-gray-500'}`}>
            {address || coordsText}
          </span>
          {isValidLocation && (
            <span className="text-xs text-blue-600 dark:text-blue-400 font-mono">
              {coordsText}
            </span>
          )}
        </div>
      </div>
      
      {/* INTERACTIVE LEAFLET MAP */}
      {isValidLocation ? (
        <div className="relative">
          {/* Mobile status indicators */}
          {isMobile && (
            <div className="flex gap-2 p-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-xs">
              <span className={`flex items-center gap-1 ${isOnline ? 'text-green-600' : 'text-red-600'}`}>
                <FaWifi />
                {isOnline ? 'Online' : 'Offline'}
              </span>
              {isSlowConnection && (
                <span className="flex items-center gap-1 text-amber-600">
                  <FaMobileAlt />
                  Slow connection
                </span>
              )}
              {loadTime > 0 && (
                <span className="flex items-center gap-1 text-blue-600">
                  <FaBatteryFull />
                  {Math.round(loadTime)}ms
                </span>
              )}
            </div>
          )}
          
          {!mapError && isMapVisible ? (
            <div className="h-36 w-full relative">
              <MapContainer 
                ref={mapRef}
                center={[lat, lng]} 
                zoom={15} 
                style={{ height: '100%', width: '100%' }}
                zoomControl={false}
                scrollWheelZoom={false}
                doubleClickZoom={false}
                touchZoom={isMobile}
                dragging={isMobile}
                keyboard={true}
                attributionControl={false}
                preferCanvas={isMobile}
                className="touch-manipulation"
                aria-label={mapAriaLabel}
                role="img"
                onLoad={handleMapLoad}
                eventHandlers={{
                  error: handleMapError,
                  tileerror: handleMapError
                }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url={isSlowConnection 
                    ? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  }
                  maxZoom={19}
                  detectRetina={true}
                  updateWhenIdle={true}
                  keepBuffer={1}
                  eventHandlers={{
                    tileerror: handleMapError
                  }}
                />
                <Marker position={[lat, lng]}>
                  <Popup>
                    <div className="text-sm">
                      <strong>Emergency Location</strong><br/>
                      {address || coordsText}
                    </div>
                  </Popup>
                </Marker>
              </MapContainer>
              
              {/* Touch-friendly overlay */}
              <a 
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute inset-0 z-[400] flex items-center justify-center bg-black/0 hover:bg-black/10 transition-colors group min-h-[44px] min-w-[44px]"
                aria-label="Open location in Google Maps"
              >
                <div className="bg-white/90 dark:bg-gray-800/90 p-3 rounded-lg opacity-0 group-hover:opacity-100 transition shadow-lg flex items-center gap-2 min-h-[44px] min-w-[44px]">
                  <FaExternalLinkAlt className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Open in Maps</span>
                </div>
              </a>
            </div>
          ) : (
            /* Fallback if map tiles fail or not yet loaded */
            <a 
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block h-36 bg-gray-100 dark:bg-gray-800 flex flex-col items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition group"
              aria-label="Open location in Google Maps"
            >
              <div className="text-center">
                <FaMapMarkerAlt className="w-10 h-10 mb-2 text-red-500 mx-auto" />
                <span className="text-sm font-medium block">Map unavailable</span>
                <span className="text-xs mt-1 block">Tap to open in Google Maps</span>
                {mapError && (
                  <span className="text-xs text-red-600 mt-1">Network error - check connection</span>
                )}
              </div>
            </a>
          )}
          
          {/* Coordinate badge with accessibility */}
          <div 
            className="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded font-mono z-[500] pointer-events-none"
            aria-label={`Coordinates: ${coordsText}`}
          >
            {coordsText}
          </div>
        </div>
      ) : (
        <div className="h-24 flex flex-col items-center justify-center text-gray-500 bg-gray-100 dark:bg-gray-800">
          <FaExclamationTriangle className="w-8 h-8 mb-2 text-amber-500" />
          <span className="text-sm font-medium">Location data missing</span>
          <span className="text-xs mt-1">Coordinates not available</span>
        </div>
      )}
    </div>
  );
});

export default LocationMessage;