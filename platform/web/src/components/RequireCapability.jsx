import { useEffect, useRef } from "react";
import { Navigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuth } from "../auth/useAuth";
import { normalizeAppRole } from "../auth/staffRoles";
import { canAccessPlatformConsole } from "../auth/platformRoles";
import { homePathForRole } from "../auth/roleMatrix";
import { hasCapability } from "../auth/capabilities";
import { useOrgCapabilities } from "../hooks/useOrgCapabilities";
import PageSkeleton from "./layout/PageSkeleton";
import ProfileHydrationGate from "./ProfileHydrationGate";

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
  return (
    <ProfileHydrationGate allowPlatformBypass={allowPlatformConsole} pendingMessage="Checking access.">
      <CapabilityBody
        allowedRoles={allowedRoles}
        anyCapabilities={anyCapabilities}
        allowPlatformConsole={allowPlatformConsole}
      >
        {children}
      </CapabilityBody>
    </ProfileHydrationGate>
  );
}

function CapabilityBody({ children, allowedRoles, anyCapabilities, allowPlatformConsole }) {
  const { user } = useAuth();
  const { capabilities, loading: capsLoading } = useOrgCapabilities();
  const toastFiredRef = useRef(false);

  const platformOk = allowPlatformConsole && canAccessPlatformConsole(user.platformRole);
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
