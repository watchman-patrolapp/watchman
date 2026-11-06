import { Capacitor, registerPlugin } from '@capacitor/core';
import { getGpsUploadThrottle } from '../utils/dataSaverProfile';
import {
  PATROL_NOTIFICATION_TEXT,
  PATROL_NOTIFICATION_TITLE,
  friendlyTrackingMessage,
  pluginLocationToPosition,
  runPatrolPermissionFlow,
} from './patrolTrackingPlan';
import { waitForPatrolPromptHandlers } from './patrolPromptBridge';

const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
const WatchmanPatrol = registerPlugin('WatchmanPatrol');

let watcherId = null;

async function readStatus() {
  try {
    return await WatchmanPatrol.getStatus();
  } catch {
    return {
      sdkInt: 34,
      foreground: 'denied',
      background: 'denied',
      notifications: 'denied',
      ignoringBatteryOptimizations: true,
    };
  }
}

/**
 * Web and iOS return immediately (foreground watch only).
 * Android explains, then asks while-in-use, then "Allow all the time".
 */
export async function chooseAndroidTrackingMode() {
  if (Capacitor.getPlatform() !== 'android') return { mode: 'foreground' };
  const prompts = await waitForPatrolPromptHandlers();
  return runPatrolPermissionFlow({
    platform: 'android',
    readStatus,
    requestForeground: () => WatchmanPatrol.requestForeground(),
    requestBackground: () => WatchmanPatrol.requestBackground(),
    requestNotifications: () => WatchmanPatrol.requestNotifications(),
    askForeground: prompts?.explainForeground,
    askDisclosure: prompts?.explainBackground,
    askBattery: prompts?.explainBattery,
    isIgnoringBattery: async () => {
      const status = await WatchmanPatrol.getStatus();
      return Boolean(status?.ignoringBatteryOptimizations);
    },
    requestBatteryExemption: () => WatchmanPatrol.requestBatteryExemption(),
  });
}

async function addWatcher(options, callback) {
  try {
    return await BackgroundGeolocation.addWatcher(options, callback);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return BackgroundGeolocation.addWatcher(options, callback);
  }
}

export async function startBackgroundWatcher({ onLocation, onError }) {
  await stopBackgroundWatcher();
  const throttle = getGpsUploadThrottle();
  try {
    const id = await addWatcher(
      {
        backgroundTitle: PATROL_NOTIFICATION_TITLE,
        backgroundMessage: PATROL_NOTIFICATION_TEXT,
        requestPermissions: false,
        stale: false,
        distanceFilter: Number(throttle.minDistanceM) || 0,
      },
      (location, error) => {
        if (error || !location || typeof location.latitude !== 'number') {
          if (error) onError?.();
          return;
        }
        onLocation?.(pluginLocationToPosition(location));
      }
    );
    watcherId = id || null;
    return Boolean(watcherId);
  } catch {
    watcherId = null;
    return false;
  }
}

export async function stopBackgroundWatcher() {
  const id = watcherId;
  watcherId = null;
  if (!id) return;
  try {
    await BackgroundGeolocation.removeWatcher({ id });
  } catch {
    /* The service is already gone. Sign-off still completes. */
  }
}

export function backgroundWatcherActive() {
  return Boolean(watcherId);
}

export function backgroundStartFailedMessage() {
  return friendlyTrackingMessage('background-failed');
}
