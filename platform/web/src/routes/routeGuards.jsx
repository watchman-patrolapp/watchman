import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import RequireActiveOrganization from "../components/RequireActiveOrganization";
import PageSkeleton from "../components/layout/PageSkeleton";

/** Don’t render login/register until INITIAL_SESSION finished — avoids faded sign-in flash on refresh */
export function AuthBootstrapGate({ children }) {
  const { sessionReady } = useAuth();
  if (!sessionReady) {
    return <PageSkeleton message="Signing you in…" />;
  }
  return children;
}

// PrivateRoute component
export function PrivateRoute({ children }) {
  const { user, loading, sessionReady } = useAuth();
  if (!sessionReady || loading) {
    return <PageSkeleton message="Signing you in…" />;
  }
  return user ? children : <Navigate to="/login" />;
}

export function NeighborhoodRoute({ children }) {
  return (
    <PrivateRoute>
      <RequireActiveOrganization>{children}</RequireActiveOrganization>
    </PrivateRoute>
  );
}
