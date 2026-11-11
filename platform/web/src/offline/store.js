export function memoryStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async set(key, value) {
      map.set(key, String(value));
    },
    async remove(key) {
      map.delete(key);
    },
    async keys() {
      return [...map.keys()];
    },
  };
}

function localKeys() {
  if (typeof localStorage === "undefined") return [];
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key) out.push(key);
    }
  } catch {
    return [];
  }
  return out;
}

/**
 * Resolves to `{ plugin }` (never the bare plugin) or null. Capacitor plugins are Proxies that
 * answer `.then`, so returning one from an async function (or awaiting one) never settles on Android.
 */
async function loadNativePreferences() {
  const { Capacitor } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform()) return null;
  const { Preferences } = await import("@capacitor/preferences");
  return { plugin: Preferences };
}

async function wrapPreferences(loadPreferences) {
  try {
    const loaded = await loadPreferences();
    const plugin = loaded?.plugin;
    if (!plugin) return null;
    // Plain object, so the proxy is never resolved through a promise.
    return {
      get: (o) => plugin.get(o),
      set: (o) => plugin.set(o),
      remove: (o) => plugin.remove(o),
      keys: () => plugin.keys(),
    };
  } catch {
    return null;
  }
}

let defaultPreferencesPromise = null;

/** Web uses localStorage. Android also mirrors into Preferences so a WebView wipe is not the only copy. */
export function browserStore(options = {}) {
  const { loadPreferences } = options;
  let customPreferencesPromise = null;
  const preferencesApi = () => {
    if (loadPreferences) {
      customPreferencesPromise ??= wrapPreferences(loadPreferences);
      return customPreferencesPromise;
    }
    defaultPreferencesPromise ??= wrapPreferences(loadNativePreferences);
    return defaultPreferencesPromise;
  };

  return {
    async get(key) {
      const prefs = await preferencesApi();
      if (prefs) {
        try {
          const { value } = await prefs.get({ key });
          if (value != null) return value;
        } catch {
          /* localStorage below */
        }
      }
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    async set(key, value) {
      const prefs = await preferencesApi();
      if (prefs) {
        try {
          await prefs.set({ key, value: String(value) });
        } catch {
          /* localStorage below */
        }
      }
      localStorage.setItem(key, String(value));
    },
    async remove(key) {
      const prefs = await preferencesApi();
      if (prefs) {
        try {
          await prefs.remove({ key });
        } catch {
          /* localStorage below */
        }
      }
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
    async keys() {
      const found = new Set(localKeys());
      const prefs = await preferencesApi();
      if (prefs && typeof prefs.keys === "function") {
        try {
          const { keys } = await prefs.keys();
          for (const key of keys || []) found.add(key);
        } catch {
          /* index plus localStorage is enough */
        }
      }
      return [...found];
    },
  };
}

let activeStore = null;

export function offlineStore() {
  if (!activeStore) activeStore = browserStore();
  return activeStore;
}

/** Tests pass a memory store. The app uses the browser store. */
export function setOfflineStoreForTests(store) {
  activeStore = store;
}
