import { useEffect, useRef } from "react";
import { Navigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuth } from "../auth/useAuth";
import { hasHydratedAppRole } from "../auth/appRole";
import { normalizeAppRole } from "../auth/staffRoles";
import { canAccessPlatformConsole } from "../auth/platformRoles";
import { homePathForRole } from "../auth/roleMatrix";
import { hasCapability } from "../auth/capabilities";
import { useOrgCapabilities } from "../hooks/useOrgCapabilities";
import PageSkeleton from "./layout/PageSkeleton";

function normalizeAllowedRoles(allowedRoles) {
  return allowedRoles.map((r) => String(r).trim().toLowerCase());
}

/**
 * Like RequireRole, but also lets in users holding any of `anyCapabilities`
 * in their working organization. On deny, sends the user to their role home.
 */
export default function RequireCapability({
  children,
  allowedRoles = [],
  anyCapabilities = [],
  allowPlatformConsole = false,
}) {
  const { user, loading, sessionReady } = useAuth();
  const { capabilities, loading: capsLoading } = useOrgCapabilities();
  const toastFiredRef = useRef(false);

  if (!sessionReady || loading) {
    return <PageSkeleton message="Checking access." />;
  }

  if (!user) return <Navigate to="/login" replace />;

  const platformOk = allowPlatformConsole && canAccessPlatformConsole(user.platformRole);
  if (!hasHydratedAppRole(user.role) && !platformOk) {
    return <PageSkeleton message="Checking access." />;
  }

  const userNorm = normalizeAppRole(user.role);
  const roleOk = Boolean(userNorm && normalizeAllowedRoles(allowedRoles).includes(userNorm));
  if (roleOk || platformOk) return <>{children}</>;

  if (anyCapabilities.length > 0 && capsLoading) {
    return <PageSkeleton message="Checking access." />;
  }

  const capOk = anyCapabilities.some((cap) => hasCapability(capabilities, cap));
  if (capOk) return <>{children}</>;

  return (
    <AccessDenied
      toastFiredRef={toastFiredRef}
      homePath={homePathForRole(user.role, user.platformRole)}
    />
  );
}

function AccessDenied({ toastFiredRef, homePath }) {
  useEffect(() => {
    if (!toastFiredRef.current) {
      toastFiredRef.current = true;
      toast.error("You don't have permission to access that page.");
    }
  }, [toastFiredRef]);

  return <Navigate to={homePath} replace />;
}
