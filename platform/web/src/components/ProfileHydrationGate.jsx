import { Navigate } from "react-router-dom";
import { useProfileAccessGate } from "../auth/useProfileAccessGate";
import PageSkeleton from "./layout/PageSkeleton";
import ProfileLoadRecovery from "./ProfileLoadRecovery";

/**
 * Replaces the indefinite "Checking access…" skeleton when the users row
 * never arrives. Children render only after the app role is known
 * (or a platform-console bypass applies).
 */
export default function ProfileHydrationGate({
  children,
  allowPlatformBypass = false,
  pendingMessage = "Checking access…",
}) {
  const { view, retryProfile, signOut } = useProfileAccessGate({ allowPlatformBypass });

  if (view === "session" || view === "pending") {
    return <PageSkeleton message={pendingMessage} />;
  }
  if (view === "signed-out") return <Navigate to="/login" replace />;
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
  return children;
}
