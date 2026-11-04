import { useAuth } from "../auth/useAuth";
import { normalizeAppRole } from "../auth/staffRoles";
import { canAccessPlatformConsole } from "../auth/platformRoles";
import { Navigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useEffect, useRef } from "react";
import ProfileHydrationGate from "./ProfileHydrationGate";

function normalizeAllowedRoles(allowedRoles) {
  return allowedRoles.map((r) => String(r).trim().toLowerCase());
}

export default function RequireRole({ children, allowedRoles = [], allowPlatformConsole = false }) {
  return (
    <ProfileHydrationGate allowPlatformBypass={allowPlatformConsole} pendingMessage="Checking access…">
      <RoleBody allowedRoles={allowedRoles} allowPlatformConsole={allowPlatformConsole}>
        {children}
      </RoleBody>
    </ProfileHydrationGate>
  );
}

function RoleBody({ children, allowedRoles, allowPlatformConsole }) {
  const { user } = useAuth();
  const toastFiredRef = useRef(false);

  const userNorm = normalizeAppRole(user.role);
  const allowedNorm = normalizeAllowedRoles(allowedRoles);
  const hasAccess =
    Boolean(userNorm && allowedNorm.includes(userNorm)) ||
    (allowPlatformConsole && canAccessPlatformConsole(user.platformRole));

  if (!hasAccess) {
    return <AccessDenied toastFiredRef={toastFiredRef} />;
  }

  return <>{children}</>;
}

function AccessDenied({ toastFiredRef }) {
  useEffect(() => {
    if (!toastFiredRef.current) {
      toastFiredRef.current = true;
      toast.error("You don't have permission to access that page.");
    }
  }, [toastFiredRef]);

  return <Navigate to="/dashboard" replace />;
}
