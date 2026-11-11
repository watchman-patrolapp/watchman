// src/App.jsx
import { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";
import { supabase } from "./supabase/client";
import { listenForCarChanges, startGpsForCarCheckIn } from "./geo/carPatrolSync";
import { startPatrolGps } from "./hooks/useGPSTracking";
import { useAuth } from "./auth/useAuth";
import MobilePatrolDockHost from "./components/layout/MobilePatrolDockHost";
import HardwareBackNavHost from "./components/layout/HardwareBackNavHost";
import ScrollToTop from "./components/layout/ScrollToTop";
import SkipLink from "./components/layout/SkipLink";
import OfflineBanner from "./components/layout/OfflineBanner";
import PermissionsPrimerModal from "./components/PermissionsPrimerModal";
import PatrolTrackingPrompts from "./components/patrol/PatrolTrackingPrompts";
import AppRoutes from "./routes/AppRoutes";

/**
 * Android Auto: a patrol started from the car starts phone GPS from here, so it works on any page
 * and not only while the dashboard is mounted. The dashboard's own effect is a harmless second call.
 */
function CarPatrolGpsHost() {
  const { user, sessionReady } = useAuth();
  const userId = sessionReady ? user?.id : null;
  useEffect(() => {
    if (!userId) return undefined;
    return listenForCarChanges((reason) => {
      void startGpsForCarCheckIn(reason, {
        userId,
        startGps: startPatrolGps,
        fetchMine: async () => {
          const { data, error } = await supabase
            .from('active_patrols')
            .select('user_id')
            .eq('user_id', userId)
            .maybeSingle();
          if (error) throw error;
          return data;
        },
      });
    });
  }, [userId]);
  return null;
}

/** One-time permission intro (location + notifications) after sign-in; not tied to a single page. */
function PermissionFlowHost() {
  const { user, sessionReady } = useAuth();
  if (!sessionReady || !user?.id) return null;
  return (
    <>
      <PermissionsPrimerModal userId={user.id} />
      <PatrolTrackingPrompts />
    </>
  );
}

function App() {
  return (
    <>
      <SkipLink />
      <div id="main-content" tabIndex={-1}>
        <OfflineBanner />
        <BrowserRouter>
          <ScrollToTop />
          <PermissionFlowHost />
          <CarPatrolGpsHost />
          <AppRoutes />
          <HardwareBackNavHost />
          <MobilePatrolDockHost />
        </BrowserRouter>
      </div>
    </>
  );
}

export default App;
