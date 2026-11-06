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

async function preferencesApi() {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return null;
    const { Preferences } = await import("@capacitor/preferences");
    return Preferences;
  } catch {
    return null;
  }
}

/** Web uses localStorage. Android also mirrors into Preferences so a WebView wipe is not the only copy. */
export function browserStore() {
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
