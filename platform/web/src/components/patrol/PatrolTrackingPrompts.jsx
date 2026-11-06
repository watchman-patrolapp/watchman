import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FaBatteryHalf, FaMapMarkerAlt } from 'react-icons/fa';
import Button from '../ui/Button';
import { registerPatrolPromptHandlers } from '../../geo/patrolPromptBridge';

const COPY = {
  foreground: {
    title: 'Location for this patrol',
    icon: FaMapMarkerAlt,
    body: 'Watchman uses your location only while you are signed on to a patrol, so coordinators can see the route. Next, Android will ask you to allow location while the app is in use.',
    confirm: 'Continue',
    decline: 'Not now',
  },
  background: {
    title: 'Keep recording with the screen off',
    icon: FaMapMarkerAlt,
    body: 'During a signed-on patrol, Watchman shows a “Watchman: patrol in progress” notification and records your route in the background, including while the screen is off or you switch apps. Tracking stops when you sign off. Android will then ask you to choose Allow all the time.',
    confirm: 'Continue',
    decline: 'Only while the app is open',
  },
  battery: {
    title: 'Some phones pause patrol tracking',
    icon: FaBatteryHalf,
    body: 'Samsung, Xiaomi, Huawei, Oppo, Vivo, and similar phones often freeze an app to save battery. That can stop the route while the screen is off. Allow Watchman to keep running for this patrol. You can change it later in system settings.',
    confirm: 'Allow during patrol',
    decline: 'Not now',
  },
};

/**
 * Explains location, background location, and battery exemption before the system dialogs.
 * Mounted for the signed-in app so a patrol start never shows a raw permission error.
 */
export default function PatrolTrackingPrompts() {
  const [kind, setKind] = useState(null);
  const resolverRef = useRef(null);

  useEffect(() => {
    const open = (next) =>
      new Promise((resolve) => {
        resolverRef.current = resolve;
        setKind(next);
      });
    const unregister = registerPatrolPromptHandlers({
      explainForeground: () => open('foreground'),
      explainBackground: () => open('background'),
      explainBattery: () => open('battery'),
    });
    return () => {
      unregister();
      const pending = resolverRef.current;
      resolverRef.current = null;
      pending?.(false);
    };
  }, []);

  const close = (accepted) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setKind(null);
    resolve?.(accepted);
  };

  if (!kind || !COPY[kind]) return null;
  const copy = COPY[kind];
  const Icon = copy.icon;

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-4 sm:p-6 bg-black/50 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="patrol-tracking-prompt-title"
        className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 shadow-2xl overflow-hidden"
      >
        <div className="bg-gradient-to-r from-teal-600 to-teal-700 dark:from-teal-800 dark:to-teal-900 px-5 py-4 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-white">
            <Icon className="h-5 w-5" aria-hidden />
          </div>
          <h2 id="patrol-tracking-prompt-title" className="text-lg font-semibold text-white">
            {copy.title}
          </h2>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm text-gray-600 dark:text-gray-300">
          <p>{copy.body}</p>
          {kind === 'background' ? (
            <p>
              <Link to="/privacy" className="font-medium text-text-link underline">
                Privacy policy
              </Link>
            </p>
          ) : null}
        </div>
        <div className="px-5 pb-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 border-t border-gray-100 dark:border-gray-800 pt-4">
          <Button variant="secondary" className="w-full sm:w-auto" onClick={() => close(false)}>
            {copy.decline}
          </Button>
          <Button variant="primary" className="w-full sm:w-auto" onClick={() => close(true)}>
            {copy.confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}
