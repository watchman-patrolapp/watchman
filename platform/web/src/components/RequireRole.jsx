import { useAuth } from "../auth/useAuth";
import { hasHydratedAppRole } from "../auth/appRole";
import { normalizeAppRole } from "../auth/staffRoles";
import { Navigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useEffect, useRef } from "react";
import PageSkeleton from "./layout/PageSkeleton";

function normalizeAllowedRoles(allowedRoles) {
  return allowedRoles.map((r) => String(r).trim().toLowerCase());
}

export default function RequireRole({ children, allowedRoles = [] }) {
  const { user, loading, sessionReady } = useAuth();
  const toastFiredRef = useRef(false);

  if (!sessionReady || loading) {
    return <PageSkeleton message="Checking access…" />;
  }

  if (!user) return <Navigate to="/login" replace />;

  // Wait until public.users role is loaded — not Supabase JWT `role` ("authenticated").
  if (user && !hasHydratedAppRole(user.role)) {
    return <PageSkeleton message="Checking access…" />;
  }

  const userNorm = normalizeAppRole(user.role);
  const allowedNorm = normalizeAllowedRoles(allowedRoles);
  const hasAccess = Boolean(userNorm && allowedNorm.includes(userNorm));

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
