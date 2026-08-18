import {
  FaBolt,
  FaCloud,
  FaCloudMoon,
  FaCloudRain,
  FaCloudSun,
  FaMoon,
  FaSmog,
  FaSun,
} from "react-icons/fa";
import { useAreaWeather } from "../../hooks/useAreaWeather";

function WeatherGlyph({ kind }) {
  const className = "h-3.5 w-3.5 shrink-0";
  if (kind === "clear") return <FaSun className={className} aria-hidden />;
  if (kind === "clear-night") return <FaMoon className={className} aria-hidden />;
  if (kind === "partly") return <FaCloudSun className={className} aria-hidden />;
  if (kind === "partly-night") return <FaCloudMoon className={className} aria-hidden />;
  if (kind === "rain") return <FaCloudRain className={className} aria-hidden />;
  if (kind === "storm") return <FaBolt className={className} aria-hidden />;
  if (kind === "fog") return <FaSmog className={className} aria-hidden />;
  return <FaCloud className={className} aria-hidden />;
}

export default function AreaWeatherChip({ organizationId, className = "" }) {
  const weather = useAreaWeather(organizationId);
  if (!weather) return null;

  return (
    <p className={`inline-flex flex-wrap items-center gap-1.5 text-sm ${className}`}>
      <WeatherGlyph kind={weather.kind} />
      {weather.temperatureC}° {weather.label}
    </p>
  );
}
