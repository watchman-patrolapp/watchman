import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, useMap, useMapEvents, ZoomControl } from "react-leaflet";
import toast from "react-hot-toast";
import { FaCrosshairs, FaSatellite } from "react-icons/fa";
import { searchNominatim, SEARCH_BIAS } from "../../utils/nominatimLookup";

const DEFAULT_CENTER = [SEARCH_BIAS.lat, SEARCH_BIAS.lng];

const OSM = {
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
};

const SAT = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution:
    "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
};

function MapRecenter({ target }) {
  const map = useMap();
  const lat = Number(target?.lat);
  const lng = Number(target?.lng);
  const zoom = Number(target?.zoom) || 16;
  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    map.setView([lat, lng], zoom, { animate: true });
  }, [map, lat, lng, zoom]);
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
    const t = setTimeout(() => map.invalidateSize(), 120);
    return () => clearTimeout(t);
  }, [map]);
  return null;
}

export default function HomePinPicker({ pin, onPick, height = 240, areaCenter = null }) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [satellite, setSatellite] = useState(true);
  const [mapTarget, setMapTarget] = useState(null);
  const tiles = satellite ? SAT : OSM;
  const fallback = useMemo(
    () => ({
      lat: Number(areaCenter?.lat) || DEFAULT_CENTER[0],
      lng: Number(areaCenter?.lng) || DEFAULT_CENTER[1],
    }),
    [areaCenter?.lat, areaCenter?.lng]
  );
  const viewTarget = useMemo(() => {
    if (mapTarget) return { lat: mapTarget.lat, lng: mapTarget.lng, zoom: 17 };
    if (pin) return { lat: pin.lat, lng: pin.lng, zoom: 17 };
    return { lat: fallback.lat, lng: fallback.lng, zoom: 15 };
  }, [mapTarget, pin, fallback]);
  const initialCenter = [viewTarget.lat, viewTarget.lng];

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const hit = await searchNominatim(q, {
        biasLat: pin?.lat || fallback.lat,
        biasLng: pin?.lng || fallback.lng,
      });
      if (!hit) throw new Error("Search could not find that. Tap the map instead.");
      onPick({ lat: hit.lat, lng: hit.lng });
      setMapTarget({ lat: hit.lat, lng: hit.lng });
      toast("Check the pin — search often lands on the wrong house out of town.");
    } catch (e) {
      toast.error(e.message || "Could not find location");
    } finally {
      setSearching(false);
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error("This device cannot share GPS.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        onPick(next);
        setMapTarget(next);
        setLocating(false);
      },
      () => {
        setLocating(false);
        toast.error("Could not read GPS. Tap the map instead.");
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={useMyLocation}
        disabled={locating}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
      >
        <FaCrosshairs className="h-4 w-4" aria-hidden />
        {locating ? "Getting GPS…" : "Use my current location"}
      </button>
      <div className="relative z-0 isolate min-h-[240px] overflow-hidden rounded-xl">
        <MapContainer
          center={initialCenter}
          zoom={viewTarget.zoom}
          style={{ height, width: "100%", minHeight: 240, borderRadius: 12 }}
          scrollWheelZoom
          zoomControl={false}
          keyboard={false}
        >
          <TileLayer key={tiles.url} attribution={tiles.attribution} url={tiles.url} />
          <ZoomControl position="bottomright" />
          <InvalidateSize />
          <ClickCapture onPick={onPick} />
          <MapRecenter target={viewTarget} />
          {pin ? (
            <CircleMarker
              center={[pin.lat, pin.lng]}
              radius={9}
              pathOptions={{ color: "#0f766e", fillColor: "#14b8a6", fillOpacity: 0.95 }}
            />
          ) : null}
        </MapContainer>
        <div className="pointer-events-auto absolute right-2 top-2 z-[1000] flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setSatellite((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-lg bg-white/95 px-2 py-1 text-[11px] font-medium text-gray-800 shadow dark:bg-gray-900/95 dark:text-gray-100"
          >
            <FaSatellite className="h-3 w-3" aria-hidden />
            {satellite ? "Map" : "Satellite"}
          </button>
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className="inline-flex items-center gap-1 rounded-lg bg-white/95 px-2 py-1 text-[11px] font-medium text-gray-800 shadow dark:bg-gray-900/95 dark:text-gray-100 disabled:opacity-50"
          >
            <FaCrosshairs className="h-3 w-3" aria-hidden />
            {locating ? "…" : "I'm here"}
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void runSearch();
            }
          }}
          placeholder="Optional search — lots are often missing"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-900 dark:text-white"
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs dark:border-gray-600 disabled:opacity-50"
          disabled={searching}
        >
          {searching ? "…" : "Find"}
        </button>
      </div>
    </div>
  );
}
