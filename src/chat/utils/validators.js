// src/chat/utils/validators.js
/**
 * Validates geographic coordinates
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {boolean}
 */
export const validateCoordinates = (lat, lng) => {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
};

/**
 * Validates email format
 * @param {string} email
 * @returns {boolean}
 */
export const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

/**
 * Sanitizes filename to prevent path traversal
 * @param {string} name
 * @returns {string}
 */
export const sanitizeFileName = (name) => {
  return name
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 100);
};

/**
 * Checks if value is empty (null, undefined, empty string, empty array, empty object)
 * @param {*} value
 * @returns {boolean}
 */
export const isEmpty = (value) => {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
};

/**
 * Validates South African phone number
 * @param {string} phone
 * @returns {boolean}
 */
export const isValidSAPhone = (phone) => {
  const cleaned = phone.replace(/\s/g, '').replace(/^\+27/, '0');
  return /^0[6-8][0-9]{8}$/.test(cleaned);
};