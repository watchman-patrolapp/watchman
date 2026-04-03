import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { segmentLatLngsForDisplay } from '../../utils/patrolHistoryRoute';

const DEFAULT_CENTER = [-33.95, 25.58];

/** Finish flag — avoids default broken marker asset URLs */
const END_FLAG_ICON = L.divIcon({
  className: 'patrol-route-end-flag',
  html: '<div style="font-size:22px;line-height:1;text-align:center;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">🏁</div>',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

function FitBounds({ latlngs }) {
  const map = useMap();
  useEffect(() => {
    if (!latlngs?.length) return;
    const bounds = L.latLngBounds(latlngs);
    if (!bounds.isValid()) return;
    if (latlngs.length === 1) {
      map.setView(latlngs[0], 15, { animate: true });
    } else {
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 17, animate: true });
    }
  }, [latlngs, map]);
  return null;
}

/**
 * Read-only map: multi-segment polyline, green circle at start, finish flag at end.
 */
export default function PatrolRouteMapPanel({ latlngs, className = '' }) {
  const segments = segmentLatLngsForDisplay(latlngs, 10);
  const center = latlngs?.[0] || DEFAULT_CENTER;

  const startEnd = useMemo(() => {
    if (!latlngs || latlngs.length < 2) return null;
    return { start: latlngs[0], end: latlngs[latlngs.length - 1] };
  }, [latlngs]);

  if (!latlngs || latlngs.length < 2) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 text-center px-4 rounded-xl bg-gray-100 dark:bg-gray-900/90 text-sm text-gray-500 dark:text-gray-400 min-h-[220px] ${className}`}
      >
        <p className="text-gray-600 dark:text-gray-300 font-medium">
          Not enough GPS points to draw a route for this patrol.
        </p>
        <p className="text-xs max-w-md text-gray-500 dark:text-gray-500">
          Often because location was off, permission denied, or the app did not upload track points (older app builds record less or not at all). After patrol ends, points may also have been cleared by retention.
        </p>
      </div>
    );
  }

  return (
    <div className={`relative z-0 min-h-[220px] h-[min(50vh,320px)] rounded-xl overflow-hidden border border-gray-200 dark:border-gray-600 ${className}`}>
      <MapContainer
        center={center}
        zoom={14}
        className="h-full w-full min-h-[220px] z-0"
        scrollWheelZoom
        attributionControl
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds latlngs={latlngs} />
        {segments.map((seg, i) => (
          <Polyline
            key={i}
            positions={seg.positions}
            pathOptions={{
              color: seg.color,
              weight: 5,
              opacity: 0.92,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        ))}
        {startEnd && (
          <>
            <CircleMarker
              center={startEnd.start}
              radius={10}
              pathOptions={{
                color: '#15803d',
                fillColor: '#22c55e',
                fillOpacity: 0.95,
                weight: 3,
              }}
            />
            <Marker position={startEnd.end} icon={END_FLAG_ICON} />
          </>
        )}
      </MapContainer>
    </div>
  );
}
