// src/App.jsx
import { useEffect } from "react";
import { BrowserRouter, useNavigate } from "react-router-dom";
import { supabase } from "./supabase/client";
import { listenForCarChanges, startGpsForCarCheckIn } from "./geo/carPatrolSync";
import { startPatrolGps } from "./hooks/useGPSTracking";
import { useAuth } from "./auth/useAuth";
import { useScopedOrganization } from "./utils/organizationScope";
import { canStartOrEndPatrol, homePathForRole, isHouseholdModeRole } from "./auth/roleMatrix";
import { hasHydratedAppRole } from "./auth/appRole";
import {
  WIDGET_ROUTES,
  buildWidgetProfilePayload,
  consumeWidgetLink,
  listenForWidgetLinks,
  syncWidgetProfile,
} from "./geo/widgetBridge";
import { setPendingWidgetAction } from "./geo/widgetActions";
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

/**
 * Android home-screen widgets: pushes the non-token profile fields they show (first name,
 * can-patrol, working organisation name) and redraws them when the organisation changes.
 * The fields come from public.users and the working organisation, not from JWT metadata.
 */
function WidgetProfileHost() {
  const { user, sessionReady } = useAuth();
  const { activeOrganization, activeOrganizationId } = useScopedOrganization();
  const userId = sessionReady ? user?.id : null;
  const hydrated = hasHydratedAppRole(user?.role);
  const fullName = user?.fullName;
  const canPatrol = hydrated ? canStartOrEndPatrol(user?.role) : null;
  const orgName = activeOrganization?.name || "";

  useEffect(() => {
    if (!userId || !hydrated) return;
    void syncWidgetProfile(
      buildWidgetProfilePayload({ user: { id: userId, fullName }, canPatrol, orgName })
    );
  }, [userId, hydrated, fullName, canPatrol, orgName, activeOrganizationId]);
  return null;
}

/**
 * Android home-screen widgets: opens the screen a widget tap asked for. The native side keeps the
 * route until it is consumed exactly once here (cold start and warm start), once the session is
 * ready. Start and end patrol go through the Dashboard's own check-in and check-out.
 */
function WidgetLinkHost() {
  const { user, sessionReady } = useAuth();
  const navigate = useNavigate();
  const userId = user?.id || null;
  const role = user?.role;
  const platformRole = user?.platformRole;

  useEffect(() => {
    if (!sessionReady) return undefined;
    let cancelled = false;

    const homePath = () => {
      if (!hasHydratedAppRole(role)) return "/dashboard";
      return homePathForRole(role, platformRole) || "/dashboard";
    };

    const handle = async () => {
      const route = await consumeWidgetLink();
      if (cancelled || !route) return;
      const target = WIDGET_ROUTES[route];
      if (!userId) {
        navigate("/login");
        return;
      }
      if (route === "sign-in" || route === "open") {
        navigate(homePath());
        return;
      }
      if (route === "start-patrol" || route === "end-patrol") {
        if (hasHydratedAppRole(role) && !canStartOrEndPatrol(role)) {
          // Patrollers-only empty state: household roles land on resident home.
          navigate(isHouseholdModeRole(role) || role === "resident" ? "/resident" : homePath());
          return;
        }
        setPendingWidgetAction(target.action);
      }
      navigate(target.path);
    };

    void handle();
    const stop = listenForWidgetLinks(() => {
      void handle();
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [sessionReady, userId, role, platformRole, navigate]);
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
          <WidgetProfileHost />
          <WidgetLinkHost />
          <AppRoutes />
          <HardwareBackNavHost />
          <MobilePatrolDockHost />
        </BrowserRouter>
      </div>
    </>
  );
}

export default App;
