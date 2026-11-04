import { getGpsUploadThrottle } from '../utils/dataSaverProfile';
import { BANNER_WATCH_OPTIONS, createSharedGeolocation } from './sharedGeolocation';

const geo =
  typeof navigator !== 'undefined' && navigator.geolocation ? navigator.geolocation : null;

export const sharedGeolocation = createSharedGeolocation({
  supported: Boolean(geo),
  watchPosition: (success, error, options) => geo.watchPosition(success, error, options),
  clearWatch: (id) => geo.clearWatch(id),
  getCurrentPosition: (success, error, options) => geo.getCurrentPosition(success, error, options),
  isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  getBannerOptions: () => ({ ...BANNER_WATCH_OPTIONS }),
  getPatrolOptions: () => {
    const throttle = getGpsUploadThrottle();
    return {
      enableHighAccuracy: Boolean(throttle.enableHighAccuracy),
      maximumAge: throttle.maximumAge ?? 0,
      timeout: 10000,
    };
  },
});

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    sharedGeolocation.onVisibilityChange();
  });
}

export function getSharedGeolocationWatchCount() {
  return sharedGeolocation.getWatchCount();
}
