import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { useProfileAccessGate } from "../auth/useProfileAccessGate";
import { useActiveOrganization } from "../auth/useActiveOrganization";
import PageSkeleton from "./layout/PageSkeleton";
import ProfileLoadRecovery from "./ProfileLoadRecovery";

export default function RequireActiveOrganization({ children }) {
  const location = useLocation();
  const { sessionReady, loading: authLoading } = useAuth();
  const { view, retryProfile, signOut } = useProfileAccessGate();
  const { isGlobalOperator, needsAreaSelection, loading } = useActiveOrganization();

  // Profile failure used to leave profileLoaded false, which kept this gate on
  // "Loading area…" and hid the recovery screen on every neighborhood route.
  if (view === "session" || view === "pending") {
    return <PageSkeleton message="Loading area…" />;
  }
  if (view === "offline" || view === "error") {
    return (
      <ProfileLoadRecovery
        variant={view}
        onRetry={() => {
          void retryProfile?.();
        }}
        onSignOut={() => {
          void signOut?.();
        }}
      />
    );
  }

  if (!sessionReady || authLoading || loading) {
    return <PageSkeleton message="Loading area…" />;
  }

  if (isGlobalOperator && needsAreaSelection) {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/choose-area" replace state={{ from }} />;
  }

  return children;
}
