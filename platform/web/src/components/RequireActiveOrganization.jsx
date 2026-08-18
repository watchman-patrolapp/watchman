import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { useActiveOrganization } from "../auth/useActiveOrganization";
import PageSkeleton from "./layout/PageSkeleton";

export default function RequireActiveOrganization({ children }) {
  const { sessionReady, loading: authLoading } = useAuth();
  const { isGlobalOperator, needsAreaSelection, loading } = useActiveOrganization();

  if (!sessionReady || authLoading || loading) {
    return <PageSkeleton message="Loading area…" />;
  }

  if (isGlobalOperator && needsAreaSelection) {
    return <Navigate to="/choose-area" replace />;
  }

  return children;
}
