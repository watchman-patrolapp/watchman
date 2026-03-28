import React from 'react';
import { FaCar, FaMotorcycle, FaBicycle, FaWalking, FaTruck, FaBus, FaAmbulance } from 'react-icons/fa';

// High-contrast color palette
export const COLOR_MAP = {
  red:     { bg: 'bg-red-100',    darkBg: 'dark:bg-red-900/40',    text: 'text-red-600',    darkText: 'dark:text-red-300',    border: 'border-red-200',    darkBorder: 'dark:border-red-800',    hex: '#dc2626' },
  blue:    { bg: 'bg-blue-100',   darkBg: 'dark:bg-blue-900/40',   text: 'text-blue-600',   darkText: 'dark:text-blue-300',   border: 'border-blue-200',   darkBorder: 'dark:border-blue-800',   hex: '#2563eb' },
  green:   { bg: 'bg-emerald-100',darkBg: 'dark:bg-emerald-900/40',text: 'text-emerald-600',darkText: 'dark:text-emerald-300',border: 'border-emerald-200',darkBorder: 'dark:border-emerald-800',hex: '#059669' },
  yellow:  { bg: 'bg-amber-100',  darkBg: 'dark:bg-amber-900/40',  text: 'text-amber-600',  darkText: 'dark:text-amber-300',  border: 'border-amber-200',  darkBorder: 'dark:border-amber-800',  hex: '#d97706' },
  orange:  { bg: 'bg-orange-100', darkBg: 'dark:bg-orange-900/40', text: 'text-orange-600', darkText: 'dark:text-orange-300', border: 'border-orange-200', darkBorder: 'dark:border-orange-800', hex: '#ea580c' },
  purple:  { bg: 'bg-violet-100', darkBg: 'dark:bg-violet-900/40', text: 'text-violet-600', darkText: 'dark:text-violet-300', border: 'border-violet-200', darkBorder: 'dark:border-violet-800', hex: '#7c3aed' },
  pink:    { bg: 'bg-pink-100',   darkBg: 'dark:bg-pink-900/40',   text: 'text-pink-600',   darkText: 'dark:text-pink-300',   border: 'border-pink-200',   darkBorder: 'dark:border-pink-800',   hex: '#db2777' },
  teal:    { bg: 'bg-teal-100',   darkBg: 'dark:bg-teal-900/40',   text: 'text-teal-600',   darkText: 'dark:text-teal-300',   border: 'border-teal-200',   darkBorder: 'dark:border-teal-800',   hex: '#0d9488' },
  gray:    { bg: 'bg-gray-100',   darkBg: 'dark:bg-gray-800',       text: 'text-gray-600',   darkText: 'dark:text-gray-300',   border: 'border-gray-200',   darkBorder: 'dark:border-gray-700',   hex: '#4b5563' },
  black:   { bg: 'bg-gray-200',   darkBg: 'dark:bg-gray-700',       text: 'text-gray-900',   darkText: 'dark:text-gray-100',   border: 'border-gray-300',   darkBorder: 'dark:border-gray-600',   hex: '#1f2937' },
  white:   { bg: 'bg-white',      darkBg: 'dark:bg-gray-800',       text: 'text-gray-600',   darkText: 'dark:text-gray-300',   border: 'border-gray-200',   darkBorder: 'dark:border-gray-700',   hex: '#9ca3af' },
};

// Export COLOR_HEX for backward compatibility
export const COLOR_HEX = {
  red: '#dc2626',
  blue: '#2563eb',
  green: '#059669',
  yellow: '#d97706',
  orange: '#ea580c',
  purple: '#7c3aed',
  pink: '#db2777',
  teal: '#0d9488',
  gray: '#4b5563',
  black: '#1f2937',
  white: '#9ca3af'
};

export const normalizeVehicleType = (vehicleType, carType) => {
  const type = (vehicleType || carType || '').toString().toLowerCase();
  if (type.includes('motorcycle') || (type.includes('bike') && !type.includes('bicycle'))) return 'motorcycle';
  if (type.includes('bicycle') || type.includes('bike')) return 'bicycle';
  if (type.includes('truck') || type.includes('van') || type.includes('pickup')) return 'truck';
  if (type.includes('bus')) return 'bus';
  if (type.includes('foot') || type.includes('walk') || type.includes('pedestrian')) return 'on_foot';
  if (type.includes('ambulance') || type.includes('emergency')) return 'emergency';
  return 'car';
};

export const getVehicleDisplayInfo = (type, makeModel, reg) => {
  const vehicleType = normalizeVehicleType(type);
  const displayText = vehicleType === 'on_foot' 
    ? 'On foot' 
    : makeModel 
      ? `${makeModel}${reg ? ` (${reg})` : ''}`
      : reg || 'Vehicle';
  
  return { displayText, vehicleType };
};

const VehicleIcon = ({ 
  type, 
  color = 'gray', 
  size = 'md', 
  className = '',
  showBorder = true,
  pulse = false 
}) => {
  const normalizedType = normalizeVehicleType(type);
  const colorData = COLOR_MAP[color.toLowerCase()] || COLOR_MAP.gray;
  
  const sizeClasses = {
    xs: 'w-6 h-6',
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16'
  };

  const iconSizes = {
    xs: 12,
    sm: 16,
    md: 20,
    lg: 24,
    xl: 32
  };

  const iconProps = {
    size: iconSizes[size],
    className: colorData.text
  };

  const renderIcon = () => {
    switch (normalizedType) {
      case 'motorcycle':
        return <FaMotorcycle {...iconProps} />;
      case 'bicycle':
        return <FaBicycle {...iconProps} />;
      case 'truck':
        return <FaTruck {...iconProps} />;
      case 'bus':
        return <FaBus {...iconProps} />;
      case 'emergency':
        return <FaAmbulance {...iconProps} />;
      case 'on_foot':
        return <FaWalking {...iconProps} />;
      default:
        return <FaCar {...iconProps} />;
    }
  };

  return (
    <div 
      className={`
        ${sizeClasses[size]} 
        ${colorData.bg} 
        ${colorData.darkBg}
        ${showBorder ? `${colorData.border} ${colorData.darkBorder} border-2` : ''}
        rounded-full 
        flex items-center justify-center
        shadow-sm
        transition-transform duration-200
        ${pulse ? 'animate-pulse' : ''}
        ${className}
      `}
    >
      {renderIcon()}
    </div>
  );
};

// Map marker version with label
export const VehicleMarker = ({ type, color = 'gray', name, isActive = true }) => {
  const colorData = COLOR_MAP[color.toLowerCase()] || COLOR_MAP.gray;
  const firstName = name?.split(' ')[0] || 'Unknown';
  
  return (
    <div className="flex flex-col items-center">
      <div 
        className={`
          w-10 h-10 
          ${colorData.bg} 
          ${colorData.darkBg}
          border-2 border-white dark:border-gray-800
          rounded-full 
          flex items-center justify-center
          shadow-lg
          ${isActive ? 'marker-active' : ''}
        `}
        style={{ backgroundColor: colorData.hex }}
      >
        <div className="text-white text-lg">
          {normalizeVehicleType(type) === 'on_foot' ? '🚶' : 
           normalizeVehicleType(type) === 'bicycle' ? '🚲' : 
           normalizeVehicleType(type) === 'motorcycle' ? '🏍️' : '🚗'}
        </div>
      </div>
      <div className="mt-1 px-2 py-0.5 bg-gray-900/90 dark:bg-gray-800/90 text-white text-xs font-medium rounded-full whitespace-nowrap backdrop-blur-sm">
        {firstName}
      </div>
    </div>
  );
};

export default VehicleIcon;