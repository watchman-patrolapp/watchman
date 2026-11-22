import { useEffect, useMemo } from "react";
import { MapContainer, Rectangle, TileLayer, Tooltip, useMap } from "react-leaflet";
import "../../utils/leaflet-icons";
import { useDarkMode } from "../../hooks/useDarkMode";
import { formatCount } from "../../utils/analyticsView";

// Same primary tiles as the live patrol map; dark mode dims them with a CSS filter (index.css).
const TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function FitBounds({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [16, 16], maxZoom: 15 });
  }, [map, bounds]);
  return null;
}

/** Aggregated coverage cells (never raw GPS points); darker = more patrols passed through. */
export default function CoverageMap({ coverage }) {
  const dark = useDarkMode();
  const cells = useMemo(() => (Array.isArray(coverage?.cells) ? coverage.cells : []), [coverage]);
  const size = Number(coverage?.cell_degrees) || 0.005;
  const max = Math.max(1, ...cells.map((c) => Number(c.patrols) || 0));
  const bounds = useMemo(() => {
    if (!cells.length) return null;
    const lats = cells.map((c) => Number(c.lat));
    const lngs = cells.map((c) => Number(c.lng));
    return [
      [Math.min(...lats) - size, Math.min(...lngs) - size],
      [Math.max(...lats) + size, Math.max(...lngs) + size],
    ];
  }, [cells, size]);

  if (!bounds) return null;
  return (
    <MapContainer bounds={bounds} scrollWheelZoom={false} className={`h-72 w-full rounded-xl sm:h-80 ${dark ? "analytics-map-dark" : ""}`} attributionControl>
      <TileLayer url={TILES} subdomains="abc" attribution={ATTRIBUTION} />
      <FitBounds bounds={bounds} />
      {cells.map((c) => {
        const half = size / 2;
        const lat = Number(c.lat);
        const lng = Number(c.lng);
        const weight = (Number(c.patrols) || 0) / max;
        return (
          <Rectangle
            key={`${c.lat},${c.lng}`}
            bounds={[
              [lat - half, lng - half],
              [lat + half, lng + half],
            ]}
            pathOptions={{ stroke: false, fillColor: "#0d9488", fillOpacity: 0.2 + 0.6 * weight }}
          >
            <Tooltip>{formatCount(c.patrols)} patrols passed through</Tooltip>
          </Rectangle>
        );
      })}
    </MapContainer>
  );
}
