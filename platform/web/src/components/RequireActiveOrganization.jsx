import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { useActiveOrganization } from "../auth/useActiveOrganization";
import PageSkeleton from "./layout/PageSkeleton";

export default function RequireActiveOrganization({ children }) {
  const location = useLocation();
  const { sessionReady, loading: authLoading } = useAuth();
  const { isGlobalOperator, needsAreaSelection, loading } = useActiveOrganization();

  if (!sessionReady || authLoading || loading) {
    return <PageSkeleton message="Loading area…" />;
  }

  if (isGlobalOperator && needsAreaSelection) {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/choose-area" replace state={{ from }} />;
  }

  return children;
}
