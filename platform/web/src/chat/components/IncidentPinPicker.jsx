import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMap, useMapEvents, ZoomControl } from 'react-leaflet';
import '../../utils/leaflet-icons';
import toast from 'react-hot-toast';

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

export default function IncidentPinPicker({ pin, onPick }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [mapTarget, setMapTarget] = useState(null);

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'NeighbourhoodWatch/1.0' } });
      if (!res.ok) throw new Error('Search failed');
      const rows = await res.json();
      const top = rows?.[0];
      if (!top) throw new Error('No match found');
      const lat = Number(top.lat);
      const lng = Number(top.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Invalid coordinates');
      onPick({ lat, lng });
      setMapTarget({ lat, lng });
    } catch (e) {
      toast.error(e.message || 'Could not find location');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="relative">
      <MapContainer
        center={pin ? [pin.lat, pin.lng] : [-33.95, 25.58]}
        zoom={14}
        style={{ height: 180, width: '100%', borderRadius: 10 }}
        scrollWheelZoom
        zoomControl={false}
        keyboard={false}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ZoomControl position="bottomright" />
        <ClickCapture onPick={onPick} />
        <MapRecenter target={mapTarget || pin} />
        {pin && (
          <CircleMarker center={[pin.lat, pin.lng]} radius={8} pathOptions={{ color: '#0d9488', fillColor: '#14b8a6', fillOpacity: 0.9 }} />
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
          placeholder="Search place..."
          className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600"
          disabled={searching}
        >
          {searching ? '...' : 'Go'}
        </button>
      </div>
    </div>
  );
}
