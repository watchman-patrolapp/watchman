import { useAuth } from "../auth/useAuth";
import { Navigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useEffect, useRef } from "react";

export default function RequireRole({ children, allowedRoles = [] }) {
  const { user, loading } = useAuth();
  const toastFiredRef = useRef(false);

  // Still resolving auth session -- render nothing rather than bouncing to login
  if (loading) return null;

  // No session at all -- go to login
  if (!user) return <Navigate to="/login" replace />;

  const userRole = user.role ?? null;
  const hasAccess = userRole && allowedRoles.includes(userRole);

  if (!hasAccess) {
    return <AccessDenied toastFiredRef={toastFiredRef} />;
  }

  return <>{children}</>;
}

// Separate component so the toast useEffect has a stable home
function AccessDenied({ toastFiredRef }) {
  useEffect(() => {
    if (!toastFiredRef.current) {
      toastFiredRef.current = true;
      toast.error("You don't have permission to access that page.");
    }
  }, [toastFiredRef]);

  return <Navigate to="/dashboard" replace />;
}