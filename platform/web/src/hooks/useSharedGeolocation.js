import { useEffect, useState } from 'react';
import { sharedGeolocation } from '../geo/sharedGeolocationClient';

/**
 * Read the process-wide geolocation watch.
 * `banner` is low accuracy and pauses while the tab is hidden.
 * `patrol` upgrades the same watch and keeps it running in a background tab.
 */
export function useSharedGeolocation(purpose = 'banner') {
  const [location, setLocation] = useState(() => sharedGeolocation.getLastLocation());

  useEffect(() => {
    let active = true;
    const release = sharedGeolocation.acquire({
      purpose,
      onPosition(position) {
        if (!active) return;
        const lat = position?.coords?.latitude;
        const lng = position?.coords?.longitude;
        if (typeof lat !== 'number' || typeof lng !== 'number') return;
        setLocation({ lat, lng });
      },
    });
    return () => {
      active = false;
      release();
    };
  }, [purpose]);

  return location;
}
