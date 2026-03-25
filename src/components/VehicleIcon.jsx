// src/components/VehicleIcon.jsx
import { FaCar, FaBicycle, FaWalking } from 'react-icons/fa';

// Color mapping for vehicles (matches Dashboard.jsx)
export const COLOR_HEX = {
  gray:   '#6b7280',
  red:    '#ef4444',
  blue:   '#3b82f6',
  green:  '#22c55e',
  black:  '#1f2937',
  white:  '#cbd5e1',
  silver: '#94a3b8',
  yellow: '#eab308',
  orange: '#f97316',
};

// Normalize vehicle type text, working for both vehicle_type and legacy car_type values.
export function normalizeVehicleType(type, fallbackType) {
  const sanitize = (input) => {
    if (input == null) return '';
    return input
      .toString()
      .normalize('NFKC')  // Unicode normalization to handle accents/emoji
      .replace(/[^\w\s]/g, ' ')  // Strip non-word chars (emojis, punctuation)
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const primary = sanitize(type);
  const fallback = sanitize(fallbackType);

  // Prefer actual known type from primary if not generic 'car' (and if not missing).
  // But if primary is 'car' and fallback is richer, use fallback (legacy schema values).
  const resolved = (() => {
    if (primary && primary !== 'car') return primary;
    if (fallback && fallback !== 'car') return fallback;
    return primary || fallback;
  })();

  if (!resolved) return 'car';

  if (/bicycle|bike/.test(resolved)) return 'bicycle';
  if (/foot|walk|on foot|on\s?foot|pedestrian/.test(resolved)) return 'on_foot';

  return 'car';
}

// Vehicle type configurations
export const VEHICLE_CONFIG = {
  car: {
    icon: FaCar,
    label: 'Car',
    colorClass: 'text-blue-600 dark:text-blue-400',
    bgClass: 'bg-blue-100 dark:bg-blue-900/30',
  },
  bicycle: {
    icon: FaBicycle,
    label: 'Bicycle',
    colorClass: 'text-indigo-600 dark:text-indigo-400',
    bgClass: 'bg-indigo-100 dark:bg-indigo-900/30',
  },
  on_foot: {
    icon: FaWalking,
    label: 'On foot',
    colorClass: 'text-teal-600 dark:text-teal-400',
    bgClass: 'bg-teal-100 dark:bg-teal-900/30',
  },
};

/**
 * Unified Vehicle Icon Component
 * @param {string} type - 'car', 'bicycle', 'on_foot', 'walking'
 * @param {string} color - color name from COLOR_HEX
 * @param {string} size - 'sm' | 'md' | 'lg'
 * @param {boolean} showLabel - whether to show text label
 */
export default function VehicleIcon({ 
  type = 'car', 
  color = 'gray', 
  size = 'md',
  showLabel = false,
  className = '' 
}) {
  const safeType = normalizeVehicleType(type);
  const config = VEHICLE_CONFIG[safeType] || VEHICLE_CONFIG.car;
  const Icon = config.icon;
  
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-7 h-7',
  };

  // ✅ FIXED: Use safeType instead of type for color logic
  const iconColor = safeType === 'car' ? (COLOR_HEX[color] || COLOR_HEX.gray) : undefined;

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <Icon 
        className={`${sizeClasses[size]} flex-shrink-0 ${safeType !== 'car' ? config.colorClass : ''}`}
        style={safeType === 'car' ? { color: iconColor } : undefined}
        aria-hidden="true"
      />
      {showLabel && (
        <span className={`text-sm font-medium ${config.colorClass}`}>
          {config.label}
        </span>
      )}
    </div>
  );
}

/**
 * Helper to get vehicle display info for lists/cards
 */
export function getVehicleDisplayInfo(type, color, makeModel, registration) {
  const safeType = normalizeVehicleType(type);
  const config = VEHICLE_CONFIG[safeType] || VEHICLE_CONFIG.car;

  if (safeType === 'on_foot') {
    return {
      ...config,
      displayText: 'On foot',
      subtitle: null,
    };
  }
  
  if (safeType === 'bicycle') {
    return {
      ...config,
      displayText: makeModel || 'Bicycle',
      subtitle: registration ? `ID: ${registration}` : null,
    };
  }
  
  // Car
  return {
    ...config,
    displayText: makeModel 
      ? `${makeModel}${registration ? ` (${registration})` : ''}`
      : 'Car',
    subtitle: color ? `${color.charAt(0).toUpperCase() + color.slice(1)} car` : null,
  };
}