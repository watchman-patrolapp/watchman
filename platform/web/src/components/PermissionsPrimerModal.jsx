import { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  FaMapMarkerAlt,
  FaBell,
  FaMicrophone,
  FaImage,
  FaCheck,
  FaArrowRight,
} from 'react-icons/fa';
import toast from 'react-hot-toast';
import {
  permissionsPrimerWasDismissed,
  dismissPermissionsPrimer,
  primeLocationPermission,
  primePushNotifications,
  primeWebNotifications,
} from '../utils/permissionsPrimerStorage';
import { registerEmergencyChatPush } from '../utils/emergencyChatPush';

const TOAST_LOC_GRANTED = 'nw-perm-loc-granted';
const TOAST_LOC_DENIED = 'nw-perm-loc-denied';
const TOAST_LOC_UNAVAILABLE = 'nw-perm-loc-unavailable';
const TOAST_PUSH_GRANTED = 'nw-perm-push-granted';
const TOAST_PUSH_DENIED = 'nw-perm-push-denied';

/**
 * First-run setup: short intro → location → notifications (native push or web Notification).
 * Mic/camera/photos stay just-in-time when those features are used.
 * Dismissal is remembered so this does not repeat until storage version bumps.
 */
export default function PermissionsPrimerModal({ userId }) {
  const [open, setOpen] = useState(false);
  /** @type {'intro' | 'location' | 'notifications' | 'done'} */
  const [step, setStep] = useState('intro');
  const [busy, setBusy] = useState(false);
  const allowInFlight = useRef(false);
  /** Native: avoid double system prompt if step re-renders while notifications step is open. */
  const notificationStepAutoRequestedRef = useRef(false);

  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!open) notificationStepAutoRequestedRef.current = false;
  }, [open]);

  // Native: show the OS notification permission dialog when the user reaches this step (not only after tapping "Allow alerts").
  useEffect(() => {
    if (!open || !userId || step !== 'notifications' || !isNative || notificationStepAutoRequestedRef.current) {
      return undefined;
    }
    notificationStepAutoRequestedRef.current = true;
    let cancelled = false;
    void (async () => {
      const r = await primePushNotifications();
      if (cancelled) return;
      if (r === 'granted') {
        toast.success('Alerts enabled for emergency chat and updates.', { id: TOAST_PUSH_GRANTED });
        await registerEmergencyChatPush(userId, { requestPermission: false });
      } else if (r === 'denied') {
        toast.error('Notifications stay off. You can enable them in app settings later.', {
          id: TOAST_PUSH_DENIED,
          duration: 6000,
        });
      } else if (r === 'unavailable') {
        toast.error('Notifications are not available on this build.', {
          id: TOAST_PUSH_DENIED,
          duration: 6000,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, step, isNative, userId]);

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    (async () => {
      const done = await permissionsPrimerWasDismissed();
      if (!cancelled && !done) {
        setOpen(true);
        setStep('intro');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const finishAndClose = async () => {
    await dismissPermissionsPrimer();
    await registerEmergencyChatPush(userId, { requestPermission: true });
    setOpen(false);
  };

  const handleIntroContinue = () => setStep('location');

  const handleLocationAllow = async () => {
    if (allowInFlight.current) return;
    allowInFlight.current = true;
    setBusy(true);
    try {
      const result = await primeLocationPermission();
      if (result === 'granted') {
        toast.success('Location enabled for patrols and maps.', { id: TOAST_LOC_GRANTED });
      } else if (result === 'denied') {
        toast.error(
          'Location was blocked. You can allow it later in system settings when you start a patrol.',
          { id: TOAST_LOC_DENIED, duration: 6000 }
        );
      } else if (result === 'no_fix') {
        toast.error(
          'No position returned (common on desktop). Try again on your phone or enable system location.',
          { id: TOAST_LOC_UNAVAILABLE, duration: 8000 }
        );
      } else {
        toast.error('Location is not available in this environment.', {
          id: TOAST_LOC_UNAVAILABLE,
          duration: 6000,
        });
      }
    } finally {
      setBusy(false);
      allowInFlight.current = false;
      setStep('notifications');
    }
  };

  const handleLocationSkip = () => setStep('notifications');

  const handleNotificationsAllow = async () => {
    if (allowInFlight.current) return;
    allowInFlight.current = true;
    setBusy(true);
    try {
      if (isNative) {
        const r = await primePushNotifications();
        if (r === 'granted') {
          toast.success('Alerts enabled for emergency chat and updates.', { id: TOAST_PUSH_GRANTED });
          await registerEmergencyChatPush(userId, { requestPermission: false });
        } else if (r === 'unavailable') {
          toast.error('Notifications are not available on this build.', {
            id: TOAST_PUSH_DENIED,
            duration: 6000,
          });
        } else if (r === 'denied') {
          toast.error('Notifications stay off. You can enable them in app settings later.', {
            id: TOAST_PUSH_DENIED,
            duration: 6000,
          });
        }
      } else {
        const r = await primeWebNotifications();
        if (r === 'granted') {
          toast.success('Browser notifications enabled.', { id: TOAST_PUSH_GRANTED });
        } else if (r === 'denied') {
          toast.error('Notifications blocked in the browser. You can change this in the site settings.', {
            id: TOAST_PUSH_DENIED,
            duration: 6000,
          });
        }
      }
    } finally {
      setBusy(false);
      allowInFlight.current = false;
      setStep('done');
    }
  };

  const handleNotificationsSkip = () => setStep('done');

  const handleDone = async () => {
    await finishAndClose();
  };

  const handleSkipEntireFlow = async () => {
    await finishAndClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 sm:p-6 bg-black/50 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="permissions-flow-title"
        className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        <div className="bg-gradient-to-r from-teal-600 to-teal-700 dark:from-teal-800 dark:to-teal-900 px-5 py-4 flex items-center gap-3 shrink-0">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-white">
            {step === 'intro' && <FaCheck className="h-5 w-5" aria-hidden />}
            {step === 'location' && <FaMapMarkerAlt className="h-5 w-5" aria-hidden />}
            {step === 'notifications' && <FaBell className="h-5 w-5" aria-hidden />}
            {step === 'done' && <FaCheck className="h-5 w-5" aria-hidden />}
          </div>
          <div className="min-w-0">
            <h2 id="permissions-flow-title" className="text-lg font-semibold text-white truncate">
              {step === 'intro' && 'Welcome — quick setup'}
              {step === 'location' && 'Location'}
              {step === 'notifications' && 'Alerts'}
              {step === 'done' && 'All set'}
            </h2>
            <p className="text-sm text-teal-100">
              Step{' '}
              {step === 'intro'
                ? '1'
                : step === 'location'
                  ? '2'
                  : step === 'notifications'
                    ? '3'
                    : '4'}{' '}
              of 4
            </p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4 text-sm text-gray-600 dark:text-gray-300 overflow-y-auto flex-1">
          {step === 'intro' && (
            <>
              <p>
                Two optional permissions help the neighbourhood watch work better:{' '}
                <strong className="text-gray-900 dark:text-white">location</strong> for patrols and maps, and{' '}
                <strong className="text-gray-900 dark:text-white">notifications</strong> for emergency chat alerts.
              </p>
              <p className="flex items-start gap-2 text-gray-500 dark:text-gray-400">
                <FaMicrophone className="mt-0.5 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden />
                <span>
                  <strong className="text-gray-700 dark:text-gray-300">Microphone</strong>,{' '}
                  <strong className="text-gray-700 dark:text-gray-300">camera</strong>, and{' '}
                  <strong className="text-gray-700 dark:text-gray-300">photos</strong> are only requested when you use voice messages or attach images — not now.
                </span>
              </p>
              <p className="flex items-start gap-2 text-gray-500 dark:text-gray-400">
                <FaImage className="mt-0.5 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden />
                <span>You can skip any step and continue; you can change permissions later in system settings.</span>
              </p>
            </>
          )}

          {step === 'location' && (
            <>
              <p>
                While on patrol, your position can update the <strong className="text-gray-900 dark:text-white">live map</strong> for coordinators and nearby members.
              </p>
              <p className="text-xs text-amber-800/90 dark:text-amber-200/80 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 rounded-lg px-3 py-2">
                IDE embedded browsers often cannot show the real GPS dialog. Test with Chrome, Edge, or your Android app on a device.
              </p>
            </>
          )}

          {step === 'notifications' && (
            <>
              <p>
                {isNative
                  ? 'Allow notifications so you can get emergency chat alerts and important updates when the app is in the background.'
                  : 'Allow browser notifications if you want alerts for chat and activity while this tab is open or in the background.'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                You can turn this off anytime in system or browser settings.
              </p>
            </>
          )}

          {step === 'done' && (
            <p className="text-gray-700 dark:text-gray-200">
              You are ready to use the app. Location and alerts can be changed anytime in Settings on your device.
            </p>
          )}
        </div>

        <div className="px-5 pb-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 border-t border-gray-100 dark:border-gray-800 pt-4 shrink-0">
          {step === 'intro' && (
            <>
              <button
                type="button"
                onClick={handleSkipEntireFlow}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Skip setup
              </button>
              <button
                type="button"
                onClick={handleIntroContinue}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white shadow-sm"
              >
                Continue
                <FaArrowRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </>
          )}

          {step === 'location' && (
            <>
              <button
                type="button"
                onClick={handleLocationSkip}
                disabled={busy}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={handleLocationAllow}
                disabled={busy}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white shadow-sm disabled:opacity-50"
              >
                {busy ? 'Requesting…' : 'Allow location'}
              </button>
            </>
          )}

          {step === 'notifications' && (
            <>
              <button
                type="button"
                onClick={handleNotificationsSkip}
                disabled={busy}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={handleNotificationsAllow}
                disabled={busy}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white shadow-sm disabled:opacity-50"
              >
                {busy ? 'Requesting…' : isNative ? 'Allow alerts' : 'Allow notifications'}
              </button>
            </>
          )}

          {step === 'done' && (
            <button
              type="button"
              onClick={handleDone}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white shadow-sm sm:ml-auto"
            >
              Got it
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
