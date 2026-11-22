import { useSyncExternalStore } from "react";

/** True while the app's theme toggle has dark mode on (the `dark` class on <html>). */
function subscribe(callback) {
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") return () => {};
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function getSnapshot() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

export function useDarkMode() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
