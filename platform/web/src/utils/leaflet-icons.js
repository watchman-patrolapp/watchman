// src/utils/leaflet-icons.js
import L from 'leaflet';

// Fix for Vite + Leaflet marker icons
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Leaflet gives the map container tabindex=0. On mobile that focuses the map
// as soon as it mounts and the browser scrolls it into view — pages then open
// mid-screen (dashboard patrol map, hotspots, leaderboard routes, etc.).
L.Map.mergeOptions({ keyboard: false });
L.Map.addInitHook(function preventMapFocusScroll() {
  const el = this.getContainer();
  if (!el) return;
  el.tabIndex = -1;
});

export default L;