import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMap, useMapEvents, ZoomControl } from 'react-leaflet';
import toast from 'react-hot-toast';
import { searchNominatim, reverseLabel, SEARCH_BIAS } from '../../utils/nominatimLookup';

const DEFAULT_CENTER = [SEARCH_BIAS.lat, SEARCH_BIAS.lng];

function MapRecenter({ target }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    map.setView([target.lat, target.lng], 16, { animate: true });
  }, [map, target]);
  return null;
}

function ClickCapture({ onPick }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function InvalidateSize() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 100);
    return () => clearTimeout(t);
  }, [map]);
  return null;
}

/**
 * Search or tap to set a lat/lng pin. Calls onPick({ lat, lng, label? }).
 */
export default function HotspotPinPicker({ pin, onPick, height = 200 }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [mapTarget, setMapTarget] = useState(null);

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const hit = await searchNominatim(q, {
        biasLat: pin?.lat || DEFAULT_CENTER[0],
        biasLng: pin?.lng || DEFAULT_CENTER[1],
      });
      if (!hit) throw new Error('No match found');
      onPick({ lat: hit.lat, lng: hit.lng, label: hit.label, source: 'search' });
      setMapTarget({ lat: hit.lat, lng: hit.lng });
    } catch (e) {
      toast.error(e.message || 'Could not find location');
    } finally {
      setSearching(false);
    }
  };

  const handleMapPick = async ({ lat, lng }) => {
    onPick({ lat, lng, source: 'map' });
    try {
      const label = await reverseLabel(lat, lng);
      onPick({ lat, lng, label, source: 'map' });
    } catch {
      /* pin already set */
    }
  };

  return (
    <div className="relative">
      <MapContainer
        center={pin ? [pin.lat, pin.lng] : DEFAULT_CENTER}
        zoom={14}
        style={{ height, width: '100%', borderRadius: 10 }}
        scrollWheelZoom
        zoomControl={false}
        keyboard={false}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ZoomControl position="bottomright" />
        <InvalidateSize />
        <ClickCapture onPick={handleMapPick} />
        <MapRecenter target={mapTarget || pin} />
        {pin && (
          <CircleMarker
            center={[pin.lat, pin.lng]}
            radius={8}
            pathOptions={{ color: '#b91c1c', fillColor: '#ef4444', fillOpacity: 0.9 }}
          />
        )}
      </MapContainer>
      <div className="pointer-events-auto absolute top-2 left-2 right-2 z-[1000] flex items-center gap-1 rounded-lg bg-white/95 p-1 shadow dark:bg-gray-900/95">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void runSearch();
            }
          }}
          placeholder="Street, address, or corner — e.g. Christian Road and Montmedy"
          className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 disabled:opacity-50"
          disabled={searching}
        >
          {searching ? '…' : 'Find'}
        </button>
      </div>
    </div>
  );
}
