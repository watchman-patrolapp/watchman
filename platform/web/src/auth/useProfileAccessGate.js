import { useEffect, useState } from "react";
import { hasHydratedAppRole } from "./appRole";
import { canAccessPlatformConsole } from "./platformRoles";
import { profileAccessView } from "./profileLoadRetry";
import { useAuth } from "./useAuth";

function readOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

/**
 * Session is up but public.users.role is still unknown.
 * Stays on the skeleton until the profile error is known or the ~10s cap elapses.
 */
export function useProfileAccessGate({ allowPlatformBypass = false } = {}) {
  const { user, loading, sessionReady, profileError, profileLoadEpoch, retryProfile, signOut } = useAuth();
  const [online, setOnline] = useState(readOnline);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [elapsedEpoch, setElapsedEpoch] = useState(profileLoadEpoch);
  // Try again bumps the epoch. Drop the previous skeleton clock before paint
  // so a capped wait doesn't flash the error screen again.
  if (profileLoadEpoch !== elapsedEpoch) {
    setElapsedEpoch(profileLoadEpoch);
    setElapsedMs(0);
  }

  const hydrated = hasHydratedAppRole(user?.role);
  const bypass = Boolean(allowPlatformBypass && canAccessPlatformConsole(user?.platformRole));
  const waiting = Boolean(sessionReady && !loading && user && !hydrated && !bypass);

  useEffect(() => {
    const sync = () => setOnline(readOnline());
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    if (!waiting) return undefined;
    const started = Date.now();
    const tick = () => setElapsedMs(Date.now() - started);
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [waiting, profileLoadEpoch]);

  let view = "ready";
  if (!sessionReady || loading) view = "session";
  else if (!user) view = "signed-out";
  else {
    view = profileAccessView({
      hydrated,
      bypass,
      profileError,
      online,
      elapsedMs,
    });
  }

  return { view, user, profileError, retryProfile, signOut };
}
