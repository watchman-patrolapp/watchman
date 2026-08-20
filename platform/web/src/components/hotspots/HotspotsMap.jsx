import { Fragment, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polygon, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { viewConeLatLngs } from '../../utils/hotspotGeometry';
import { DEFAULT_FOV_DEG } from '../../utils/cameraSuggestions';
import { hotspotKindLabel } from '../../utils/hotspotKinds';
import { formatWatchDateTime } from '../../utils/watchTime';

const DEFAULT_CENTER = [-33.95, 25.58];

function markerIcon(kind, selected) {
  const meta = { break_in: 'break', attempted_break_in: 'attempt', cable_theft: 'cable', attempted_cable_theft: 'cable-attempt' };
  const slug = meta[kind] || 'break';
  const isCable = slug.startsWith('cable');
  const size = selected ? (isCable ? 28 : 32) : isCable ? 24 : 28;
  const title = hotspotKindLabel(kind);
  return L.divIcon({
    className: 'hotspot-marker-wrap',
    html: `<div class="hotspot-marker hotspot-marker--${slug}${selected ? ' hotspot-marker--selected' : ''}" title="${title}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, isCable ? size / 2 : size],
    popupAnchor: [0, isCable ? -size / 2 : -size + 4],
  });
}

const CAMERA_ICON = L.divIcon({
  className: 'hotspot-marker-wrap',
  html: '<div class="hotspot-marker hotspot-marker--camera" title="Camera"></div>',
  iconSize: [24, 24],
  iconAnchor: [12, 24],
  popupAnchor: [0, -20],
});

function FitToItems({ events, cameras, showCameras }) {
  const map = useMap();
  const key = useMemo(() => {
    const e = (events || []).map((x) => `${x.id}:${x.latitude}:${x.longitude}`).join('|');
    const c = showCameras ? (cameras || []).map((x) => x.id).join('|') : '';
    return `${e}::${c}`;
  }, [events, cameras, showCameras]);

  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize({ animate: false }), 80);
    return () => clearTimeout(t);
  }, [map]);

  useEffect(() => {
    const latlngs = [];
    for (const ev of events || []) {
      if (Number.isFinite(ev.latitude) && Number.isFinite(ev.longitude)) {
        latlngs.push([ev.latitude, ev.longitude]);
      }
    }
    if (showCameras) {
      for (const cam of cameras || []) {
        if (Number.isFinite(cam.latitude) && Number.isFinite(cam.longitude)) {
          latlngs.push([cam.latitude, cam.longitude]);
        }
      }
    }
    if (!latlngs.length) {
      map.setView(DEFAULT_CENTER, 14);
      return;
    }
    if (latlngs.length === 1) {
      map.setView(latlngs[0], 16, { animate: false });
      return;
    }
    const bounds = L.latLngBounds(latlngs);
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17, animate: false });
  }, [key, map]);

  return null;
}

function whenLabel(ev) {
  if (!ev.occurred_at) return 'Date unknown';
  if (!ev.time_known) {
    return (
      formatWatchDateTime(ev.occurred_at, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }) || 'Date unknown'
    );
  }
  return (
    formatWatchDateTime(ev.occurred_at, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) || 'Date unknown'
  );
}

export default function HotspotsMap({
  events,
  cameras,
  zones,
  pathSegments,
  showPath,
  showCameras,
  selectedEventId,
  onSelectEvent,
  onSelectCamera,
  onEditEvent,
}) {
  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={14}
      className="h-full w-full min-h-[320px] z-0 rounded-none"
      scrollWheelZoom
      keyboard={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToItems events={events} cameras={cameras} showCameras={showCameras} />

      {zones.map((z, i) => (
        <Polygon
          key={`zone-${i}`}
          positions={z.polygon}
          interactive={false}
          pathOptions={{
            color: '#b91c1c',
            weight: 1.5,
            dashArray: '6 8',
            fillColor: '#ef4444',
            fillOpacity: 0.16,
          }}
        />
      ))}

      {showPath &&
        zones.flatMap((z, i) =>
          (z.corridor || []).map((ring, j) => (
            <Polygon
              key={`thread-fill-${i}-${j}`}
              positions={ring}
              interactive={false}
              pathOptions={{
                color: '#7c3aed',
                weight: 0,
                fillColor: '#8b5cf6',
                fillOpacity: 0.18,
              }}
            />
          ))
        )}

      {showPath &&
        pathSegments.map((seg, i) => (
          <Polyline
            key={`path-${i}`}
            positions={seg}
            interactive={false}
            pathOptions={{
              color: '#6d28d9',
              weight: 3,
              dashArray: '8 8',
              opacity: 0.9,
            }}
          />
        ))}

      {showCameras &&
        cameras.map((cam) => (
          <Fragment key={cam.id}>
            {Number.isFinite(cam.facing_bearing) && (
              <Polygon
                positions={viewConeLatLngs(
                  cam.latitude,
                  cam.longitude,
                  cam.facing_bearing,
                  Number(cam.range_meters) || 50,
                  DEFAULT_FOV_DEG
                )}
                pathOptions={{
                  color: '#0f766e',
                  weight: 1,
                  fillColor: '#14b8a6',
                  fillOpacity: 0.12,
                }}
              />
            )}
            <Marker
              position={[cam.latitude, cam.longitude]}
              icon={CAMERA_ICON}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e.originalEvent);
                  onSelectCamera?.(cam);
                },
              }}
            >
              <Popup>
                <div className="p-2 text-sm">
                  <p className="font-semibold">{cam.name}</p>
                  {cam.address ? <p className="text-gray-600">{cam.address}</p> : null}
                  <p className="text-xs text-gray-500 mt-1">
                    Range ~{cam.range_meters} m
                    {Number.isFinite(cam.facing_bearing) ? ` · facing ${Math.round(cam.facing_bearing)}°` : ''}
                  </p>
                </div>
              </Popup>
            </Marker>
          </Fragment>
        ))}

      {events.map((ev) => {
        const selected = ev.id === selectedEventId;
        const icon = markerIcon(ev.kind, selected);
        return (
          <Marker
            key={ev.id}
            position={[ev.latitude, ev.longitude]}
            icon={icon}
            zIndexOffset={selected ? 600 : 400}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e.originalEvent);
                onSelectEvent?.(ev);
              },
            }}
          >
            <Popup>
              <div className="p-2 text-sm min-w-[12rem]">
                <p className="font-semibold">{hotspotKindLabel(ev.kind)}</p>
                <p>{ev.address}</p>
                <p className="text-xs text-gray-500 mt-1">{whenLabel(ev)}</p>
                {onEditEvent ? (
                  <button
                    type="button"
                    className="mt-2 rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white"
                    onClick={(e) => {
                      L.DomEvent.stopPropagation(e);
                      e.preventDefault();
                      onEditEvent(ev);
                    }}
                  >
                    Edit pin
                  </button>
                ) : null}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
