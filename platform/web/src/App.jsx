// src/App.jsx
import { BrowserRouter } from "react-router-dom";
import { useAuth } from "./auth/useAuth";
import MobilePatrolDockHost from "./components/layout/MobilePatrolDockHost";
import HardwareBackNavHost from "./components/layout/HardwareBackNavHost";
import ScrollToTop from "./components/layout/ScrollToTop";
import SkipLink from "./components/layout/SkipLink";
import OfflineBanner from "./components/layout/OfflineBanner";
import PermissionsPrimerModal from "./components/PermissionsPrimerModal";
import PatrolTrackingPrompts from "./components/patrol/PatrolTrackingPrompts";
import AppRoutes from "./routes/AppRoutes";

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
          <AppRoutes />
          <HardwareBackNavHost />
          <MobilePatrolDockHost />
        </BrowserRouter>
      </div>
    </>
  );
}

export default App;
