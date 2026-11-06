import { useEffect, useState } from "react";

export const OFFLINE_BANNER_COPY = "You’re offline. Some actions will wait until you reconnect.";

export default function OfflineBanner() {
  const [offline, setOffline] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false
  );

  useEffect(() => {
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[80] bg-warning px-4 py-3 text-center text-sm font-medium text-white"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0px))" }}
    >
      {OFFLINE_BANNER_COPY}
    </div>
  );
}
