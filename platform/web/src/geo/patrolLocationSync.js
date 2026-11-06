import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { supabase } from '../supabase/client';
import { devWarn } from '../utils/devLog';
import {
  QUEUE_STORAGE_KEY,
  buildQueuedPoint,
  classifyInsertResult,
  createPatrolLocationQueue,
  insertBodyFromPoint,
  parseQueue,
} from './patrolTrackingPlan';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function loadRaw() {
  try {
    if (Capacitor.isNativePlatform()) {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key: QUEUE_STORAGE_KEY });
      return value;
    }
  } catch (err) {
    devWarn('patrol location queue read failed', err);
  }
  try {
    return localStorage.getItem(QUEUE_STORAGE_KEY);
  } catch {
    return null;
  }
}

async function saveRaw(queue) {
  const raw = JSON.stringify(queue);
  try {
    if (Capacitor.isNativePlatform()) {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key: QUEUE_STORAGE_KEY, value: raw });
    }
  } catch (err) {
    devWarn('patrol location queue write failed', err);
  }
  try {
    localStorage.setItem(QUEUE_STORAGE_KEY, raw);
  } catch {
    /* Private mode. The in-memory flush still tried. */
  }
}

async function insertWithSupabase(body) {
  const { error } = await supabase.from('patrol_locations').insert(body);
  return classifyInsertResult({
    ok: !error,
    code: error?.code,
    message: error?.message,
  });
}

async function insertWithNativeHttp(body) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token || !supabaseUrl || !supabaseAnonKey) return 'retry';
  const response = await CapacitorHttp.post({
    url: `${String(supabaseUrl).replace(/\/$/, '')}/rest/v1/patrol_locations`,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    data: body,
  });
  const status = Number(response?.status);
  const payload = response?.data;
  const message = typeof payload === 'string' ? payload : JSON.stringify(payload || '');
  return classifyInsertResult({
    ok: status >= 200 && status < 300,
    status,
    code: payload?.code,
    message,
  });
}

async function insertRow(point, { includeTimestamp }) {
  const body = insertBodyFromPoint(point, { includeTimestamp });
  try {
    if (Capacitor.getPlatform() === 'android') return await insertWithNativeHttp(body);
    return await insertWithSupabase(body);
  } catch (err) {
    devWarn('patrol location insert failed', err);
    return 'retry';
  }
}

const queue = createPatrolLocationQueue({
  load: async () => parseQueue(await loadRaw()),
  save: saveRaw,
  insertRow: (point) => insertRow(point, { includeTimestamp: true }),
});

export async function submitPatrolPoint(fields) {
  const point = buildQueuedPoint(fields);
  const result = await insertRow(point, { includeTimestamp: false });
  if (result === 'sent' || result === 'duplicate') return result;
  await queue.enqueue(point);
  return 'queued';
}

export function flushPatrolLocations() {
  return queue.flush();
}

export function installPatrolLocationFlushListeners() {
  if (typeof window === 'undefined') return () => {};
  const onOnline = () => {
    void flushPatrolLocations();
  };
  window.addEventListener('online', onOnline);
  let removeApp = () => {};
  if (Capacitor.isNativePlatform()) {
    import('@capacitor/app')
      .then(({ App }) => App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) void flushPatrolLocations();
      }))
      .then((handle) => {
        removeApp = () => {
          void handle.remove();
        };
      })
      .catch(() => {});
  }
  return () => {
    window.removeEventListener('online', onOnline);
    removeApp();
  };
}
