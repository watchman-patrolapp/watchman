import { test } from "node:test";
import assert from "node:assert/strict";
import { browserStore } from "../store.js";

function withTimer(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} hung for ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function memoryLocalStorage() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

// Behaves like the Capacitor plugin proxy on Android: `.then` is a native call that never settles.
function capacitorLikeProxy() {
  return new Proxy(
    {},
    {
      get: (_, p) =>
        p === "then"
          ? () => Promise.reject(new Error("then not implemented"))
          : async () => ({ value: "v1", keys: ["k1"] }),
    }
  );
}

test("browserStore does not hang when Preferences is a thenable Capacitor-style proxy", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryLocalStorage(),
    configurable: true,
    writable: true,
  });
  try {
    const fakeProxy = capacitorLikeProxy();
    const store = browserStore({ loadPreferences: async () => ({ plugin: fakeProxy }) });

    assert.equal(await withTimer(store.get("k1"), 500, "get"), "v1");
    const keys = await withTimer(store.keys(), 500, "keys");
    assert.ok(keys.includes("k1"));
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
});
